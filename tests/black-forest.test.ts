import test from "node:test";
import assert from "node:assert/strict";
import { RESOURCES } from "../lib/board";
import { baseMapAvailable, makeBaseBoard } from "../lib/base-maps";
import { blackForestContents } from "../lib/black-forest";
import {
  Game,
  createGame,
  player,
  addPlayer,
  applyAction,
  normalizeGame,
  legalRoads,
  legalShips,
  legalSettlements,
  legalRobberTiles,
  bankRate,
  actor,
  points,
  view,
} from "../lib/game";
import { chooseMove } from "./autoplay";
import { citiesMatchActor, chooseLegalCitiesMove } from "./cities-match-driver";
import { assertCitiesInventory } from "./cities-match-inventory";
import { assertStatistics } from "./statistics-assertions";
import {
  assertBlackForestInventory,
  assertBlackForestProjection,
} from "./black-forest-assertions";

function room(n = 4, cities = false) {
  const g = createGame(
    "BLACKF",
    player("p0", "P0"),
    n,
    false,
    cities ? "citiesKnights" : "base",
    "newShores",
    "blackForest",
  );
  for (let p = 1; p < n; p++) addPlayer(g, player(`p${p}`, `P${p}`));
  return g;
}
function conserved(g: Game) {
  for (const r of RESOURCES)
    assert.equal(
      g.bank[r] + g.players.reduce((s, p) => s + p.hand[r], 0),
      g.boardPlayers <= 4 ? 19 : 24,
    );
}
function integrity(g: Game) {
  assertBlackForestInventory(g);
  for (const id of [null, ...g.players.map((p) => p.id)])
    assertBlackForestProjection(view(g, id));
  conserved(g);
}
test("Black Forest original topology, central lake and six independent inward wood ports", () => {
  const g = room(),
    b = g.board;
  integrity(g);
  assert.equal(b.tiles.filter((t) => t.fog).length, 30);
  assert.equal(b.tiles[b.robber].resource, "desert");
  assert.equal(b.tiles[b.robber].q, 0);
  assert.equal(b.tiles[b.robber].r, 0);
  assert.equal(new Set(b.ports.map((p) => p.edge)).size, 6);
  assert.equal(
    new Set(b.ports.flatMap((p) => [b.edges[p.edge].a, b.edges[p.edge].b]))
      .size,
    12,
  );
  for (const port of b.ports) {
    const edge = b.edges[port.edge];
    assert.equal(edge.tiles.length, 2);
    assert.deepEqual(edge.tiles.map((id) => b.tiles[id].resource).sort(), [
      "sea",
      "wood",
    ]);
    b.vertices[edge.a].owner = 0;
    assert.equal(bankRate(g, 0, "wood"), 2);
    for (const r of RESOURCES.filter((r) => r !== "wood"))
      assert.equal(bankRate(g, 0, r), 4);
    b.vertices[edge.a].owner = null;
  }
  assert.equal(legalShips(g, 0).length, 0);
  assert(
    legalRobberTiles(g).every(
      (id) => !b.tiles[id].fog && b.tiles[id].resource !== "sea",
    ),
  );
  assert(
    b.edges
      .filter((e) => e.tiles.every((id) => b.tiles[id].resource === "sea"))
      .every((e) => !legalRoads(g, 0).includes(e.id)),
  );
});
test("Black Forest generated visible numbers preserve the original inventory and separate red numbers", () => {
  let seed = 771;
  const rng = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const expected = [
    2, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 8, 8, 8, 8, 9, 9, 9, 10, 10,
    11, 12,
  ];
  // The preview has 24 forests (three 4s and four 5s), unlike a standard island.
  expected.splice(expected.indexOf(4), 1);
  expected.splice(expected.indexOf(5), 1);
  const layouts = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const b = makeBaseBoard(4, "blackForest", rng);
    const numbers = b.tiles.filter((t) => t.home).map((t) => t.number);
    assert.deepEqual(
      [...numbers].sort((a, b) => a - b),
      expected,
    );
    for (const e of b.edges.filter((e) => e.tiles.length === 2))
      assert(!e.tiles.every((id) => [6, 8].includes(b.tiles[id].number)));
    layouts.add(numbers.join(","));
  }
  assert.equal(layouts.size, 200);
  assert.deepEqual(
    blackForestContents(() => 0.31),
    blackForestContents(() => 0.31),
  );
  const pool = blackForestContents(() => 0.31);
  assert.deepEqual(
    pool.fogNumbers.sort((a, b) => a - b),
    [
      3,
      ...Array(4).fill(4),
      ...Array(5).fill(5),
      ...Array(5).fill(6),
      ...Array(5).fill(8),
      ...Array(5).fill(9),
      ...Array(4).fill(10),
      11,
    ],
  );
});
test("Black Forest compatibility, ready invalidation, persistence and capacity fallback", () => {
  for (const mode of [
    "base",
    "citiesKnights",
    "solo",
    "duel",
    "rush",
    "seafarers",
    "seafarersCitiesKnights",
  ])
    for (let n = 1; n <= 8; n++)
      assert.equal(
        baseMapAvailable("blackForest", mode, n),
        ["base", "citiesKnights"].includes(mode) &&
          n >= (mode === "base" ? 2 : 3) &&
          n <= 6,
      );
  const g = room();
  applyAction(g, 1, { type: "ready" });
  const before = JSON.stringify(g);
  assert.throws(
    () =>
      applyAction(g, 0, { type: "settings", map: "blackForest", capacity: 8 }),
    /available map/,
  );
  assert.equal(JSON.stringify(g), before);
  applyAction(g, 0, { type: "settings", capacity: 6 });
  assert(g.players.every((p) => !p.ready));
  integrity(g);
  const saved = normalizeGame(JSON.parse(JSON.stringify(g)));
  assert.equal(JSON.stringify(saved.board), JSON.stringify(g.board));
  assert.deepEqual(saved.fogDeck, g.fogDeck);
  integrity(saved);
  applyAction(g, 0, { type: "settings", capacity: 8 });
  assert.equal(g.map, "baseRandom");
  assert.deepEqual(g.fogDeck, []);
});
test("Black Forest opening settlements remain on the original forest after fog is revealed", () => {
  const g = room();
  g.phase = "setupSettlement";
  for (const tile of g.board.tiles.filter((t) => t.fog)) {
    tile.resource = "brick";
    tile.number = 8;
    delete tile.fog;
  }
  const outer = g.board.vertices.find(
    (v) =>
      v.tiles.every((id) => !g.board.tiles[id].home) &&
      v.tiles.some((id) => g.board.tiles[id].resource === "brick"),
  )!;
  assert(outer);
  assert(!legalSettlements(g, 0, true).includes(outer.id));
  assert(
    legalSettlements(g, 0, true).every((id) =>
      g.board.vertices[id].tiles.some((id) => g.board.tiles[id].home),
    ),
  );
  const before = JSON.stringify(g);
  assert.throws(() => applyAction(g, 0, { type: "settlement", id: outer.id }));
  assert.equal(JSON.stringify(g), before);
  g.phase = "action";
  g.turn = 3;
  g.board.edges[outer.edges[0]].owner = 0;
  assert(legalSettlements(g, 0).includes(outer.id));
});
// Explicit frontier fixtures test shortage/phase cases; full matches below make
// every payment through real actions, without inventory or placement grants.
for (const phase of ["action", "setupRoad", "roadBuilding", "special"] as const)
  test(`Black Forest ${phase} discovery pays once and preserves the proper phase`, () => {
    const g = room(phase === "special" ? 6 : 4);
    g.phase = phase;
    g.turn = 5;
    const e = g.board.edges.find(
      (e) =>
        e.tiles.some((id) => g.board.tiles[id].home) &&
        [e.a, e.b].some((id) =>
          g.board.vertices[id].tiles.some((id) => g.board.tiles[id].fog),
        ),
    )!;
    const start = [e.a, e.b].find((id) =>
      g.board.vertices[id].tiles.some((id) => g.board.tiles[id].home),
    )!;
    g.board.vertices[start].owner = 0;
    if (phase === "setupRoad") {
      g.setupVertex = start;
      g.setupStep = 0;
    }
    if (phase === "roadBuilding") g.freeRoads = 2;
    if (phase === "special") {
      g.specialPlayer = 0;
      g.active = 1;
    }
    if (phase === "action" || phase === "special")
      for (const r of ["wood", "brick"] as const) {
        g.bank[r]--;
        g.players[0].hand[r]++;
      }
    assert(legalRoads(g, 0, phase === "setupRoad").includes(e.id));
    const fog = [
      ...new Set([e.a, e.b].flatMap((id) => g.board.vertices[id].tiles)),
    ].filter((id) => g.board.tiles[id].fog);
    const resources = g.fogDeck.slice(0, fog.length);
    const before = JSON.stringify(g);
    assert.throws(() => applyAction(g, 1, { type: "road", id: e.id }));
    assert.equal(JSON.stringify(g), before);
    const oldHand = { ...g.players[0].hand };
    applyAction(g, 0, { type: "road", id: e.id });
    assert(
      fog.every((id) => !g.board.tiles[id].fog && !g.board.tiles[id].home),
    );
    for (const r of RESOURCES)
      assert.equal(
        g.players[0].hand[r],
        oldHand[r] -
          (phase === "action" || phase === "special"
            ? Number(r === "wood" || r === "brick")
            : 0) +
          resources.filter((t) => t === r).length,
      );
    assert.equal(g.phase, phase === "setupRoad" ? "setupSettlement" : phase);
    if (phase === "setupRoad") assert.equal(g.active, 1);
    if (phase === "roadBuilding") assert.equal(g.freeRoads, 1);
    if (phase === "special") assert.equal(g.specialPlayer, 0);
    integrity(g);
    const after = JSON.stringify(g);
    assert.throws(() => applyAction(g, 0, { type: "road", id: e.id }));
    assert.equal(JSON.stringify(g), after);
  });
test("Black Forest depleted discovery resource still reveals the tile without granting a card", () => {
  const g = room();
  g.phase = "action";
  g.turn = 4;
  const e = g.board.edges.find(
    (e) =>
      e.tiles.some((id) => g.board.tiles[id].home) &&
      [e.a, e.b].some((id) =>
        g.board.vertices[id].tiles.some((id) => g.board.tiles[id].fog),
      ),
  )!;
  g.board.vertices[e.a].owner = 0;
  for (const r of ["wood", "brick"] as const) {
    g.bank[r]--;
    g.players[0].hand[r]++;
  }
  const oreIndex = g.fogDeck.indexOf("ore");
  [g.fogDeck[0], g.fogDeck[oreIndex]] = [g.fogDeck[oreIndex], g.fogDeck[0]];
  const discovery = "ore";
  g.players[1].hand[discovery] = g.bank[discovery];
  g.bank[discovery] = 0;
  const old = g.players[0].hand[discovery];
  applyAction(g, 0, { type: "road", id: e.id });
  assert.equal(g.players[0].hand[discovery], old);
  integrity(g);
});
for (const cities of [false, true])
  for (const n of cities ? [3, 4, 6] : [2, 4, 6])
    test(`Black Forest natural ${n}-seat ${cities ? "C&K" : "Base"} win at normal target`, () => {
      let g = room(n, cities);
      applyAction(g, 0, { type: "settings", turnSeconds: 0 });
      for (let p = 1; p < n; p++) applyAction(g, p, { type: "ready" });
      applyAction(g, 0, { type: "start" });
      let seed = 8161 + n,
        moves = 0;
      const rng = () =>
        (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
      while (g.phase !== "finished" && moves < 18000) {
        const p = cities
          ? citiesMatchActor(g)
          : g.phase === "discard"
            ? Number(Object.keys(g.discards)[0])
            : actor(g);
        const action = cities ? chooseLegalCitiesMove(g) : chooseMove(g, p);
        assert(action);
        applyAction(g, p, action, rng);
        moves++;
        integrity(g);
        if (cities) assertCitiesInventory(g);
        if (moves % 31 === 0) g = normalizeGame(JSON.parse(JSON.stringify(g)));
      }
      assert.equal(g.phase, "finished");
      assert.equal(g.target, cities ? 13 : 10);
      assert(points(g, g.winner!) >= g.target);
      assert(g.board.tiles.filter((t) => t.fog).length < 30);
      assertStatistics(g);
    });
