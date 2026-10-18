import test from "node:test";
import assert from "node:assert/strict";
import { RESOURCES } from "../lib/board";
import { FIXED_FUN_MAPS, type FixedFunMap } from "../lib/fun-maps";
import { baseMapAvailable, makeBaseBoard } from "../lib/base-maps";
import {
  addPlayer,
  applyAction,
  actor,
  bankRate,
  createGame,
  legalRoads,
  legalRobberTiles,
  legalSettlements,
  normalizeGame,
  player,
  points,
  view,
} from "../lib/game";
import { chooseMove } from "./autoplay";
import { chooseLegalCitiesMove, citiesMatchActor } from "./cities-match-driver";
import { assertCitiesInventory } from "./cities-match-inventory";
import { assertStatistics } from "./statistics-assertions";
const maps = ["diamond", "pond", "gear", "twirl"] as const;
for (const map of maps)
  test(`${map}: connected land, enclosed lakes and distinct coastal ports`, () => {
    const b = makeBaseBoard(4, map),
      meta = FIXED_FUN_MAPS[map];
    const land = b.tiles.filter((t) => t.resource !== "sea");
    assert.equal(land.length, meta.land);
    assert.equal(b.ports.length, meta.ports);
    assert.equal(new Set(b.ports.map((p) => p.edge)).size, meta.ports);
    assert.equal(
      new Set(b.ports.flatMap((p) => [b.edges[p.edge].a, b.edges[p.edge].b]))
        .size,
      meta.ports * 2,
    );
    assert.equal(b.tiles[b.robber].resource, "desert");
    const connected = (start: number, water: boolean) => {
      const seen = new Set<number>(),
        todo = [start];
      while (todo.length) {
        const id = todo.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const e of b.edges.filter((e) => e.tiles.includes(id)))
          todo.push(
            ...e.tiles.filter(
              (n) => !seen.has(n) && (b.tiles[n].resource === "sea") === water,
            ),
          );
      }
      return seen;
    };
    assert.equal(connected(b.robber, false).size, meta.land);
    const seen = new Set<number>();
    let lakes = 0;
    for (const t of b.tiles.filter((t) => t.resource === "sea"))
      if (!seen.has(t.id)) {
        const lake = connected(t.id, true);
        lake.forEach((id) => seen.add(id));
        lakes++;
        assert(
          b.edges
            .filter((e) => e.tiles.some((id) => lake.has(id)))
            .every((e) => e.tiles.length === 2),
          "lake touches outside coast",
        );
      }
    assert.equal(lakes, meta.lakes);
    for (const p of b.ports) {
      const e = b.edges[p.edge];
      assert(e.tiles.some((id) => b.tiles[id].resource !== "sea"));
      assert(
        e.tiles.length === 1 ||
          e.tiles.some((id) => b.tiles[id].resource === "sea"),
      );
    }
    assert(
      b.vertices.every(
        (v) =>
          v.x >= 100 &&
          v.x <= b.width - 100 &&
          v.y >= 100 &&
          v.y <= b.height - 100,
      ),
    );
  });
test("fun map catalog supports only the listed modes and player extensions", () => {
  for (const map of maps)
    for (const mode of [
      "base",
      "citiesKnights",
      "duel",
      "solo",
      "rush",
      "seafarers",
      "seafarersCitiesKnights",
    ])
      for (let n = 2; n <= 8; n++) {
        const expected =
          ["base", "citiesKnights"].includes(mode) &&
          n >= (mode === "citiesKnights" ? 3 : 2) &&
          n <=
            Math.min(
              FIXED_FUN_MAPS[map].maxPlayers,
              mode === "citiesKnights" ? 6 : 8,
            );
        assert.equal(
          baseMapAvailable(map, mode, n),
          expected,
          `${map}/${mode}/${n}`,
        );
      }
});
for (const map of maps)
  test(`${map}: land-only building, robber and usable harbor rates`, () => {
    const g = createGame(
      "FUNMAP",
      player("a", "A"),
      4,
      false,
      "base",
      "newShores",
      map,
    );
    const b = g.board;
    assert(
      legalSettlements(g, 0, true).every((id) =>
        b.vertices[id].tiles.some((t) => b.tiles[t].resource !== "sea"),
      ),
    );
    assert(legalRobberTiles(g).every((id) => b.tiles[id].resource !== "sea"));
    for (const e of b.edges.filter((e) =>
      e.tiles.every((id) => b.tiles[id].resource === "sea"),
    )) {
      g.setupVertex = e.a;
      assert(!legalRoads(g, 0, true).includes(e.id));
      b.vertices[e.a].owner = 0;
      assert(!legalRoads(g, 0).includes(e.id));
      b.vertices[e.a].owner = null;
    }
    for (const port of b.ports) {
      const v = b.vertices[b.edges[port.edge].a];
      v.owner = 0;
      for (const r of RESOURCES)
        assert.equal(
          bankRate(g, 0, r),
          port.resource === "any" ? 3 : port.resource === r ? 2 : 4,
        );
      v.owner = null;
    }
  });
test("fun map settings reject unsupported selection atomically and preserve supported extension changes", () => {
  for (const map of maps) {
    const g = createGame("FUNMAP", player("a", "A"));
    addPlayer(g, player("b", "B"));
    applyAction(g, 1, { type: "ready" });
    applyAction(g, 0, { type: "settings", map });
    assert(g.players.every((p) => !p.ready));
    assert.equal(view(g, null).map, map);
    const board = JSON.stringify(g.board);
    const saved = normalizeGame(JSON.parse(JSON.stringify(g)));
    assert.equal(JSON.stringify(saved.board), board);
    if (FIXED_FUN_MAPS[map].maxPlayers < 8) {
      const before = JSON.stringify(g);
      assert.throws(
        () => applyAction(g, 0, { type: "settings", map, capacity: 8 }),
        /available map/,
      );
      assert.equal(JSON.stringify(g), before);
      applyAction(g, 0, { type: "settings", capacity: 8 });
      assert.equal(g.map, "baseRandom");
    } else {
      applyAction(g, 0, { type: "settings", capacity: 8 });
      assert.equal(g.map, map);
      assert.equal(g.board.tiles.length, map === "gear" ? 51 : 46);
    }
  }
});
function rng(seed: number) {
  return () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
for (const [map, n] of [
  ["diamond", 2],
  ["diamond", 4],
  ["pond", 2],
  ["pond", 4],
  ["gear", 4],
  ["gear", 8],
  ["twirl", 2],
  ["twirl", 4],
  ["twirl", 8],
] as [FixedFunMap, number][])
  test(`${map}: complete ${n}-seat Base game at normal ten points`, () => {
    let g = createGame(
      "FUNMAP",
      player("p0", "P0"),
      n,
      false,
      "base",
      "newShores",
      map,
    );
    for (let p = 1; p < n; p++) {
      addPlayer(g, player(`p${p}`, `P${p}`));
      applyAction(g, p, { type: "ready" });
    }
    applyAction(g, 0, { type: "settings", turnSeconds: 0 });
    for (let p = 1; p < n; p++) applyAction(g, p, { type: "ready" });
    applyAction(g, 0, { type: "start" });
    const random = rng(847 + n);
    let moves = 0;
    while (g.phase !== "finished" && moves < 10000) {
      const p =
        g.phase === "discard" ? Number(Object.keys(g.discards)[0]) : actor(g);
      const move = chooseMove(g, p);
      assert(move, `No legal driver move in ${g.phase}`);
      applyAction(g, p, move, random);
      moves++;
      for (const r of RESOURCES)
        assert.equal(
          g.bank[r] + g.players.reduce((s, p) => s + p.hand[r], 0),
          n <= 4 ? 19 : 29,
        );
      if (moves % 29 === 0) g = normalizeGame(JSON.parse(JSON.stringify(g)));
    }
    assert.equal(g.phase, "finished");
    assert(points(g, g.winner!) >= 10);
    assert.equal(g.map, map);
    assertStatistics(g);
  });
for (const [map, n] of [
  ["diamond", 3],
  ["pond", 4],
  ["gear", 6],
  ["twirl", 3],
  ["twirl", 6],
] as [FixedFunMap, number][])
  test(`${map}: complete ${n}-seat Cities & Knights game at thirteen points`, () => {
    let g = createGame(
      "FUNMAP",
      player("p0", "P0"),
      n,
      false,
      "citiesKnights",
      "newShores",
      map,
    );
    for (let p = 1; p < n; p++) addPlayer(g, player(`p${p}`, `P${p}`));
    applyAction(g, 0, { type: "settings", turnSeconds: 0 });
    for (let p = 1; p < n; p++) applyAction(g, p, { type: "ready" });
    applyAction(g, 0, { type: "start" });
    const random = rng(812 + n);
    let moves = 0;
    while (g.phase !== "finished" && moves < 15000) {
      applyAction(g, citiesMatchActor(g), chooseLegalCitiesMove(g), random);
      moves++;
      assertCitiesInventory(g);
      if (moves % 31 === 0) g = normalizeGame(JSON.parse(JSON.stringify(g)));
    }
    assert.equal(g.phase, "finished");
    assert(points(g, g.winner!) >= 13);
    assert.equal(g.map, map);
    assertStatistics(g);
  });
