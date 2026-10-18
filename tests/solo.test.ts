import test from "node:test";
import assert from "node:assert/strict";
import { RESOURCES, emptyHand } from "../lib/board";
import {
  addPlayer,
  applyAction,
  createGame,
  player,
  points,
  view,
  advanceClock,
} from "../lib/game";
import { chooseMove } from "./autoplay";

test("solo practice has one seat, classic supplies and an untimed ten-point preset", () => {
  const g = createGame("SOLO22", player("solo-owner", "Solo"), 1);
  assert.equal(g.mode, "solo");
  assert.equal(g.capacity, 1);
  assert.equal(g.target, 10);
  assert.equal(g.turnSeconds, 0);
  assert.equal(g.board.tiles.length, 19);
  assert.equal(g.bank.wood, 19);
  assert.throws(() => addPlayer(g, player("other", "Other")), /full/);
  assert.throws(() => createGame("BAD222", player("a", "A"), 2, false, "solo"));
  assert.throws(() => createGame("BAD222", player("a", "A"), 1, false, "base"));
  const before = structuredClone(g);
  assert.throws(() =>
    applyAction(g, 0, { type: "settings", capacity: 2, mode: "solo" }),
  );
  assert.deepEqual(g, before);
  applyAction(g, 0, { type: "start" });
  assert.equal(g.phase, "setupSettlement");
  assert.equal(g.deck.length, 25);
  assert.equal(g.deadline, null);
  const stored = structuredClone(g);
  advanceClock(g, Date.now() + 3600000);
  assert.deepEqual(g, stored, "Untimed solo games don't play themselves.");
  const watch = view(g, null);
  assert.equal(watch.me, -1);
  assert(!watch.players[0].hand && !watch.players[0].dev);
});

test("solo mode switching keeps multiplayer minimums and cannot displace joined players", () => {
  const g = createGame("MODE22", player("a", "A"), 1);
  applyAction(g, 0, { type: "settings", mode: "duel" });
  assert.equal(g.capacity, 2);
  assert.equal(g.target, 15);
  assert.throws(() => applyAction(g, 0, { type: "start" }), /Two players/);
  addPlayer(g, player("b", "B"));
  const before = structuredClone(g);
  assert.throws(() => applyAction(g, 0, { type: "settings", mode: "solo" }));
  assert.deepEqual(g, before);
  applyAction(g, 0, { type: "settings", mode: "base" });
  assert.equal(g.capacity, 4);
  assert.throws(() => applyAction(g, 0, { type: "start" }), /ready/);
  applyAction(g, 1, { type: "ready" });
  applyAction(g, 0, { type: "start" });
  assert.equal(g.phase, "setupSettlement");
});

test("solo sevens discard normally and robber/knights finish without an opponent", () => {
  const g = createGame("ROBB22", player("a", "A"), 1);
  applyAction(g, 0, { type: "start" });
  while (g.phase.startsWith("setup")) applyAction(g, 0, chooseMove(g)!);
  for (const r of RESOURCES) {
    g.bank[r] += g.players[0].hand[r];
    g.players[0].hand[r] = 0;
  }
  g.bank.wood -= 8;
  g.players[0].hand.wood = 8;
  const rolls = [0.34, 0.5];
  applyAction(g, 0, { type: "roll" }, () => rolls.shift()!);
  assert.equal(g.phase, "discard");
  assert.equal(g.discards[0], 4);
  applyAction(g, 0, {
    type: "discard",
    resources: { ...emptyHand(), wood: 4 },
  });
  assert.equal(g.phase, "robber");
  applyAction(g, 0, chooseMove(g)!);
  assert.equal(g.phase, "action");
  assert.deepEqual(g.victims, []);
  assert.throws(
    () =>
      applyAction(g, 0, {
        type: "offer",
        give: { ...emptyHand(), wood: 1 },
        want: { ...emptyHand(), ore: 1 },
      }),
    /partners/,
  );
  g.players[0].dev.push({ kind: "knight", bought: 0 });
  applyAction(g, 0, { type: "knight" });
  assert.equal(g.phase, "robber");
  applyAction(g, 0, chooseMove(g)!);
  assert.equal(g.phase, "action");
  assert.equal(g.players[0].knights, 1);
  assert.equal(g.bank.wood + g.players[0].hand.wood, 19);
});

for (const seed of [41, 93, 171])
  test(`solo practice reaches a natural default-target victory (${seed})`, () => {
    const g = createGame("WIN222", player("a", "A"), 1);
    applyAction(g, 0, { type: "start" });
    let state = seed,
      steps = 0;
    const random = () =>
      (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
    while (g.phase !== "finished" && steps < 5000) {
      const a = chooseMove(g, 0);
      assert(a, `Missing solo action at ${g.phase}`);
      applyAction(g, 0, a, random);
      for (const r of RESOURCES) {
        assert.equal(g.bank[r] + g.players[0].hand[r], 19);
        assert(g.bank[r] >= 0 && g.players[0].hand[r] >= 0);
      }
      assert.notEqual(g.phase, "steal");
      steps++;
    }
    assert.equal(g.phase, "finished");
    assert.equal(g.winner, 0);
    assert(points(g, 0) >= 10);
    console.log(
      `Solo ${seed}: ${steps} actions, ${g.turn} turns, ${points(g, 0)} points.`,
    );
  });
