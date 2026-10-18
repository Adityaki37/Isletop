import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import test from "node:test";
import assert from "node:assert/strict";
import { assembleTiles, RESOURCES } from "../lib/board";
import {
  Game,
  createGame,
  player,
  addPlayer,
  actor,
  view,
  legalShips,
  legalRobberTiles,
  legalPirateTiles,
} from "../lib/game";
import { citiesTable } from "../lib/cities-room";
import {
  createCitiesState,
  citiesHand,
  citiesBank,
  CitiesTable,
  legalKnightPlacements,
  legalKnightMoves,
  moveKnight,
  produceCitiesGoods,
} from "../lib/cities-knights";
import {
  playProgress,
  openDiplomatRoads,
  resolveProgressChoice,
  buildProgressRoad,
} from "../lib/cities-progress";
import { keepsKnightConnections, movableShips } from "../lib/seafarers";
import { scenarioTarget, SEAFARERS_SCENARIOS } from "../lib/scenarios";

function room(scenario = "newShores" as Game["scenario"]) {
  const g = createGame(
    "COMBIN",
    player("p0", "Host"),
    3,
    false,
    "seafarersCitiesKnights",
    scenario,
  );
  for (let p = 1; p < 3; p++) {
    addPlayer(g, player(`p${p}`, `Seat ${p}`));
    applyAction(g, p, { type: "ready" });
  }
  applyAction(g, 0, { type: "start" });
  while (g.phase.startsWith("setup")) {
    const p = actor(g),
      v = view(g, `p${p}`);
    applyAction(
      g,
      p,
      g.phase === "setupSettlement"
        ? { type: "settlement", id: v.legal.settlement[0] }
        : { type: "road", id: v.legal.road[0] },
    );
  }
  return g;
}
function seaTable(): CitiesTable {
  const board = {
    ...assembleTiles([{ q: 0, r: 0, resource: "sea", number: 0 }]),
    ports: [],
    robber: 0,
    pirate: null,
    width: 200,
    height: 200,
  };
  return {
    board,
    players: [
      { hand: citiesHand() },
      { hand: citiesHand() },
      { hand: citiesHand() },
    ],
    bank: citiesBank(3),
    active: 0,
    turn: 5,
    seafarers: true,
    cities: createCitiesState(3),
  };
}
function grant(
  t: CitiesTable,
  kind: "roadBuilding" | "diplomat" | "bishop" | "merchant",
) {
  for (const deck of Object.values(t.cities.decks)) {
    const i = deck.findIndex((c) => c.kind === kind);
    if (i >= 0) {
      const card = deck.splice(i, 1)[0];
      t.cities.players[0].progress.push(card);
      return card.id;
    }
  }
  throw Error("Missing card");
}

test("combined presets start settlement/city, supply commodities and use scenario targets", () => {
  for (const scenario of SEAFARERS_SCENARIOS)
    for (const n of [3, 4, 5, 6]) {
      const g = createGame(
        "COMBIN",
        player("p0", "Host"),
        n,
        false,
        "seafarersCitiesKnights",
        scenario,
      );
      assert.equal(g.target, scenarioTarget(scenario, true));
      assert.equal(g.board.pirate != null, true);
    }
  const g = room();
  assert(g.cities);
  assert.equal(g.deck.length, 0);
  assert.equal(g.board.vertices.filter((v) => v.city).length, 3);
  assert.equal(
    g.board.vertices.filter((v) => v.owner !== null && !v.city).length,
    3,
  );
  assert.equal(g.bank.paper, 12);
  assert.throws(
    () =>
      createGame(
        "COMBIN",
        player("p0", "Host"),
        7,
        false,
        "seafarersCitiesKnights",
      ),
    /3–6/,
  );
  applyAction(g, 0, { type: "roll" }, () => 0);
  assert.equal(g.phase, "action");
});

test("combined Merchant rejects owned gold without consuming its card or changing the existing point", () => {
  const g = room();
  g.phase = "action";
  const gold = g.board.tiles.find((t) => t.resource === "gold")!;
  Object.assign(g.board.vertices[gold.vertices[0]], { owner: 0, city: false });
  const priorTile = g.board.tiles.find(
    (tile) =>
      !tile.fog &&
      !["sea", "gold"].includes(tile.resource) &&
      tile.vertices.some((id) => g.board.vertices[id].owner === 1),
  )!;
  g.cities!.merchant = { owner: 1, tile: priorTile.id };
  const priorScore = view(g, "p1").players[1].score;
  const cardId = grant(citiesTable(g), "merchant"),
    before = structuredClone(g);
  assert.throws(
    () => applyAction(g, 0, { type: "progress", cardId, tile: gold.id }),
    /other than gold/,
  );
  assert.deepEqual(g, before, "Rejected Merchant placement is atomic");
  assert.equal(view(g, "p1").players[1].score, priorScore);
  const land = g.board.tiles.find(
    (tile) =>
      tile.resource !== "sea" &&
      tile.resource !== "gold" &&
      !tile.fog &&
      tile.vertices.some((id) => g.board.vertices[id].owner === 0),
  )!;
  applyAction(g, 0, { type: "progress", cardId, tile: land.id });
  assert.deepEqual(g.cities!.merchant, { owner: 0, tile: land.id });
  assert(!g.cities!.players[0].progress.some((card) => card.id === cardId));
});

test("knights move across ships onto sea but cannot be recruited at sea", () => {
  const t = seaTable(),
    tile = t.board.tiles[0],
    [a, b, c] = tile.vertices;
  t.board.vertices[a].owner = 0;
  for (const [from, to] of [
    [a, b],
    [b, c],
  ])
    Object.assign(
      t.board.edges.find(
        (e) => [e.a, e.b].includes(from) && [e.a, e.b].includes(to),
      )!,
      { owner: 0, kind: "ship", built: 1 },
    );
  t.cities.knights.push({
    owner: 0,
    vertex: b,
    level: 1,
    active: true,
    activatedAt: 1,
    upgradedAt: 1,
  });
  assert.deepEqual(legalKnightPlacements(t, 0), []);
  assert(legalKnightMoves(t, 0, b).includes(c));
  moveKnight(t, 0, b, c);
  assert.equal(t.cities.knights[0].vertex, c);
  assert.equal(t.cities.knights[0].active, false);
  assert.deepEqual(movableShips(t.board, 0, 5, [c]), []);
});

test("removing a ship cannot disconnect an inland knight across mixed routes", () => {
  const t = seaTable(),
    [a, b, c] = t.board.tiles[0].vertices;
  t.board.vertices[a].owner = 0;
  const ship = t.board.edges.find(
    (e) => [e.a, e.b].includes(a) && [e.a, e.b].includes(b),
  )!;
  const road = t.board.edges.find(
    (e) => [e.a, e.b].includes(b) && [e.a, e.b].includes(c),
  )!;
  Object.assign(ship, { owner: 0, kind: "ship", built: 1 });
  Object.assign(road, { owner: 0, kind: "road", built: 1 });
  t.cities.knights.push({
    owner: 0,
    vertex: c,
    level: 1,
    active: false,
    activatedAt: 1,
    upgradedAt: 1,
  });
  assert.equal(keepsKnightConnections(t.board, 0, [c], ship.id), false);
  assert(!openDiplomatRoads(t).includes(ship.id));
});

test("gold cities choose two resources and do not also receive Aqueduct", () => {
  const t = citiesTable(room()),
    tile = t.board.tiles.find((t) => t.resource === "gold")!;
  t.board.vertices.forEach((v) => {
    v.owner = null;
    v.city = false;
  });
  Object.assign(t.board.vertices[tile.vertices[0]], { owner: 0, city: true });
  t.board.robber = t.board.tiles.find(
    (t) => t.resource !== "gold" && t.resource !== "sea",
  )!.id;
  t.cities.players[0].improvements.science = 3;
  t.cities.players[1].improvements.science = 3;
  const before = t.players[0].hand.paper;
  const produced = produceCitiesGoods(t, tile.number);
  assert.equal(produced.gold[0], 2);
  assert.equal(t.players[0].hand.paper, before);
  assert(!produced.aqueduct.includes(0));
  assert(produced.aqueduct.includes(1));
});

test("gold rejects commodities and finishes when only commodities remain in bank", () => {
  const g = room();
  g.phase = "gold";
  g.goldClaims = { 0: 2 };
  g.goldResume = "action";
  assert.throws(
    () =>
      applyAction(g, 0, {
        type: "gold",
        resources: { ...citiesHand(), wood: 1, paper: 1 },
      }),
    /exactly 2/,
  );
  for (const r of RESOURCES) {
    g.players[1].hand[r] += g.bank[r];
    g.bank[r] = 0;
  }
  applyAction(g, 0, { type: "gold", resources: citiesHand() });
  assert.equal(g.phase, "action");
  assert.deepEqual(g.goldClaims, {});
});

test("combined knights block extending roads and ships through their intersections", () => {
  const g = room();
  g.phase = "action";
  const t = seaTable();
  g.board = t.board;
  const [a, b, c] = g.board.tiles[0].vertices;
  g.board.vertices[a].owner = 0;
  const source = g.board.edges.find(
    (e) => [e.a, e.b].includes(a) && [e.a, e.b].includes(b),
  )!;
  const next = g.board.edges.find(
    (e) => [e.a, e.b].includes(b) && [e.a, e.b].includes(c),
  )!;
  Object.assign(source, { owner: 0, kind: "ship", built: 1 });
  assert(legalShips(g, 0).includes(next.id));
  g.cities!.knights.push({
    owner: 1,
    vertex: b,
    level: 1,
    active: false,
    activatedAt: 1,
    upgradedAt: 1,
  });
  assert(!legalShips(g, 0).includes(next.id));
});

test("Road Building accepts ships, including when no land road is available", () => {
  const t = seaTable();
  t.board.vertices[t.board.tiles[0].vertices[0]].owner = 0;
  const card = grant(t, "roadBuilding");
  playProgress(t, 0, card, {}, { phase: "action" });
  const edges = t.board.vertices[t.board.tiles[0].vertices[0]].edges;
  buildProgressRoad(t, 0, edges[0], "ship");
  buildProgressRoad(t, 0, edges[1], "ship");
  assert.equal(t.cities.freeRoutes, null);
  assert(edges.every((id) => t.board.edges[id].kind === "ship"));
});

test("Diplomat can relocate a new pirate-blocked open ship and preserves its type", () => {
  const t = seaTable(),
    a = t.board.tiles[0].vertices[0];
  t.board.vertices[a].owner = 0;
  const source = t.board.vertices[a].edges[0];
  Object.assign(t.board.edges[source], {
    owner: 0,
    kind: "ship",
    built: t.turn,
  });
  t.board.pirate = 0;
  assert(openDiplomatRoads(t).includes(source));
  assert.deepEqual(movableShips(t.board, 0, t.turn), []);
  t.board.pirate = null;
  const id = grant(t, "diplomat");
  playProgress(t, 0, id, { edge: source }, { phase: "action" });
  const choice = t.cities.choices[0];
  assert(choice.kind === "relocateRoad");
  assert.equal(choice.routeKind, "ship");
  resolveProgressChoice(t, 0, { edge: choice.edges[0] });
  assert.equal(t.board.edges[choice.edges[0]].kind, "ship");
});

test("pirate and robber stay put before barbarians, and a knight chase restricts the raider", () => {
  const g = room();
  g.phase = "action";
  assert.deepEqual(legalRobberTiles(g), []);
  assert.deepEqual(legalPirateTiles(g), []);
  g.cities!.attacks = 1;
  g.turn = 5;
  const vertex = g.board.tiles[g.board.pirate!].vertices.find(
    (id) => g.board.vertices[id].owner === null,
  )!;
  g.cities!.knights.push({
    owner: 0,
    vertex,
    level: 1,
    active: true,
    activatedAt: 1,
    upgradedAt: 1,
  });
  applyAction(g, 0, { type: "chasePirate", id: vertex });
  assert.equal(g.phase, "robber");
  assert.deepEqual(legalRobberTiles(g), []);
  assert.throws(
    () =>
      applyAction(g, 0, {
        type: "robber",
        id: g.board.tiles.find(
          (t) => t.resource !== "sea" && t.id !== g.board.robber,
        )!.id,
      }),
    /Move the robber/,
  );
  applyAction(g, 0, { type: "pirate", id: legalPirateTiles(g)[0] });
  assert.equal(g.phase, "action");
  assert.equal(g.raiderMove, null);
});

test("gold production interrupts queued Aqueduct choices and resumes them afterwards", () => {
  const g = room(),
    t = citiesTable(g),
    tile = g.board.tiles.find((t) => t.resource === "gold")!;
  g.board.vertices.forEach((v) => {
    v.owner = null;
    v.city = false;
  });
  Object.assign(g.board.vertices[tile.vertices[0]], { owner: 0, city: true });
  g.board.robber = g.board.tiles.find(
    (t) => t.resource !== "gold" && t.resource !== "sea",
  )!.id;
  g.cities!.players[0].improvements.science = 3;
  g.cities!.players[1].improvements.science = 3;
  const card = grant(t, "roadBuilding");
  // Alchemist is a normal progress action with controlled dice, unlike a state
  // grant in a natural full-match proof. Return this unrelated fixture card.
  const deck = g.cities!.decks.science;
  const alchemist = deck.splice(
    deck.findIndex((c) => c.kind === "alchemist"),
    1,
  )[0];
  g.cities!.players[0].progress.push(alchemist);
  const sum = tile.number,
    first = Math.min(6, sum - 1);
  applyAction(
    g,
    0,
    { type: "progress", cardId: alchemist.id, dice: [first, sum - first] },
    () => 0.01,
  );
  assert.equal(g.phase, "gold");
  assert.equal(g.goldResume, "citiesChoice");
  assert.equal(g.goldClaims[0], 2);
  assert.equal(g.cities!.choices[0].kind, "aqueduct");
  assert.equal(g.cities!.choices[0].player, 1);
  applyAction(g, 0, { type: "gold", resources: { ...citiesHand(), wheat: 2 } });
  assert.equal(g.phase, "citiesChoice");
  applyAction(g, 1, { type: "citiesChoice", resource: "ore" });
  assert.equal(g.phase, "action");
  assert(g.cities!.players[0].progress.some((c) => c.id === card));
});

test("combined Road Building reveals fog and resumes its remaining free ship after gold", () => {
  const g = room("fogIslands");
  g.phase = "action";
  g.turn = 5;
  g.board.vertices.forEach((v) => {
    v.owner = null;
    v.city = false;
  });
  g.board.edges.forEach((e) => {
    e.owner = null;
    delete e.kind;
  });
  const e = g.board.edges.find(
    (e) =>
      !e.tiles.includes(g.board.pirate!) &&
      e.tiles.some((id) => g.board.tiles[id].resource === "sea") &&
      [e.a, e.b].some((id) =>
        g.board.vertices[id].tiles.some((t) => g.board.tiles[t].home),
      ) &&
      [e.a, e.b]
        .flatMap((id) => g.board.vertices[id].tiles)
        .some((t) => g.board.tiles[t].fog),
  )!;
  const start = [e.a, e.b].find((id) =>
    g.board.vertices[id].tiles.some((t) => g.board.tiles[t].home),
  )!;
  g.board.vertices[start].owner = 0;
  g.fogDeck = g.fogDeck.map(() => "gold");
  g.fogNumbers = g.fogNumbers.map(() => 8);
  const id = grant(citiesTable(g), "roadBuilding");
  applyAction(g, 0, { type: "progress", cardId: id });
  applyAction(g, 0, { type: "ship", id: e.id });
  assert.equal(g.phase, "gold");
  assert.equal(g.goldResume, "roadBuilding");
  assert.equal(g.freeRoads, 1);
  const amount = g.goldClaims[0];
  applyAction(g, 0, {
    type: "gold",
    resources: { ...citiesHand(), ore: amount },
  });
  assert.equal(g.phase, "roadBuilding");
  assert.equal(g.cities!.freeRoutes!.remaining, 1);
  assert.throws(() => applyAction(g, 0, { type: "skipRoads" }), /remaining free routes/);
  applyAction(g, 0, { type: "ship", id: legalShips(g, 0)[0] });
  if (g.phase === "gold") applyAction(g, 0, { type: "gold", resources: { ...citiesHand(), ore: g.goldClaims[0] } });
  assert.equal(g.phase, "action");
});
