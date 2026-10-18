import assert from "node:assert/strict";
import { test } from "node:test";
import { validTurnSeconds, turnTimerPreset, TURN_TIMER_PRESETS } from "../lib/turn-timer";
import { createGame, player, applyAction, addPlayer, advanceClock } from "../lib/game";
import { tradeCooldown } from "../lib/trading";
import { defaultRoomSetup, restoreRoomSetup } from "../lib/room-setup";
import { applyRoomCreationOptions } from "../lib/room-creation";

test("slider presets and custom durations are valid for all ordinary turn timers", () => {
  assert.deepEqual(TURN_TIMER_PRESETS.map(p => p.seconds), [30, 60, 120, 0]);
  for (const seconds of [0, 15, 30, 60, 73, 99, 120, 200, 240, 300]) assert(validTurnSeconds(seconds));
  for (const seconds of [-1, 1, 14, 301, 12000, 60.5, NaN, Infinity, "60", null]) assert.equal(validTurnSeconds(seconds), false);
  assert.equal(turnTimerPreset(0), 3); assert.equal(turnTimerPreset(30), 0);
  assert.equal(turnTimerPreset(73), 1); assert.equal(turnTimerPreset(200), 2);
});

test("custom seconds survive a saved draft, room creation, and the setup clock", () => {
  const draft = restoreRoomSetup(JSON.stringify({ ...defaultRoomSetup(), turnSeconds: 73 }));
  assert.equal(draft.turnSeconds, 73);
  const g = createGame("ABC234", player("host", "Host"), 2);
  applyRoomCreationOptions(g, { turnSeconds: draft.turnSeconds });
  addPlayer(g, player("guest", "Guest")); g.players.forEach(p => p.ready = true);
  applyAction(g, 0, { type: "start" }, Math.random, 1000);
  assert.equal(g.turnSeconds, 73);
  assert.equal(g.deadline, 1000 + 146000);
});

test("lobby edits validate custom timers without changing automatic-roll rules", () => {
  const g = createGame("ABC234", player("host", "Host"));
  applyAction(g, 0, { type: "settings", turnSeconds: 73 });
  assert.equal(g.turnSeconds, 73);
  assert.throws(() => applyAction(g, 0, { type: "settings", turnSeconds: 73.5 }), /available turn timer/);
  const rush = createGame("DEF567", player("host", "Host"), 4, false, "rush");
  assert.throws(() => applyAction(rush, 0, { type: "settings", turnSeconds: 73 }), /available turn timer/);
});

test("every phase and trade response gets a finite custom deadline", () => {
  for (const seconds of [15, 31, 73, 99, 121, 200, 300]) {
    for (const phase of ["setupSettlement", "setupRoad", "roll", "action", "robber", "steal", "roadBuilding", "special"] as const) {
      const g = createGame("ABC234", player("host", "Host"), 2);
      addPlayer(g, player("guest", "Guest"));
      g.turnSeconds = seconds; g.phase = phase; g.deadline = null; g.clockKey = null;
      advanceClock(g, 1000);
      assert(Number.isFinite(g.deadline), `${phase} at ${seconds} seconds`);
      assert(g.deadline! > 1000);
    }
    assert(Number.isFinite(tradeCooldown(seconds)));
    assert(tradeCooldown(seconds) > 0);
  }
});
