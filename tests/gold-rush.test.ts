import test from "node:test";
import assert from "node:assert/strict";
import { RESOURCES, emptyHand } from "../lib/board";
import { baseMapAvailable } from "../lib/base-maps";
import { goldRushContents } from "../lib/gold-rush";
import { citiesTable } from "../lib/cities-room";
import { citiesHand, produceCitiesGoods } from "../lib/cities-knights";
import {
  Game,
  actor,
  createGame,
  player,
  addPlayer,
  applyAction,
  normalizeGame,
  legalRoads,
  legalShips,
  legalSettlements,
  legalRobberTiles,
  points,
  view,
  advanceClock,
} from "../lib/game";
import { chooseMove } from "./autoplay";
import { citiesMatchActor, chooseLegalCitiesMove } from "./cities-match-driver";
import { assertCitiesInventory } from "./cities-match-inventory";
import { assertStatistics } from "./statistics-assertions";

function room(n = 4, cities = false) {
  const g = createGame(
    "GOLDRS",
    player("p0", "P0"),
    n,
    false,
    cities ? "citiesKnights" : "base",
    "newShores",
    "goldRush",
  );
  for (let p = 1; p < n; p++) addPlayer(g, player(`p${p}`, `P${p}`));
  return g;
}
function conserved(g: Game) {
  for (const r of RESOURCES) {
    assert.equal(
      g.bank[r] + g.players.reduce((s, p) => s + p.hand[r], 0),
      g.capacity <= 4 ? 19 : 24,
    );
    assert(g.bank[r] >= 0 && Number.isInteger(g.bank[r]));
  }
}
function hiddenIntegrity(g: Game) {
  assert.equal(g.board.tiles.filter((t) => t.fog).length, g.fogDeck.length);
  assert.equal(g.fogNumbers.length, g.fogDeck.length);
  assert.equal(
    g.fogDeck.filter((r) => r === "gold").length +
      g.board.tiles.filter((t) => t.resource === "gold").length,
    1,
  );
  for (const id of [null, ...g.players.map((p) => p.id)]) {
    const v = view(g, id);
    assert(!("fogDeck" in v) && !("fogNumbers" in v));
    assert(
      v.board.tiles
        .filter((t) => t.fog)
        .every((t) => t.resource === "sea" && t.number === 0),
    );
  }
}
// Small, explicit engine fixtures exercise interruption and shortage cases.
// Complete-match tests below never grant cards, resources or placements.
function frontier(n = 4, gold = false) {
  const g = room(n);
  g.phase = "action";
  g.turn = 5;
  const e = g.board.edges.find(
    (e) =>
      e.tiles.some((id) => !g.board.tiles[id].fog) &&
      [e.a, e.b].some((id) =>
        g.board.vertices[id].tiles.some((t) => g.board.tiles[t].fog),
      ),
  )!;
  assert(e);
  const start = [e.a, e.b].find((id) =>
    g.board.vertices[id].tiles.some((t) => !g.board.tiles[t].fog),
  )!;
  g.board.vertices[start].owner = 0;
  assert(legalRoads(g, 0).includes(e.id));
  const fog = [
    ...new Set([e.a, e.b].flatMap((id) => g.board.vertices[id].tiles)),
  ].filter((id) => g.board.tiles[id].fog);
  g.fogDeck = g.fogDeck.map(() => (gold ? "gold" : "ore"));
  g.fogNumbers.fill(8);
  for (const r of ["wood", "brick"] as const) {
    g.bank[r]--;
    g.players[0].hand[r]++;
  }
  return { g, e, fog, start };
}

test("Gold Rush topology: 24 visible cells, seven hidden cells and six separate outer ports", () => {
  const g = room(),
    b = g.board;
  assert.equal(b.tiles.length, 31);
  assert.equal(b.tiles.filter((t) => t.fog).length, 7);
  assert.deepEqual(
    Object.fromEntries(
      [...RESOURCES, "desert"].map((r) => [
        r,
        b.tiles.filter((t) => !t.fog && t.resource === r).length,
      ]),
    ),
    { wood: 7, brick: 7, sheep: 4, wheat: 3, ore: 2, desert: 1 },
  );
  assert.equal(b.tiles[b.robber].resource, "desert");
  assert.equal(b.pirate, undefined);
  assert.equal(b.ports.length, 6);
  assert.equal(new Set(b.ports.map((p) => p.edge)).size, 6);
  assert.equal(
    new Set(b.ports.flatMap((p) => [b.edges[p.edge].a, b.edges[p.edge].b]))
      .size,
    12,
  );
  for (const p of b.ports) assert.equal(b.edges[p.edge].tiles.length, 1);
  assert.equal(legalShips(g, 0).length, 0);
  assert(
    legalSettlements(g, 0, true).every((id) =>
      b.vertices[id].tiles.some(
        (t) => !b.tiles[t].fog && b.tiles[t].resource !== "sea",
      ),
    ),
  );
  assert(legalRobberTiles(g).every((id) => !b.tiles[id].fog));
  hiddenIntegrity(g);
  assert.deepEqual(
    goldRushContents(() => 0.31),
    goldRushContents(() => 0.31),
  );
});
test("Gold Rush mode limits, atomic settings, readiness and fallback", () => {
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
        baseMapAvailable("goldRush", mode, n),
        ["base", "citiesKnights"].includes(mode) &&
          n >= (mode === "base" ? 2 : 3) &&
          n <= 6,
      );
  const g = room();
  applyAction(g, 1, { type: "ready" });
  const before = JSON.stringify(g);
  assert.throws(
    () => applyAction(g, 0, { type: "settings", map: "goldRush", capacity: 8 }),
    /available map/,
  );
  assert.equal(JSON.stringify(g), before);
  applyAction(g, 0, { type: "settings", capacity: 6 });
  assert.equal(g.map, "goldRush");
  assert(g.players.every((p) => !p.ready));
  hiddenIntegrity(g);
  const saved = normalizeGame(JSON.parse(JSON.stringify(g)));
  assert.equal(JSON.stringify(saved.board), JSON.stringify(g.board));
  assert.deepEqual(saved.fogDeck, g.fogDeck);
  applyAction(g, 0, { type: "settings", capacity: 8 });
  assert.equal(g.map, "baseRandom");
  assert.deepEqual(g.fogDeck, []);
});
test("Gold Rush paid road discovery pays finite resources once and rejects other actors atomically", () => {
  const { g, e, fog } = frontier();
  const before = JSON.stringify(g);
  assert.throws(() => applyAction(g, 1, { type: "road", id: e.id }));
  assert.equal(JSON.stringify(g), before);
  applyAction(g, 0, { type: "road", id: e.id });
  assert.equal(g.players[0].hand.ore, fog.length);
  assert(
    fog.every(
      (id) =>
        !g.board.tiles[id].fog &&
        g.board.tiles[id].resource === "ore" &&
        g.board.tiles[id].number === 8,
    ),
  );
  assert.equal(g.fogDeck.length, 7 - fog.length);
  const revealed = JSON.stringify(g);
  assert.throws(() => applyAction(g, 0, { type: "road", id: e.id }));
  assert.equal(JSON.stringify(g), revealed);
  conserved(g);
  const shortage = frontier();
  shortage.g.players[1].hand.ore = shortage.g.bank.ore;
  shortage.g.bank.ore = 0;
  applyAction(shortage.g, 0, { type: "road", id: shortage.e.id });
  assert.equal(shortage.g.players[0].hand.ore, 0);
  conserved(shortage.g);
});
for (const phase of ["action", "setupRoad", "roadBuilding", "special"] as const)
  test(`Gold Rush discovery interrupts ${phase} and resumes it with the correct seat and clock`, () => {
    const { g, e, fog, start } = frontier(phase === "special" ? 6 : 4, true);
    g.phase = phase;
    if (phase === "setupRoad") {
      g.setupVertex = start;
      g.setupStep = 0;
    }
    if (phase === "roadBuilding") {
      g.freeRoads = 2;
    }
    if (phase === "special") {
      g.specialPlayer = 0;
      g.active = 1;
    }
    g.turnSeconds = 60;
    advanceClock(g, 1000);
    const remaining = g.deadline! - 5000;
    applyAction(g, 0, { type: "road", id: e.id }, () => 0.2, 5000);
    assert.equal(g.phase, "gold");
    assert.equal(g.goldClaims[0], fog.length);
    assert.equal(view(g, "p0").goldAmount, fog.length);
    assert.equal(view(g, "p1").goldAmount, 0);
    const expected = phase === "setupRoad" ? "setupSettlement" : phase;
    assert.equal(g.goldResume, expected);
    const before = JSON.stringify(g);
    assert.throws(() =>
      applyAction(g, 1, {
        type: "gold",
        resources: { ...emptyHand(), wheat: fog.length },
      }),
    );
    assert.throws(() =>
      applyAction(g, 0, { type: "gold", resources: emptyHand() }),
    );
    assert.equal(JSON.stringify(g), before);
    applyAction(
      g,
      0,
      { type: "gold", resources: { ...emptyHand(), wheat: fog.length } },
      () => 0.2,
      8000,
    );
    assert.equal(g.phase, expected);
    assert.equal(g.players[0].hand.wheat, fog.length);
    if (phase === "setupRoad") assert.equal(g.active, 1);
    if (phase === "special") assert.equal(g.specialPlayer, 0);
    if (phase === "action" || phase === "special")
      assert.equal(g.deadline, 8000 + remaining);
    if (phase === "roadBuilding") assert.equal(g.freeRoads, 1);
    conserved(g);
  });
test("standalone C&K Gold Rush pays two resource choices for a city and suppresses its Aqueduct", () => {
  const g = room(4, true);
  for (let p = 1; p < 4; p++) applyAction(g, p, { type: "ready" });
  applyAction(g, 0, { type: "start" });
  const t = citiesTable(g),
    tile = g.board.tiles.find((t) => t.fog)!;
  // Isolate the gold roll: random neighboring number tokens must not also pay resources.
  for (const other of g.board.tiles) if (other.number === 8) other.number = 9;
  Object.assign(tile, { resource: "gold", number: 8 });
  delete tile.fog;
  Object.assign(g.board.vertices[tile.vertices[0]], { owner: 0, city: true });
  Object.assign(g.board.vertices[tile.vertices[3]], { owner: 2, city: false });
  g.cities!.players[0].improvements.science = 3;
  g.cities!.players[1].improvements.science = 3;
  assert.equal(t.seafarers, false);
  const production = produceCitiesGoods(t, 8);
  assert.equal(production.gold[0], 2);
  assert.equal(production.gold[2], 1);
  assert(!production.aqueduct.includes(0));
  assert(production.aqueduct.includes(1));
  assert.deepEqual(g.players[0].hand, citiesHand());
  g.phase = "gold";
  g.goldClaims = Object.fromEntries(
    production.gold.flatMap((n, p) => (n ? [[p, n]] : [])),
  );
  g.goldResume = "action";
  const before = JSON.stringify(g);
  assert.throws(
    () =>
      applyAction(g, 0, {
        type: "gold",
        resources: { ...citiesHand(), paper: 2 },
      }),
    /exactly 2/,
  );
  assert.equal(JSON.stringify(g), before);
  applyAction(g, 0, { type: "gold", resources: { ...citiesHand(), ore: 2 } });
  assert.equal(g.phase, "gold");
  applyAction(g, 2, { type: "gold", resources: { ...citiesHand(), wheat: 1 } });
  assert.equal(g.phase, "action");
  conserved(g);
});
for (const cities of [false, true])
  for (const n of cities ? [3, 4, 6] : [2, 4, 6])
    test(`Gold Rush natural ${n}-seat ${cities ? "C&K" : "Base"} game completes at normal target`, () => {
      let g = room(n, cities);
      let seed = 1837 + n,
        moves = 0;
      const random = () =>
        (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
      applyAction(g, 0, { type: "settings", turnSeconds: 0 });
      for (let p = 1; p < n; p++) applyAction(g, p, { type: "ready" });
      applyAction(g, 0, { type: "start" }, random);
      while (g.phase !== "finished" && moves < 15000) {
        const p = cities
          ? citiesMatchActor(g)
          : g.phase === "discard"
            ? Number(Object.keys(g.discards)[0])
            : g.phase === "gold"
              ? Number(Object.keys(g.goldClaims)[0])
              : actor(g);
        const action = cities ? chooseLegalCitiesMove(g) : chooseMove(g, p);
        assert(action, `No move at ${g.phase}`);
        applyAction(g, p, action, random);
        moves++;
        conserved(g);
        if (cities) assertCitiesInventory(g);
        hiddenIntegrity(g);
        if (moves % 31 === 0) g = normalizeGame(JSON.parse(JSON.stringify(g)));
      }
      assert.equal(g.phase, "finished");
      assert.equal(g.target, cities ? 13 : 10);
      assert(points(g, g.winner!) >= g.target);
      assert(
        g.board.tiles.filter((t) => t.fog).length < 7,
        "No exploration during full game",
      );
      assertStatistics(g);
      assert.equal(g.map, "goldRush");
    });
