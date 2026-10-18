// Local clients only. Games are mutated exclusively by normal HTTP actions.
// Trusted Convex reads verify atomic assignment, inventories and replay records.
import assert from "node:assert/strict";
import { loadRoom } from "../lib/room-store";
import { api, storageClient } from "../lib/convex-client";
import { assertConvexReplay } from "./convex-replay-assertions";
import { writeFileSync } from "node:fs";
import {
  actor,
  moveContext,
  type Game,
  type View,
  type Action,
} from "../lib/game";
import { emptyHand, RESOURCES } from "../lib/board";
import { chooseMove } from "./autoplay";
import { assertFinishedReplay } from "./replay-assertions";
import {
  type CasualQueue,
  type MatchmakingStatus,
  CASUAL_QUEUES,
} from "../lib/matchmaking-types";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
async function raw(code: string): Promise<Game> {
  const g = await loadRoom(code);
  assert(g);
  return g;
}
class Session {
  cookies = new Map<string, string>();
  get cookie() {
    return [...this.cookies.values()].join("; ");
  }
  async call<T = MatchmakingStatus>(
    path = "/api/matchmaking",
    body?: unknown,
    expected = 200,
    headerOrigin = origin,
  ): Promise<T> {
    const r = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: this.cookie,
        ...(body === undefined
          ? {}
          : { "Content-Type": "application/json", Origin: headerOrigin }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of r.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      this.cookies.set(pair.split("=")[0], pair);
    }
    const data = (await r.json()) as T & {
      error?: string;
    };
    assert.equal(r.status, expected, data.error);
    assert.equal(r.headers.get("cache-control"), "no-store");
    return data;
  }
  queue(queue: CasualQueue, ticket = crypto.randomUUID(), expected = 200) {
    return this.call(
      "/api/matchmaking",
      { op: "join", queue, ticket, name: "Queue Human", avatar: "player" },
      expected,
    );
  }
  cancel(ticket: string) {
    return this.call("/api/matchmaking", { op: "cancel", ticket });
  }
  async game(code: string) {
    return (
      await this.call<{
        game: View;
      }>("/api/rooms?code=" + code)
    ).game;
  }
  async move(
    code: string,
    action: Action,
    context?: string,
    nonce = crypto.randomUUID(),
  ) {
    return (
      await this.call<{
        game: View;
      }>("/api/rooms", {
        op: "action",
        code,
        action,
        nonce,
        ...(context ? { context } : {}),
      })
    ).game;
  }
}
async function clients(n: number) {
  const seats = Array.from({ length: n }, () => new Session());
  await Promise.all(seats.map((s) => s.call()));
  return seats;
}
const primary = new Session(),
  outsider = new Session();
assert.equal((await primary.call()).status, "idle");
await outsider.call();
const canceled = crypto.randomUUID();
await primary.cancel(canceled);
await primary.queue("duel", canceled, 409);
const first = crypto.randomUUID();
const waiting = await primary.queue("duel", first);
assert.equal(waiting.status, "waiting");
assert.equal((await primary.queue("duel", first)).status, "waiting");
await primary.queue("base4", first, 409);
await primary.queue("duel", crypto.randomUUID(), 409);
await outsider.call(
  "/api/matchmaking",
  { op: "heartbeat", ticket: first },
  409,
);
await outsider.cancel(first);
assert.equal((await primary.call()).status, "waiting");
assert.equal((await primary.cancel(first)).status, "idle");
const second = crypto.randomUUID();
await primary.queue("base4", second);
await primary.cancel(first);
const current = await primary.call();
assert.equal(current.status, "waiting");
if (current.status === "waiting") assert.equal(current.ticket, second);
await primary.cancel(second);
for (const body of [
  null,
  [],
  {},
  { op: "join", ticket: "bad", queue: "duel" },
  { op: "join", ticket: crypto.randomUUID(), queue: "shuffle" },
  {
    op: "join",
    ticket: crypto.randomUUID(),
    queue: "duel",
    name: "",
    avatar: "player",
  },
  {
    op: "join",
    ticket: crypto.randomUUID(),
    queue: "duel",
    name: "Human",
    avatar: "crown",
  },
])
  await primary.call("/api/matchmaking", body, 400);
await primary.call(
  "/api/matchmaking",
  { op: "cancel", ticket: crypto.randomUUID() },
  403,
  "https://wrong.example",
);
assert.equal((await primary.call()).status, "idle");
const oversized = await fetch(origin + "/api/matchmaking", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ text: "x".repeat(2100) }),
});
assert.equal(oversized.status, 413);
await oversized.text();
assert.equal((await primary.call()).status, "idle");
console.log(
  "PASS: ticket ownership, duplicate join, cross-queue exclusion, stale/early cancellation and request validation",
);
// Queue isolation and atomic groups under simultaneous requests.
const isolated = await clients(2),
  isolatedTickets = isolated.map(() => crypto.randomUUID());
await isolated[0].queue("duel", isolatedTickets[0]);
await isolated[1].queue("base4", isolatedTickets[1]);
assert.deepEqual((await outsider.call()).counts, {
  duel: 1,
  base4: 1,
  rankedDuel: 0,
  rankedBase4: 0,
  rankedRush4: 0,
  rankedCities4: 0,
});
await Promise.all(isolated.map((s, i) => s.cancel(isolatedTickets[i])));
for (const queue of ["duel", "base4"] as const) {
  const seats = await clients(16),
    tickets = seats.map(() => crypto.randomUUID());
  await Promise.all(seats.map((s, i) => s.queue(queue, tickets[i])));
  // A losing CAS contender may leave enough people waiting; the ordinary
  // heartbeat retries formation without a separate privileged worker.
  for (let round = 0; round < 4; round++) {
    const status = await Promise.all(seats.map((s) => s.call()));
    if (status.every((s) => s.status === "matched")) break;
    await Promise.all(
      status.map((s, i) =>
        s.status === "waiting"
          ? seats[i].call("/api/matchmaking", {
              op: "heartbeat",
              ticket: tickets[i],
            })
          : Promise.resolve(s),
      ),
    );
  }
  const statuses = await Promise.all(seats.map((s) => s.call()));
  assert(statuses.every((s) => s.status === "matched"));
  const codes = new Set(
    statuses.map((s) => (s.status === "matched" ? s.code : "")),
  );
  assert.equal(codes.size, 16 / CASUAL_QUEUES[queue].players);
  const ids = new Set<string>();
  for (const code of codes) {
    const g = await raw(code);
    assert.equal(g.matchmaking, queue);
    assert.equal(g.players.length, CASUAL_QUEUES[queue].players);
    await assertConvexReplay(g);
    for (const p of g.players) {
      assert(!ids.has(p.id), "A person cannot be assigned to two games");
      ids.add(p.id);
    }
  }
  for (let i = 0; i < seats.length; i++) {
    const result = await seats[i].cancel(tickets[i]);
    assert.equal(result.status, "matched");
    const before: MatchmakingStatus = statuses[i];
    assert(before.status === "matched" && result.status === "matched");
    assert.equal(result.code, before.code);
  }
  console.log(
    `PASS: 16 simultaneous ${queue} joins form ${codes.size} disjoint games with recorded initial state; cancellation after assignment preserves seats`,
  );
}
// Cancellation wins either before allocation, or allocation wins and both
// participants recover the same seated game. No half-created room is allowed.
for (let i = 0; i < 6; i++) {
  const [a, b] = await clients(2),
    ta = crypto.randomUUID(),
    tb = crypto.randomUUID();
  await a.queue("duel", ta);
  const [cancel, joinResult] = await Promise.all([
    a.cancel(ta),
    b.queue("duel", tb),
  ]);
  if (cancel.status === "matched") {
    assert.equal(joinResult.status, "matched");
    if (joinResult.status === "matched")
      assert.equal(cancel.code, joinResult.code);
    assert.equal((await raw(cancel.code)).players.length, 2);
  } else {
    assert.equal(cancel.status, "idle");
    assert.equal(joinResult.status, "waiting");
    await b.cancel(tb);
    assert.equal((await a.call()).status, "idle");
  }
}
console.log("PASS: six allocation/cancellation races");
// Real time, no database clock edits: expired entries cannot be revived.
const [expires, renewed] = await clients(2),
  te = crypto.randomUUID(),
  tr = crypto.randomUUID();
await expires.queue("base4", te);
await renewed.queue("base4", tr);
await new Promise((r) => setTimeout(r, 35000));
const lease = await renewed.call("/api/matchmaking", {
  op: "heartbeat",
  ticket: tr,
});
assert.equal(lease.status, "waiting");
await new Promise((r) => setTimeout(r, 27000));
assert.equal((await expires.call()).status, "idle");
await expires.call("/api/matchmaking", { op: "heartbeat", ticket: te }, 409);
assert.equal((await renewed.call()).status, "waiting");
await renewed.cancel(tr);
console.log("PASS: actual 60-second expiry and heartbeat renewal");
// Account sessions are canonical; logout drops pending entries but preserves
// an already assigned game, which can be recovered by a later login.
const account = new Session(),
  otherBrowser = new Session(),
  partner = new Session();
const username = "queue_" + crypto.randomUUID().slice(0, 8),
  password = "Queue test " + crypto.randomUUID();
await account.call(
  "/api/accounts",
  { op: "register", username, password, displayName: "Account Queue" },
  201,
);
await account.call("/api/accounts", {
  op: "profile",
  displayName: "Account Queue",
  bio: "",
  color: 4,
  avatar: "player",
});
await otherBrowser.call("/api/accounts", { op: "login", username, password });
await partner.call();
const accountTicket = crypto.randomUUID();
await account.queue("base4", accountTicket);
const otherStatus = await otherBrowser.call();
assert.equal(otherStatus.status, "waiting");
await otherBrowser.queue("duel", crypto.randomUUID(), 409);
await account.call("/api/accounts", { op: "logout" });
assert.equal((await otherBrowser.call()).status, "idle");
const ta = crypto.randomUUID();
await otherBrowser.queue("duel", ta);
const allocation = await partner.queue("duel");
assert.equal(allocation.status, "matched");
assert.equal((await otherBrowser.call()).status, "matched");
if (allocation.status !== "matched") throw Error();
const ag = await otherBrowser.game(allocation.code);
assert.equal(ag.me, 0);
assert.equal(ag.players[0].avatar, "player");
assert.equal(ag.players[0].color, 4);
assert.equal(ag.players[0].name, "Account Queue");
await otherBrowser.call("/api/accounts", { op: "logout" });
await otherBrowser.call("/api/accounts", { op: "login", username, password });
assert.equal((await otherBrowser.call()).status, "matched");
await otherBrowser.move(allocation.code, { type: "resign" });
assert.equal((await otherBrowser.call()).status, "idle");
const again = crypto.randomUUID();
await otherBrowser.queue("base4", again);
await otherBrowser.cancel(again);
console.log(
  "PASS: canonical account queues, pending logout cleanup, saved appearance, seated logout recovery and finished-game requeue",
);
if (process.env.TEST_ALLOCATION_ONLY === "1") process.exit(0);
// Finish three naturally played matches of EACH queue through the same public
// requests as a browser. Strategy uses only the acting person's private view.
function strategy(g: View): Game {
  return {
    ...g,
    players: g.players.map((p) => ({
      ...p,
      id: "test-only",
      hand: p.hand ?? { ...emptyHand(), wood: p.resources },
      dev: p.dev ?? [],
    })),
    deck: Array(g.deckCount).fill("knight"),
    receipts: [],
  } as unknown as Game;
}
const report: Record<string, unknown>[] = [];
for (const queue of ["duel", "base4"] as const)
  for (let round = 1; round <= 3; round++) {
    const seats = await clients(CASUAL_QUEUES[queue].players),
      tickets = seats.map(() => crypto.randomUUID());
    for (let i = 0; i < seats.length; i++)
      await seats[i].queue(queue, tickets[i]);
    const status = await seats[0].call();
    assert.equal(status.status, "matched");
    if (status.status !== "matched") throw Error();
    const code = status.code;
    let g = await seats[0].game(code);
    assert.equal(g.turnSeconds, CASUAL_QUEUES[queue].seconds);
    assert.equal(g.target, queue === "duel" ? 15 : 10);
    let steps = 0,
      clockRefreshes = 0;
    const counts: Record<string, number> = {};
    while (g.phase !== "finished" && steps < 12000) {
      const p =
          g.phase === "discard"
            ? Number(Object.keys(g.discards)[0])
            : actor(g as unknown as Game),
        mine = await seats[p].game(code);
      g = mine;
      if (g.phase === "finished") break;
      const currentActor =
        g.phase === "discard"
          ? Number(Object.keys(g.discards)[0])
          : actor(g as unknown as Game);
      if (currentActor !== p) {
        assert(++clockRefreshes < 100);
        continue;
      }
      assert.equal(mine.me, p);
      assert(
        mine.players.every(
          (player, i) => !("id" in player) && !!player.hand === (i === p),
        ),
      );
      const action = chooseMove(strategy(mine), p);
      assert(action, `No move in ${g.phase}`);
      const nonce = crypto.randomUUID();
      try {
        g = await seats[p].move(code, action, moveContext(mine), nonce);
      } catch (e) {
        if (
          !(e instanceof assert.AssertionError) ||
          e.actual !== 400 ||
          !e.message.includes("The turn has changed.")
        )
          throw e;
        // A real deadline can pass between reading and submitting.
        // Refresh and choose a new owned move, as the ordinary client does.
        assert(++clockRefreshes < 100);
        g = await seats[0].game(code);
        continue;
      }
      steps++;
      counts[action.type] = (counts[action.type] ?? 0) + 1;
      if (steps % 100 === 0) {
        const duplicate = await seats[p].move(code, action, undefined, nonce);
        assert(duplicate.revision >= g.revision);
        assert.equal(
          (await raw(code)).receipts.filter((receipt) =>
            receipt.endsWith(`:${nonce}`),
          ).length,
          1,
          "The move is still recorded exactly once if a real clock transition occurs during retry",
        );
        g = duplicate;
        const reconnect = await seats[p].call();
        assert.equal(
          reconnect.status,
          g.phase === "finished" ? "idle" : "matched",
        );
      }
      const stored = await raw(code);
      await assertConvexReplay(stored);
      for (const resource of RESOURCES)
        assert.equal(
          stored.bank[resource] +
            stored.players.reduce((sum, p) => sum + p.hand[resource], 0),
          19,
        );
      assert(
        stored.players.every((p) =>
          RESOURCES.every((r) => Number.isInteger(p.hand[r]) && p.hand[r] >= 0),
        ),
      );
    }
    assert.equal(g.phase, "finished");
    assert.notEqual(g.winner, null);
    assert(g.players[g.winner!].score >= g.target);
    const final = await raw(code);
    await assertFinishedReplay(origin, seats[0].cookie, final);
    for (const s of seats) {
      assert.equal((await s.call()).status, "idle");
      const history = await s.call<{
        matches: {
          id: string;
        }[];
      }>("/api/matches");
      assert(history.matches.some((m) => m.id === final.statistics!.id));
    }
    const archive = await primary.call<{
      game: View;
    }>("/api/matches?match=" + final.statistics!.id);
    assert.equal(archive.game.phase, "finished");
    assert(archive.game.players.every((p) => !p.hand && !("id" in p)));
    report.push({
      queue,
      round,
      code,
      matchId: final.statistics!.id,
      players: seats.length,
      target: g.target,
      score: g.players[g.winner!].score,
      turnSeconds: g.turnSeconds,
      actions: steps,
      clockRefreshes,
      rolls: Object.values(g.rollCounts).reduce((sum, n) => sum + n, 0),
      counts,
    });
    writeFileSync(
      ".sites-runtime/matchmaking-results.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify({ passed: true, ...report.at(-1) }));
  }
console.log(
  "PASS: six natural Casual games, targets, clocks, inventories, private views, replay, history and requeue",
);
