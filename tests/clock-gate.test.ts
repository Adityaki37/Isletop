import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  player,
  addPlayer,
  advanceClock,
  needsClockAdvance,
  type Game,
} from "../lib/game";

function game(mode: Game["mode"] = "base") {
  const g = createGame(
    "ABCDE2",
    player("clock-gate-host", "Host"),
    4,
    false,
    mode,
  );
  addPlayer(g, player("clock-gate-guest", "Guest"));
  addPlayer(g, player("clock-gate-third", "Third"));
  return g;
}
test("the fast gate only skips maintenance when advancing is a no-op", () => {
  for (const mode of [
    "base",
    "seafarers",
    "citiesKnights",
    "seafarersCitiesKnights",
  ] as const) {
    const g = game(mode);
    assert.equal(needsClockAdvance(g), false);
    applyAction(g, 0, { type: "ready" });
    applyAction(g, 1, { type: "ready" });
    applyAction(g, 2, { type: "ready" });
    applyAction(g, 0, { type: "start" });
    const now = Date.now(),
      before = JSON.stringify(g);
    assert.equal(needsClockAdvance(g, now), false);
    advanceClock(g, now, () => {
      throw Error("Gate must never skip random maintenance");
    });
    assert.equal(JSON.stringify(g), before);
    assert.equal(
      needsClockAdvance(g, g.deadline!),
      true,
      "expired setup must use separate commit",
    );
    g.deadline = null;
    assert.equal(
      needsClockAdvance(g, now),
      true,
      "legacy clock initialization",
    );
  }
});
test("indefinite pauses stay frozen while vote expiry and other clocks retain maintenance", () => {
  const g = game();
  g.pause.pausedAt = 100;
  g.pause.until = 200;
  assert.equal(needsClockAdvance(g, 150), false);
  assert.equal(needsClockAdvance(g, 200), false);
  g.pause.pausedAt = null;
  g.pause.until = null;
  g.pause.vote = {
    id: 1,
    target: "pause",
    endsAt: 200,
    accepted: [],
    creator: 0,
  };
  assert.equal(needsClockAdvance(g, 200), true);
  g.pause.vote = null;
  g.offers = [{} as Game["offers"][number]];
  assert.equal(needsClockAdvance(g), true);
  g.offers = [];
  const rapid = game("rush");
  for (let i = 0; i < 3; i++) applyAction(rapid, i, { type: "ready" });
  applyAction(rapid, 0, { type: "start" });
  assert.equal(needsClockAdvance(rapid), true);
  g.phase = "finished";
  g.deadline = 999;
  assert.equal(needsClockAdvance(g, 100), true);
});
