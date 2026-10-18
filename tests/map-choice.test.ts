import test from "node:test";
import assert from "node:assert/strict";
import { createGame, player } from "../lib/game";
import { matchedGame, MATCHMAKING_QUEUES, matchmakingMap } from "../lib/matchmaking";
import { BASE_MAPS, baseMapAvailable } from "../lib/base-maps";

test("every matchmaking preset defaults to a randomized map and validates supported maps", () => {
  for (const queue of Object.keys(MATCHMAKING_QUEUES) as (keyof typeof MATCHMAKING_QUEUES)[]) {
    const preset = MATCHMAKING_QUEUES[queue];
    assert.equal(matchmakingMap(queue), "baseRandom");
    for (const map of BASE_MAPS) {
      if (baseMapAvailable(map, preset.mode, preset.players)) assert.equal(matchmakingMap(queue, map), map);
      else assert.throws(() => matchmakingMap(queue, map), /available map/);
    }
    for (const invalid of ["not-a-map", null, {}, 2]) assert.throws(() => matchmakingMap(queue, invalid));
  }
});
test("selected maps survive game start and replay capture; explicit Base overrides the randomized default", () => {
  const seats = Array.from({ length: 4 }, (_, i) => ({ id: `map-${i}`, name: `Map ${i}`, color: i }));
  for (const map of BASE_MAPS) {
    const { game, replay } = matchedGame("MAPSEL", "base4", seats, Date.now(), undefined, map);
    assert.equal(game.map, map);
    assert.equal(replay.initial?.map, map);
    assert.equal(game.phase, "setupSettlement");
  }
  assert.equal(matchedGame("MAPRND", "base4", seats).game.map, "baseRandom");
  for (const [mode, capacity] of [["base", 4], ["solo", 1], ["duel", 2], ["rush", 4], ["citiesKnights", 4]] as const) {
    assert.equal(createGame("MAPDEF", player("host", "Host"), capacity, false, mode).map, "baseRandom");
    assert.equal(createGame("MAPBAS", player("host", "Host"), capacity, false, mode, undefined, "base").map, "base");
  }
  assert.equal(createGame("MAPSEA", player("host", "Host"), 4, false, "seafarers").map, "base");
});
