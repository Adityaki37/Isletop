// Local-only verification through ordinary owned HTTP actions and real wall time.
// No database writes, injected cards, forced dice or shortened game targets.
import assert from "node:assert/strict";
import {
  actor,
  moveContext,
  type Action,
  type Game,
  type View,
} from "../lib/game";
import { chooseMove } from "./autoplay";
import { PAUSE_VOTE_MS } from "../lib/table-pause";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
assert(
  new URL(origin).protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
class Session {
  jar = new Map<string, string>();
  async request(path: string, body?: Record<string, unknown>) {
    const r = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const cookie of r.headers.getSetCookie()) {
      const pair = cookie.split(";")[0],
        i = pair.indexOf("=");
      this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await r.text();
    assert.equal(
      r.headers.get("cache-control"),
      "no-store",
      `${path} ${r.status}: ${text.slice(0, 300)}`,
    );
    return {
      status: r.status,
      ...(JSON.parse(text) as {
        game: View;
        error?: string;
        connected?: boolean[];
      }),
    };
  }
  async ok(path: string, body?: Record<string, unknown>) {
    const r = await this.request(path, body);
    assert([200, 201].includes(r.status), `${r.status}: ${r.error}`);
    return r;
  }
  read(g: View) {
    return this.ok(`/api/rooms?code=${g.code}`).then((r) => r.game);
  }
  action(
    g: View,
    action: Action,
    nonce = crypto.randomUUID(),
    context?: string,
  ) {
    return {
      op: "action",
      code: g.code,
      expectedCreated: g.created,
      action,
      nonce,
      ...(context ? { context } : {}),
    };
  }
  move(g: View, a: Action, nonce = crypto.randomUUID(), context?: string) {
    return this.ok("/api/rooms", this.action(g, a, nonce, context)).then(
      (r) => r.game,
    );
  }
}
async function table(n: number, speed = 0, duel = false) {
  const seats = Array.from({ length: n }, () => new Session());
  let g = (
    await seats[0].ok("/api/rooms", {
      op: "create",
      mode: duel ? "duel" : n === 1 ? "solo" : "base",
      capacity: n,
      name: "Pause Proof",
    })
  ).game;
  for (let p = 1; p < n; p++) {
    g = (
      await seats[p].ok("/api/rooms", {
        op: "join",
        code: g.code,
        name: `Pause seat ${p}`,
      })
    ).game;
  }
  g = await seats[0].move(g, { type: "settings", turnSeconds: speed });
  for (let p = 1; p < n; p++) g = await seats[p].move(g, { type: "ready" });
  g = await seats[0].move(g, { type: "start" });
  return { seats, game: g };
}
async function consent(seats: Session[], game: View) {
  let g = await seats[0].move(game, { type: "pauseRequest" });
  for (let p = 1; p < seats.length; p++)
    g = await seats[p].move(g, {
      type: "pauseVote",
      id: g.pause.vote!.id,
      accept: true,
    });
  return g;
}
async function realManualResume() {
  const { seats, game } = await table(1, 30),
    seat = seats[0];
  let g = await consent(seats, game);
  const paused = g,
    at = g.pause.pausedAt!;
  assert.equal(g.pause.until, null);
  const checkpoint = async () => {
    g = await seat.read(g);
    assert.equal(g.pause.pausedAt, at);
    assert.equal(g.revision, paused.revision);
    assert.equal(g.deadline, paused.deadline);
    assert.deepEqual(g.board, paused.board);
  };
  await sleep(35000);
  await checkpoint();
  await sleep(35000);
  await checkpoint();
  // The initial setup timer is already past, but no automatic piece can be placed.
  assert(Date.now() > paused.deadline!);
  await sleep(Math.max(0, at + 125000 - Date.now()));
  await checkpoint();
  const resumeRequestedAt = Date.now();
  g = await seat.move(g, { type: "pauseRequest" });
  assert.equal(g.pause.pausedAt, null);
  const pausedMs = g.deadline! - paused.deadline!;
  assert(pausedMs >= resumeRequestedAt - at && pausedMs <= g.serverTime - at);
  assert.deepEqual(g.board, paused.board);
  assert.equal(g.phase, paused.phase);
  assert.equal(g.revision, paused.revision + 1);
  assert(g.log.includes("The game resumed."));
  console.log(
    JSON.stringify({
      proof: "real-indefinite-pause-and-manual-resume",
      code: g.code,
      pausedMs,
      remainingMs: g.deadline! - g.serverTime,
    }),
  );
}
async function realVoteExpiry() {
  const { seats, game } = await table(3);
  let g = await seats[0].move(game, { type: "pauseRequest" });
  const before = g,
    id = g.pause.vote!.id,
    until = g.pause.vote!.endsAt;
  assert.equal(until - g.serverTime <= PAUSE_VOTE_MS, true);
  await sleep(Math.max(0, until - Date.now() + 180));
  g = await seats[1].read(g);
  assert.equal(g.pause.vote, null);
  assert.equal(g.pause.pausedAt, null);
  assert.equal(g.revision, before.revision + 1);
  assert.deepEqual(g.board, before.board);
  assert.equal(
    (
      await seats[1].request(
        "/api/rooms",
        seats[1].action(g, { type: "pauseVote", id, accept: true }),
      )
    ).status,
    400,
  );
  console.log(
    JSON.stringify({ proof: "real-thirty-second-vote-expiry", code: g.code }),
  );
}
async function ownershipAndMoves() {
  const { seats, game } = await table(8),
    observer = new Session();
  let g = game;
  const original = await seats[0].read(g),
    staleContext = moveContext(original),
    chatCount = g.chat.length;
  g = await seats[0].move(g, { type: "chat", text: " /pause " });
  const id = g.pause.vote!.id,
    nonce = crypto.randomUUID();
  assert.equal(g.chat.length, chatCount);
  const denied = async (s: Session, a: Action, context?: string) => {
    const r = await s.request(
      "/api/rooms",
      s.action(g, a, crypto.randomUUID(), context),
    );
    assert.equal(r.status, 400, r.error);
    return r.error;
  };
  await denied(observer, { type: "pauseVote", id, accept: true });
  await denied(seats[1], { type: "pauseVote", id: id + 1, accept: true });
  await denied(seats[1], { type: "pauseVote", id });
  g = await seats[1].move(g, { type: "pauseVote", id, accept: true }, nonce);
  const revision = g.revision;
  assert.equal(
    (await seats[1].move(g, { type: "pauseVote", id, accept: true }, nonce))
      .revision,
    revision,
  );
  await denied(seats[1], { type: "pauseVote", id, accept: true });
  for (let p = 2; p < 8; p++)
    g = await seats[p].move(g, { type: "pauseVote", id, accept: true });
  assert(g.pause.pausedAt !== null);
  const stopped = g,
    move = chooseMove(original as unknown as Game)!;
  assert.match((await denied(seats[0], move))!, /paused/);
  await seats[0].ok("/api/presence", {
    op: "beat",
    code: g.code,
    created: g.created,
    token: crypto.randomUUID(),
  });
  assert.equal(
    (await observer.ok(`/api/presence?code=${g.code}`)).connected![0],
    true,
  );
  g = await seats[0].move(g, { type: "chat", text: "We can still chat" });
  assert.equal(g.chat.at(-1)!.text, "We can still chat");
  const watch = await observer.read(g);
  assert.equal(watch.me, -1);
  assert(watch.players.every((p) => !p.hand && !p.dev));
  assert(!("pauseCooldowns" in watch));
  await sleep(600);
  g = await consent(seats, g);
  assert.equal(g.pause.pausedAt, null);
  assert.deepEqual(g.board, stopped.board);
  assert.match(
    (await denied(seats[0], move, staleContext))!,
    /turn has changed/,
  );
  g = await seats[0].move(
    g,
    move,
    crypto.randomUUID(),
    moveContext(await seats[0].read(g)),
  );
  assert.equal(g.phase, "setupRoad");
  assert.match((await denied(seats[0], { type: "pauseRequest" }))!, /Wait/);
  g = await seats[2].move(g, { type: "pauseRequest" });
  const rejectedId = g.pause.vote!.id;
  g = await seats[3].move(g, {
    type: "pauseVote",
    id: rejectedId,
    accept: false,
  });
  assert.equal(g.pause.vote, null);
  assert.equal(g.pause.pausedAt, null);
  g = await seats[4].move(g, { type: "pauseRequest" });
  await denied(seats[5], { type: "pauseVote", id: rejectedId, accept: true });
  g = await seats[5].move(g, {
    type: "pauseVote",
    id: g.pause.vote!.id,
    accept: false,
  });
  console.log(
    JSON.stringify({
      proof: "eight-owned-votes-chat-presence-stale-moves-receipts-decline",
      code: g.code,
    }),
  );
}
async function resignAndRematch() {
  const { seats, game } = await table(2, 0, true);
  let g = game;
  while (g.phase.startsWith("setup")) {
    const p = actor(g),
      mine = await seats[p].read(g);
    g = await seats[p].move(g, chooseMove(mine as unknown as Game, p)!);
  }
  g = await consent(seats, g);
  g = await seats[1].move(g, { type: "chat", text: "/resign" });
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 0);
  assert.equal(g.pause.pausedAt, null);
  assert.equal(g.pause.vote, null);
  assert.equal(g.deadline, null);
  const previous = g.created;
  g = (await seats[0].ok("/api/rooms", { op: "rematch", code: g.code })).game;
  assert.notEqual(g.created, previous);
  assert.equal(g.phase, "lobby");
  assert.equal(g.pause.sequence, 0);
  assert.equal(
    (
      await seats[0].request(
        "/api/rooms",
        seats[0].action(g, { type: "pauseRequest" }),
      )
    ).status,
    400,
  );
  console.log(JSON.stringify({ proof: "paused-resign-rematch", code: g.code }));
}
async function concurrentConsensus() {
  const { seats, game } = await table(8);
  let g = await seats[0].move(game, { type: "pauseRequest" });
  const id = g.pause.vote!.id;
  const votes = await Promise.all(
    seats
      .slice(1)
      .map((s) => s.move(g, { type: "pauseVote", id, accept: true })),
  );
  assert.equal(new Set(votes.map((v) => v.revision)).size, 7);
  g = await seats[0].read(g);
  assert(g.pause.pausedAt !== null);
  assert.equal(g.pause.vote, null);
  assert.deepEqual(g.board, game.board);
  g = await seats[0].move(g, { type: "pauseRequest" });
  const resumeId = g.pause.vote!.id;
  await Promise.all(
    seats
      .slice(1)
      .map((s) => s.move(g, { type: "pauseVote", id: resumeId, accept: true })),
  );
  g = await seats[0].read(g);
  assert.equal(g.pause.pausedAt, null);
  assert.equal(g.pause.vote, null);
  assert.deepEqual(g.board, game.board);
  console.log(
    JSON.stringify({
      proof: "concurrent-eight-seat-pause-and-resume",
      code: g.code,
    }),
  );
}
if (process.argv.includes("concurrent")) await concurrentConsensus();
else {
  await Promise.all([
    realManualResume(),
    realVoteExpiry(),
    ownershipAndMoves(),
    resignAndRematch(),
    concurrentConsensus(),
  ]);
  console.log(
    "Pause API verification passed with actual vote expiry and manual resume.",
  );
}
