import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  player,
  addPlayer,
  applyAction,
  actor,
  view,
  normalizeGame,
  advanceClock,
  type Game,
} from "../lib/game";
import { seatsInTurnOrder, seatsAfter } from "../lib/turn-order";
import { chooseMove } from "./autoplay";
import { replayState } from "../lib/match-replay";
import { applyRoomOperation } from "../lib/room-operation";
function lobby(n = 4, mode: "base" | "rush" = "base") {
  const g = createGame("ORDER2", player("host", "Host"), n, false, mode);
  for (let i = 1; i < n; i++) {
    addPlayer(g, player("p" + i, "Player " + i));
  }
  g.players.forEach((p) => {
    p.ready = true;
  });
  return g;
}
function setup(g: Game) {
  const visits: number[] = [];
  while (g.phase.startsWith("setup")) {
    if (g.phase === "setupSettlement") visits.push(actor(g));
    applyAction(g, actor(g), chooseMove(g)!);
  }
  return visits;
}
test("random order chooses the starter, keeps identities and follows snake setup and regular turns", () => {
  const g = lobby(),
    identities = g.players.map((p) => ({ id: p.id, color: p.color }));
  applyAction(g, 0, { type: "start" }, () => 0);
  assert.deepEqual(g.turnOrder, [1, 2, 3, 0]);
  assert.equal(g.active, 1);
  assert(g.log.includes("Turn order: Player 1 → Player 2 → Player 3 → Host."));
  assert.deepEqual(
    g.players.map((p) => ({ id: p.id, color: p.color })),
    identities,
  );
  assert.deepEqual(setup(g), [1, 2, 3, 0, 0, 3, 2, 1]);
  assert.equal(g.active, 1);
  for (const expected of [2, 3, 0, 1]) {
    g.phase = "action";
    applyAction(g, g.active, { type: "end" });
    assert.equal(g.active, expected);
  }
  assert.equal(view(g, "host").me, 0);
  assert.deepEqual(seatsInTurnOrder(view(g, null)), [1, 2, 3, 0]);
  const saved = structuredClone(g);
  normalizeGame(saved);
  assert.deepEqual(saved.turnOrder, g.turnOrder);
  assert.deepEqual(replayState(saved).turnOrder, g.turnOrder);
});
test("rematch clears the previous order and the next start shuffles again", () => {
  const g = lobby();
  applyAction(g, 0, { type: "start" }, () => 0);
  g.phase = "finished";
  applyRoomOperation(
    g,
    { id: "host", aliases: [], account: null },
    { op: "rematch" },
    "player",
  );
  assert.equal(g.phase, "lobby");
  assert.equal(g.turnOrder, undefined);
  assert.equal(view(g, "host").turnOrder, undefined);
  assert.deepEqual(seatsInTurnOrder(g), [0, 1, 2, 3]);
  g.players.forEach(p => { p.ready = true; });
  applyAction(g, 0, { type: "start" }, () => 0.5);
  assert.deepEqual(g.turnOrder, [0, 3, 1, 2]);
  assert.equal(g.active, g.turnOrder![0]);
  assert(g.log.includes("Turn order: Host → Player 3 → Player 1 → Player 2."));
});
test("expanded tables use the same random order for setup and special building", () => {
  for (const n of [2, 6, 12]) {
    const g = lobby(n);
    applyAction(g, 0, { type: "start" }, () => 0);
    const order = seatsInTurnOrder(g);
    assert.deepEqual(setup(g), [...order, ...order.toReversed()]);
    assert.equal(g.active, order[0]);
  }
  const g = lobby(6);
  applyAction(g, 0, { type: "start" }, () => 0);
  setup(g);
  g.phase = "action";
  for (const p of [0, 5])
    applyAction(g, p, { type: "specialBuild", requested: true });
  applyAction(g, 1, { type: "end" });
  assert.equal(actor(g), 5);
  applyAction(g, 5, { type: "pass" });
  assert.equal(actor(g), 0);
  applyAction(g, 0, { type: "pass" });
  assert.equal(g.active, 2);
});
test("rush starts its robber rotation in randomized player order", () => {
  const g = lobby(4, "rush");
  applyAction(g, 0, { type: "start" }, () => 0, 1000);
  setup(g);
  assert.equal(g.rush!.nextRobber, 1);
  assert.deepEqual(seatsAfter(g, 1), [2, 3, 0]);
  let die = 0;
  advanceClock(g, g.rush!.rollAt!, () => (die++ % 2 ? 0.5 : 0.34));
  assert.deepEqual(g.dice, [3, 4]);
  assert.equal(g.rush!.robberOwner, 1);
  assert.equal(g.rush!.nextRobber, 2);
});
test("old saves retain their existing order and different shuffles can choose another starter", () => {
  const g = lobby();
  g.phase = "action";
  g.active = 2;
  normalizeGame(g);
  assert.deepEqual(seatsInTurnOrder(g), [0, 1, 2, 3]);
  applyAction(g, 2, { type: "end" });
  assert.equal(g.active, 3);
  const fresh = lobby();
  applyAction(fresh, 0, { type: "start" }, () => 0.999);
  assert.deepEqual(fresh.turnOrder, [0, 1, 2, 3]);
  assert.equal(fresh.active, 0);
  assert.deepEqual(
    seatsInTurnOrder({ ...fresh, turnOrder: [0, 0, 2, 3] }),
    [0, 1, 2, 3],
  );
});
