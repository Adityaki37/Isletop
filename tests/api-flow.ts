import assert from "node:assert/strict";
import { Action, Game, View, actor } from "../lib/game";
import { emptyHand } from "../lib/board";
import { chooseMove } from "./autoplay";
import { scenarioTarget } from "../lib/scenarios";
const base = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
const selectedMap = process.env.TEST_BASE_MAP;
assert(!selectedMap || ["base", "baseRandom"].includes(selectedMap));
class Session {
  cookie = "";
  async request(body: Record<string, unknown> | null, code?: string) {
    const response = await fetch(
      `${base}/api/rooms${body ? "" : code ? `?code=${code}` : ""}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          ...(this.cookie ? { Cookie: this.cookie } : {}),
          ...(body ? { "Content-Type": "application/json", Origin: base } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    const cookie = response.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    const data = (await response.json()) as {
      game: View;
      rooms: { code: string }[];
      games: { code: string; title: string; turnSeconds: number }[];
      error?: string;
    };
    return { status: response.status, ...data };
  }
  async move(code: string, action: Action, nonce = crypto.randomUUID()) {
    const result = await this.request({ op: "action", code, action, nonce });
    assert.equal(result.status, 200, `${action.type}: ${result.error}`);
    return result.game;
  }
}
for (const [n, mode, scenario] of [
  [2, "duel", "newShores"],
  [4, "base", "newShores"],
  [8, "base", "newShores"],
  [4, "seafarers", "newShores"],
  [6, "seafarers", "newShores"],
  [4, "seafarers", "fourIslands"],
  [6, "seafarers", "fourIslands"],
  [4, "seafarers", "throughDesert"],
  [6, "seafarers", "throughDesert"],
  [3, "seafarers", "fogIslands"],
  [4, "seafarers", "fogIslands"],
  [6, "seafarers", "fogIslands"],
] as const) {
  if (selectedMap && mode !== "base") continue;
  if (process.env.TEST_GAME_MODE && process.env.TEST_GAME_MODE !== mode)
    continue;
  if (process.env.TEST_SCENARIO && process.env.TEST_SCENARIO !== scenario)
    continue;
  const seats = Array.from({ length: n }, () => new Session());
  const spectator = new Session();
  let made = await seats[0].request({
    op: "create",
    name: `QA Host ${n}`,
    capacity:
      mode === "seafarers"
        ? Number(process.env.TEST_SEAFARERS_CAPACITY ?? n)
        : n,
    public: true,
    mode,
    ...(selectedMap ? { map: selectedMap } : {}),
    ...(mode === "seafarers" ? { scenario } : {}),
  });
  assert.equal(made.status, 200, made.error);
  let g = made.game,
    code = g.code;
  assert.equal(g.mode, mode);
  assert.equal(g.map, selectedMap ?? "base");
  assert.equal(g.scenario, scenario);
  assert(!("fogDeck" in g) && !("fogNumbers" in g));
  if (mode === "seafarers") assert.equal(g.target, scenarioTarget(scenario));
  assert.equal(g.diceMode, n === 2 ? "balanced" : "random");
  assert(!("diceState" in g), "Future dice must remain private.");
  assert((await spectator.request(null)).rooms.some((r) => r.code === code));
  for (let i = 1; i < n; i++) {
    const r = await seats[i].request({
      op: "join",
      code,
      name: `QA Player ${i}`,
    });
    assert.equal(r.status, 200, r.error);
  }
  for (let i = 1; i < n; i++) await seats[i].move(code, { type: "ready" });
  const snap = await spectator.request(null, code);
  assert.equal(snap.game.me, -1);
  assert(snap.game.players.every((p) => !p.hand && !p.dev));
  assert(!("fogDeck" in snap.game) && !("fogNumbers" in snap.game));
  assert(
    !(
      await spectator.request({
        op: "action",
        code,
        nonce: crypto.randomUUID(),
        action: { type: "start" },
      })
    ).game,
  );
  g = await seats[0].move(code, { type: "start" });
  assert.equal(g.boardPlayers, n);
  const directory = await spectator.request(null);
  assert(!directory.rooms.some((room) => room.code === code));
  assert(directory.games.some((room) => room.code === code));
  assert(
    directory.games.every(
      (room) =>
        !("playersState" in room) && !("bank" in room) && !("board" in room),
    ),
  );
  const illegal = await seats[1].request({
    op: "action",
    code,
    nonce: crypto.randomUUID(),
    action: { type: "roll" },
  });
  assert.equal(illegal.status, 400);
  let steps = 0;
  while (g.phase !== "finished" && steps < 5000) {
    const p =
      g.phase === "discard"
        ? Number(Object.keys(g.discards)[0])
        : g.phase === "gold"
          ? Number(Object.keys(g.goldClaims)[0])
          : actor(g as unknown as Game);
    const mine = (await seats[p].request(null, code)).game;
    assert.equal(mine.me, p);
    const proxy = {
      ...mine,
      players: mine.players.map((pl) => ({
        ...pl,
        id: "test-only",
        hand: pl.hand ?? { ...emptyHand(), wood: pl.resources },
        dev: pl.dev ?? [],
      })),
      deck: Array(mine.deckCount).fill("knight"),
      receipts: [],
    } as unknown as Game;
    const move = chooseMove(proxy, p);
    assert(move, `No action for ${mine.phase}`);
    const nonce = crypto.randomUUID();
    g = await seats[p].move(code, move!, nonce);
    if (steps === 0) {
      const again = await seats[p].move(code, move!, nonce);
      assert.deepEqual(
        again.board,
        g.board,
        "Duplicate request must not apply twice.",
      );
    }
    if (steps % 40 === 0) {
      const watch = (await spectator.request(null, code)).game;
      assert.equal(watch.revision, g.revision);
      assert(watch.players.every((pl) => !pl.hand));
      assert(!("diceState" in watch));
      const returning = (
        await seats[p].request({
          op: "join",
          code,
          name: "Ignored renamed user",
        })
      ).game;
      assert.equal(
        returning.players[p].name,
        mine.players[p].name,
        "Rejoin must keep seat identity.",
      );
    }
    steps++;
  }
  assert.equal(
    g.phase,
    "finished",
    `${n}-player online match stalled at ${g.phase} / turn ${g.turn}`,
  );
  assert(g.players[g.winner!].score >= g.target);
  assert(
    g.players.every((p) => Array.isArray(p.dev)),
    "Victory cards revealed after finish.",
  );
  const rematch = await seats[0].request({ op: "rematch", code });
  assert.equal(rematch.status, 200, rematch.error);
  assert.equal(rematch.game.phase, "lobby");
  assert.equal(rematch.game.players.length, n);
  assert(rematch.game.players.every((p) => p.score === 0));
  assert.equal(rematch.game.mode, g.mode);
  assert.equal(rematch.game.scenario, g.scenario);
  assert.equal(rematch.game.map, g.map);
  assert.equal(rematch.game.boardPlayers, n);
  assert.notDeepEqual(
    rematch.game.board.tiles.map((t) => [t.resource, t.number]),
    g.board.tiles.map((t) => [t.resource, t.number]),
    "Rematches randomize scenario contents",
  );
  assert(!("fogDeck" in rematch.game) && !("fogNumbers" in rematch.game));
  if (scenario === "fogIslands") {
    assert(g.board.tiles.filter((t) => t.fog).length < (n > 4 ? 25 : 12));
    assert.equal(
      rematch.game.board.tiles.filter((t) => t.fog).length,
      n > 4 ? 25 : 12,
    );
    assert(g.players.every((p) => p.islandBonus === 0));
  }
  assert.equal(rematch.game.target, g.target);
  assert.equal(rematch.game.diceMode, g.diceMode);
  assert(!("diceState" in rematch.game));
  if (n === 2) {
    await seats[1].move(code, { type: "ready" });
    await seats[0].move(code, { type: "start" });
    const resigned = await seats[1].move(code, { type: "resign" });
    assert.equal(resigned.phase, "finished");
    assert.equal(resigned.winner, 0);
    assert.equal(resigned.resignedBy, 1);
    assert.equal((await spectator.request(null, code)).game.resignedBy, 1);
    const reset = await seats[0].request({ op: "rematch", code });
    assert.equal(reset.game.resignedBy, null);
    assert.equal(reset.game.winner, null);
    assert.equal(reset.game.target, 15);
  }
  await seats[0].move(code, { type: "settings", public: false });
  for (let i = n - 1; i >= 1; i--)
    await seats[i].request({ op: "leave", code });
  await seats[0].request({ op: "leave", code });
  console.log(
    `PASS: ${mode} ${scenario} / ${n} independent sessions, private hands, illegal moves, duplicate-request protection, reconnects, ${steps} online actions, winner, and rematch.`,
  );
}
// Two moves from one seat race against the same authoritative revision.
const host = new Session();
let room = (
  await host.request({ op: "create", name: "Race test", capacity: 3 })
).game;
const rivals = [new Session(), new Session()];
for (let i = 0; i < 2; i++) {
  await rivals[i].request({ op: "join", code: room.code, name: `Race ${i}` });
  await rivals[i].move(room.code, { type: "ready" });
}
room = await host.move(room.code, { type: "start" });
const id = room.legal.settlement[0];
const results = await Promise.all([
  host.request({
    op: "action",
    code: room.code,
    action: { type: "settlement", id },
    nonce: crypto.randomUUID(),
  }),
  host.request({
    op: "action",
    code: room.code,
    action: { type: "settlement", id },
    nonce: crypto.randomUUID(),
  }),
]);
assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
const stored = (await host.request(null, room.code)).game;
assert.equal(stored.board.vertices.filter((v) => v.owner === 0).length, 1);
console.log(
  "PASS: concurrent moves save once and reject the stale illegal move.",
);

// Custom-room controls persist across sessions, and clocks survive late invalid requests.
const timedSeats = [new Session(), new Session(), new Session()];
let timed = (
  await timedSeats[0].request({ op: "create", name: "Timer Host", capacity: 3 })
).game;
for (let i = 1; i < 3; i++) {
  await timedSeats[i].request({
    op: "join",
    code: timed.code,
    name: `Timer ${i}`,
  });
  await timedSeats[i].move(timed.code, { type: "ready" });
}
timed = await timedSeats[0].move(timed.code, {
  type: "settings",
  turnSeconds: 30,
  discardLimit: 9,
  friendlyRobber: true,
  hideBank: true,
  target: 12,
  text: "Custom timer room",
});
assert(timed.players.every((p) => !p.ready));
const denied = await timedSeats[1].request({
  op: "action",
  code: timed.code,
  nonce: crypto.randomUUID(),
  action: { type: "settings", turnSeconds: 0 },
});
assert.equal(denied.status, 400);
await timedSeats[1].move(timed.code, { type: "color", color: 7 });
const collision = await timedSeats[2].request({
  op: "action",
  code: timed.code,
  nonce: crypto.randomUUID(),
  action: { type: "color", color: 7 },
});
assert.equal(collision.status, 400);
for (let i = 1; i < 3; i++)
  await timedSeats[i].move(timed.code, { type: "ready" });
timed = await timedSeats[0].move(timed.code, { type: "start" });
const timerSpectator = new Session();
assert.equal((await timerSpectator.request(null, timed.code)).game.bank, null);
while (timed.phase.startsWith("setup")) {
  const p = timed.active;
  const mine = (await timedSeats[p].request(null, timed.code)).game;
  timed = await timedSeats[p].move(
    timed.code,
    mine.phase === "setupSettlement"
      ? { type: "settlement", id: mine.legal.settlement[0] }
      : { type: "road", id: mine.legal.road[0] },
  );
}
assert.equal(timed.phase, "roll");
assert.equal(timed.players[1].color, 7);
const oldContext = `${timed.turn}:${timed.phase}:${timed.active}:${timed.specialPlayer ?? "-"}:${timed.setupStep}`;
// Wait for the actual ten-second dice deadline; no test-only server controls.
await new Promise((resolve) =>
  setTimeout(resolve, Math.max(0, timed.deadline! - Date.now()) + 200),
);
const late = await timedSeats[1].request({
  op: "action",
  code: timed.code,
  nonce: crypto.randomUUID(),
  context: oldContext,
  action: { type: "road", id: 0 },
});
assert.equal(late.status, 400);
const advanced = (await timedSeats[0].request(null, timed.code)).game;
assert.equal(
  advanced.dice.length,
  2,
  "Invalid late move must not roll back the automatic dice roll.",
);
assert.equal(advanced.revision, timed.revision + 1);
assert.equal(
  (await timerSpectator.request(null, timed.code)).game.revision,
  advanced.revision,
);
assert.equal(advanced.bank, null);
assert(
  !(await timerSpectator.request(null)).games.some(
    (room) => room.code === timed.code,
  ),
);
console.log(
  "PASS: custom settings, ready reset, host authority, unique colors, hidden bank, real timer expiry, and stale-click protection.",
);
