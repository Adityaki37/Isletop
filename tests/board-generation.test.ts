import test from "node:test";
import assert from "node:assert/strict";
import { makeBaseBoard, BASE_MAPS, baseMapAvailable } from "../lib/base-maps";
import { Board } from "../lib/board";
import { makeSeafarersBoard } from "../lib/seafarers";
import { SEAFARERS_SCENARIOS } from "../lib/scenarios";
import {
  createGame,
  player,
  addPlayer,
  applyAction,
  refreshLobbyBoard,
  normalizeGame,
} from "../lib/game";
function rng(seed: number) {
  return () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const signature = (b: Board) =>
  JSON.stringify([b.tiles.map((t) => [t.resource, t.number]), b.ports]);
function valid(b: Board) {
  assert(
    b.tiles.every(
      (t) =>
        Number.isInteger(t.number) &&
        (!t.number || [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].includes(t.number)),
    ),
  );
  assert(
    !b.edges.some(
      (e) =>
        e.tiles.length === 2 &&
        e.tiles.every((id) => [6, 8].includes(b.tiles[id].number)),
    ),
    "6/8 tokens must not touch",
  );
  assert(
    b.tiles.every(
      (t) =>
        (t.resource !== "sea" && t.resource !== "desert" && !t.fog) ||
        t.number === 0,
    ),
  );
  assert.equal(new Set(b.ports.map((p) => p.edge)).size, b.ports.length);
}
test("fresh randomized boards retain every Base size and resource/token inventory", () => {
  for (let n = 1; n <= 8; n++)
    for (const map of ["base", "baseRandom"] as const) {
      const samples = new Set<string>();
      let inventory: string | undefined;
      for (let seed = 1; seed <= 100; seed++) {
        const b = makeBaseBoard(n, map, rng(seed));
        valid(b);
        assert.equal(b.tiles.length, n <= 4 ? 19 : n <= 6 ? 30 : 37);
        const counts = JSON.stringify([
          b.tiles.map((t) => t.resource).sort(),
          b.tiles.map((t) => t.number).sort(),
          b.ports.map((p) => p.resource).sort(),
        ]);
        inventory ??= counts;
        assert.equal(counts, inventory);
        samples.add(signature(b));
      }
      assert.equal(samples.size, 100);
    }
});
test("all Seafarers player-count variants randomize without moving scenario geography", () => {
  for (const scenario of SEAFARERS_SCENARIOS)
    for (const n of [3, 4, 5, 6]) {
      const initial = makeSeafarersBoard(n, scenario, rng(1)),
        samples = new Set<string>();
      for (let seed = 1; seed <= 100; seed++) {
        const b = makeSeafarersBoard(n, scenario, rng(seed));
        valid(b);
        samples.add(signature(b));
        assert.deepEqual(
          b.tiles.map((t) => [
            t.q,
            t.r,
            t.home,
            t.island,
            t.fog,
            t.resource === "sea",
            t.resource === "desert",
            t.resource === "gold",
          ]),
          initial.tiles.map((t) => [
            t.q,
            t.r,
            t.home,
            t.island,
            t.fog,
            t.resource === "sea",
            t.resource === "desert",
            t.resource === "gold",
          ]),
        );
        assert.deepEqual(
          b.tiles.map((t) => t.resource).sort(),
          initial.tiles.map((t) => t.resource).sort(),
        );
        assert.deepEqual(
          b.tiles.map((t) => t.number).sort(),
          initial.tiles.map((t) => t.number).sort(),
        );
        assert.deepEqual(
          b.ports.map((p) => p.edge),
          initial.ports.map((p) => p.edge),
        );
        assert.equal(b.robber, initial.robber);
        assert.equal(b.pirate, initial.pirate);
      }
      assert.equal(samples.size, 100);
    }
});
test("custom maps also receive fresh contents while preserving their island footprint", () => {
  for (const map of BASE_MAPS.filter(
    (m) => m !== "base" && m !== "baseRandom",
  )) {
    const first = makeBaseBoard(4, map, rng(1));
    const samples = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const b = makeBaseBoard(4, map, rng(seed));
      valid(b);
      samples.add(signature(b));
      assert.deepEqual(
        b.tiles.map((t) => [
          t.q,
          t.r,
          t.fog,
          t.resource === "sea",
          t.resource === "desert",
          t.resource === "gold",
        ]),
        first.tiles.map((t) => [
          t.q,
          t.r,
          t.fog,
          t.resource === "sea",
          t.resource === "desert",
          t.resource === "gold",
        ]),
      );
    }
    assert.equal(samples.size, 20);
  }
});
test("room capacity is a seat limit; actual players determine board, bank, deck and special building", () => {
  for (let n = 2; n <= 8; n++)
    for (let capacity = n; capacity <= 8; capacity++) {
      const g = createGame(
        "BOARD2",
        player("0", "Host"),
        capacity,
        false,
        "base",
      );
      for (let p = 1; p < n; p++) addPlayer(g, player(String(p), "Seat " + p));
      g.players.forEach((p) => (p.ready = true));
      const preview = signature(g.board);
      applyAction(g, 0, { type: "start" });
      assert.notEqual(signature(g.board), preview);
      assert.equal(g.capacity, capacity);
      assert.equal(g.boardPlayers, n);
      assert.equal(g.board.tiles.length, n <= 4 ? 19 : n <= 6 ? 30 : 37);
      assert.equal(g.deck.length, n <= 4 ? 25 : n <= 6 ? 34 : 43);
      assert(
        Object.values(g.bank).every(
          (v) => v === (n <= 4 ? 19 : n <= 6 ? 24 : 29),
        ),
      );
    }
});
test("joins/removals change size at thresholds, reset readiness and keep unchanged previews stable", () => {
  const g = createGame("BOARD2", player("0", "Host"), 8, false, "base");
  let previous = signature(g.board);
  for (let p = 1; p < 8; p++) {
    g.players.forEach((x) => (x.ready = true));
    addPlayer(g, player(String(p), "Seat " + p));
    const n = p + 1;
    assert.equal(g.board.tiles.length, n <= 4 ? 19 : n <= 6 ? 30 : 37);
    if (n === 5 || n === 7) {
      assert.notEqual(signature(g.board), previous);
      assert(g.players.every((x) => !x.ready));
    } else assert.equal(signature(g.board), previous);
    previous = signature(g.board);
  }
  applyAction(g, 0, { type: "remove", id: 7 });
  assert.equal(g.board.tiles.length, 37);
  applyAction(g, 0, { type: "remove", id: 6 });
  assert.equal(g.board.tiles.length, 30);
  applyAction(g, 0, { type: "remove", id: 5 });
  applyAction(g, 0, { type: "remove", id: 4 });
  assert.equal(g.board.tiles.length, 19);
});
test("Cities & Knights and combined scenarios size from seated players, including fog contents", () => {
  for (const mode of [
    "citiesKnights",
    "seafarers",
    "seafarersCitiesKnights",
  ] as const)
    for (const n of [3, 4, 5, 6]) {
      const g = createGame(
        "BOARD2",
        player("0", "Host"),
        6,
        false,
        mode,
        mode === "citiesKnights" ? "newShores" : "fogIslands",
      );
      // Standalone Cities & Knights does not use a Seafarers scenario.
      for (let p = 1; p < n; p++) addPlayer(g, player(String(p), "Seat " + p));
      g.players.forEach((p) => (p.ready = true));
      applyAction(g, 0, { type: "start" });
      assert.equal(g.boardPlayers, n);
      if (mode === "citiesKnights")
        assert.equal(g.board.tiles.length, n <= 4 ? 19 : 30);
      else {
        assert.equal(
          g.board.tiles.filter((t) => t.fog).length,
          n <= 4 ? 12 : 25,
        );
        assert.equal(g.fogDeck.length, n <= 4 ? 12 : 25);
      }
      assert.equal(g.bank.wood, n <= 4 ? 19 : 24);
    }
});
test("rematch preview reshuffles, and normalization preserves an existing active board", () => {
  const g = createGame("BOARD2", player("0", "Host"), 8, false, "base");
  for (let p = 1; p < 4; p++) addPlayer(g, player(String(p), "Seat " + p));
  const before = signature(g.board);
  refreshLobbyBoard(g);
  assert.notEqual(signature(g.board), before);
  g.players.forEach((p) => (p.ready = true));
  applyAction(g, 0, { type: "start" });
  const started = signature(g.board);
  refreshLobbyBoard(g);
  normalizeGame(g);
  assert.equal(signature(g.board), started);
  const legacy = structuredClone(g);
  delete (legacy as Partial<typeof g>).boardPlayers;
  normalizeGame(legacy);
  assert.equal(legacy.boardPlayers, legacy.capacity);
  assert.equal(signature(legacy.board), started);
  assert(baseMapAvailable("baseRandom", "base", 8));
  assert(baseMapAvailable("baseRandom", "citiesKnights", 6));
});
