import test from "node:test";
import assert from "node:assert/strict";
import { makeBoard, RESOURCES, Resource } from "../lib/board";
import {
  BoardKnight,
  CitiesTable,
  CityTrack,
  Commodity,
  COMMODITIES,
  GOODS,
  PROGRESS_COUNTS,
  TRACKS,
  createCitiesState,
  citiesBank,
  citiesHand,
  goodsTotal,
  cleanCitiesHand,
  metropolisAt,
  knightStrength,
  citiesBonus,
  citiesDiscardLimit,
  robberEnabled,
  citiesRoadBlocked,
  legalKnightPlacements,
  placeKnight,
  activateKnight,
  promoteKnight,
  legalKnightMoves,
  legalKnightDisplacements,
  moveKnight,
  displaceKnight,
  chaseRobber,
  buildCityWall,
  legalCityWalls,
  legalCitiesUpgrades,
  upgradeCitiesCity,
  improveCity,
  drawProgress,
  returnProgress,
  queueProgressLimit,
  resolveCitiesChoice,
  attackBarbarians,
  resolveEventDie,
  produceCitiesGoods,
  citiesBankRatio,
  exchangeCitiesBank,
  citiesView,
} from "../lib/cities-knights";

function table(n = 4): CitiesTable {
  return {
    board: makeBoard(n, () => 0.42),
    players: Array.from({ length: n }, () => ({ hand: citiesHand() })),
    bank: citiesBank(n),
    active: 0,
    turn: 10,
    cities: createCitiesState(n, () => 0.42),
  };
}
function fund(
  t: CitiesTable,
  p: number,
  counts: Partial<ReturnType<typeof citiesHand>>,
) {
  for (const r of GOODS) {
    const amount = counts[r] ?? 0;
    t.players[p].hand[r] += amount;
    t.bank[r] -= amount;
  }
}
function city(t: CitiesTable, p: number, vertex: number, isCity = true) {
  Object.assign(t.board.vertices[vertex], { owner: p, city: isCity });
}
function knight(
  t: CitiesTable,
  p: number,
  vertex: number,
  level: 1 | 2 | 3 = 1,
  active = true,
): BoardKnight {
  const k = { owner: p, vertex, level, active, activatedAt: 9, upgradedAt: -1 };
  t.cities.knights.push(k);
  return k;
}
function chain(t: CitiesTable, p: number, length = 5) {
  const walk = (
    source: number,
    vertices: number[],
    edges: number[],
  ): { vertices: number[]; edges: number[] } | null => {
    if (edges.length === length) return { vertices, edges };
    for (const id of t.board.vertices[source].edges) {
      const e = t.board.edges[id],
        next = e.a === source ? e.b : e.a;
      if (vertices.includes(next)) continue;
      const found = walk(next, [...vertices, next], [...edges, id]);
      if (found) return found;
    }
    return null;
  };
  const path = walk(0, [0], []);
  assert(path);
  for (const id of path.edges) t.board.edges[id].owner = p;
  return path;
}
function productionBoard(t: CitiesTable, resource: Resource) {
  const tile = t.board.tiles.find(
    (x) => x.resource === resource && x.id !== t.board.robber,
  )!;
  for (const x of t.board.tiles) x.number = x.id === tile.id ? 5 : 9;
  return tile;
}
function invariants(t: CitiesTable) {
  const initial = citiesBank(t.players.length);
  for (const r of GOODS)
    assert.equal(
      t.bank[r] + t.players.reduce((n, p) => n + p.hand[r], 0),
      initial[r],
      `${r} supply conserved`,
    );
}
function level(t: CitiesTable, p: number, track: CityTrack, target: number) {
  const commodity = (
    { science: "paper", politics: "coin", trade: "cloth" } as const
  )[track];
  for (
    let next = t.cities.players[p].improvements[track] + 1;
    next <= target;
    next++
  ) {
    fund(t, p, { [commodity]: next });
    improveCity(t, p, track);
    if (t.cities.choices[0]?.kind === "metropolis")
      resolveCitiesChoice(t, p, { vertex: t.cities.choices[0].vertices[0] });
  }
}
test("C&K supplies, complete progress decks and unique persistent card identities", () => {
  for (const n of [3, 4, 5, 6]) {
    const t = table(n);
    assert.deepEqual(
      COMMODITIES.map((r) => t.bank[r]),
      Array(3).fill(n <= 4 ? 12 : 18),
    );
    assert.equal(GOODS.length, 8);
    assert.deepEqual(
      TRACKS.map((track) => t.cities.decks[track].length),
      [18, 18, 18],
    );
    const all = TRACKS.flatMap((track) => t.cities.decks[track]);
    assert.equal(new Set(all.map((c) => c.id)).size, 54);
    for (const track of TRACKS)
      for (const [kind, count] of Object.entries(PROGRESS_COUNTS[track]))
        assert.equal(
          all.filter((c) => c.track === track && c.kind === kind).length,
          count,
        );
    invariants(t);
  }
  assert.throws(() => createCitiesState(2));
  assert.throws(() => citiesBank(7));
});
test("C&K hand validation counts commodities and rejects unknown/negative/fractional cards", () => {
  const h = cleanCitiesHand({ wood: 2, paper: 3, cloth: 1, coin: 4 });
  assert.equal(goodsTotal(h), 10);
  for (const value of [
    null,
    [],
    { paper: -1 },
    { coin: 0.5 },
    { brick: Infinity },
    { progress: 1 },
    { cloth: 101 },
  ])
    assert.throws(() => cleanCitiesHand(value));
});
test("C&K cities split resource/commodity production; brick and grain still double", () => {
  for (const r of RESOURCES) {
    const t = table(),
      tile = productionBoard(t, r);
    city(t, 0, tile.vertices[0]);
    city(t, 1, tile.vertices[2], false);
    const result = produceCitiesGoods(t, 5);
    const commodity = (
      { wood: "paper", sheep: "cloth", ore: "coin" } as Partial<
        Record<Resource, Commodity>
      >
    )[r];
    assert.equal(result.received[0][r], commodity ? 1 : 2);
    assert.equal(result.received[1][r], 1);
    assert.equal(goodsTotal(result.received[0]), 2);
    if (commodity) assert.equal(result.received[0][commodity], 1);
    invariants(t);
  }
});
test("C&K commodity shortage is independent of resource production and the robber blocks both", () => {
  const t = table(),
    tile = productionBoard(t, "wood");
  city(t, 0, tile.vertices[0]);
  city(t, 1, tile.vertices[2]);
  fund(t, 2, { paper: t.bank.paper - 1 });
  let result = produceCitiesGoods(t, 5);
  assert.equal(result.received[0].wood, 1);
  assert.equal(result.received[1].wood, 1);
  assert.equal(result.received[0].paper + result.received[1].paper, 0);
  t.board.robber = tile.id;
  result = produceCitiesGoods(t, 5);
  assert.equal(
    result.received.reduce((n, h) => n + goodsTotal(h), 0),
    0,
  );
  invariants(t);
});
test("C&K single commodity claimant gets remaining supply rather than losing independent resources", () => {
  const t = table(),
    tile = productionBoard(t, "ore");
  city(t, 0, tile.vertices[0]);
  city(t, 0, tile.vertices[2]);
  fund(t, 1, { coin: t.bank.coin - 1 });
  const { received } = produceCitiesGoods(t, 5);
  assert.equal(received[0].ore, 2);
  assert.equal(received[0].coin, 1);
  invariants(t);
});
test("C&K Aqueduct is a private-owner mandatory resource choice, never commodities or seven payouts", () => {
  const t = table();
  t.cities.players[1].improvements.science = 3;
  assert.deepEqual(produceCitiesGoods(t, 7).aqueduct, []);
  const { aqueduct } = produceCitiesGoods(t, 5);
  assert.deepEqual(aqueduct, [1]);
  const before = JSON.stringify(t);
  assert.throws(() => resolveCitiesChoice(t, 0, { resource: "wood" }));
  assert.throws(() =>
    resolveCitiesChoice(t, 1, { resource: "paper" as Resource }),
  );
  assert.equal(JSON.stringify(t), before);
  resolveCitiesChoice(t, 1, { resource: "wheat" });
  assert.equal(t.players[1].hand.wheat, 1);
  assert.throws(() => resolveCitiesChoice(t, 1, { resource: "wheat" }));
  invariants(t);
});
test("C&K Aqueduct requires no actual resource or commodity income; bank exhaustion does not deadlock", () => {
  const t = table(),
    tile = productionBoard(t, "wood");
  city(t, 0, tile.vertices[0]);
  t.cities.players[0].improvements.science = 3;
  fund(t, 1, { wood: t.bank.wood });
  assert.deepEqual(produceCitiesGoods(t, 5).aqueduct, []); // Paper alone counts as income.
  t.board.robber = tile.id;
  for (const r of RESOURCES) fund(t, 1, { [r]: t.bank[r] });
  assert.deepEqual(produceCitiesGoods(t, 5).aqueduct, [0]);
  assert.deepEqual(t.cities.choices, []);
  invariants(t);
});
test("C&K basic knight placement ignores building distance, uses roads and finite two-piece supply", () => {
  const t = table(),
    path = chain(t, 0);
  city(t, 0, path.vertices[0], false);
  fund(t, 0, { sheep: 3, ore: 3 });
  assert(legalKnightPlacements(t, 0).includes(path.vertices[1]));
  placeKnight(t, 0, path.vertices[1]);
  placeKnight(t, 0, path.vertices[2]);
  assert.equal(t.cities.knights.length, 2);
  assert.deepEqual(legalKnightPlacements(t, 0), []);
  const before = JSON.stringify(t);
  assert.throws(() => placeKnight(t, 0, path.vertices[3]));
  assert.equal(JSON.stringify(t), before);
  invariants(t);
});
test("C&K activation cannot enable an action this turn; moving then reactivating cannot act again", () => {
  const t = table(),
    path = chain(t, 0);
  fund(t, 0, { sheep: 1, ore: 1, wheat: 2 });
  placeKnight(t, 0, path.vertices[0]);
  activateKnight(t, 0, path.vertices[0]);
  assert.throws(() => moveKnight(t, 0, path.vertices[0], path.vertices[1]));
  t.turn++;
  moveKnight(t, 0, path.vertices[0], path.vertices[1]);
  assert.equal(t.cities.knights[0].active, false);
  activateKnight(t, 0, path.vertices[1]);
  assert.throws(() => moveKnight(t, 0, path.vertices[1], path.vertices[2]));
  invariants(t);
});
test("C&K knight promotion preserves activation, limits once per turn and requires Fortress/supply", () => {
  const t = table(),
    k = knight(t, 0, 0);
  fund(t, 0, { sheep: 3, ore: 3 });
  promoteKnight(t, 0, 0);
  assert.equal(k.level, 2);
  assert(k.active);
  assert.throws(() => promoteKnight(t, 0, 0));
  t.turn++;
  assert.throws(() => promoteKnight(t, 0, 0));
  t.cities.players[0].improvements.politics = 3;
  promoteKnight(t, 0, 0);
  assert.equal(k.level, 3);
  knight(t, 0, 1, 3);
  const second = knight(t, 0, 2, 2);
  t.turn++;
  assert.throws(() => promoteKnight(t, 0, second.vertex));
  invariants(t);
});
test("C&K knights traverse own buildings/knights but opposing pieces cut movement and road connectivity", () => {
  const t = table(),
    path = chain(t, 0),
    v = path.vertices;
  knight(t, 0, v[0]);
  city(t, 0, v[1]);
  knight(t, 0, v[2]);
  knight(t, 1, v[4]);
  assert(legalKnightMoves(t, 0, v[0]).includes(v[3]));
  assert(!legalKnightMoves(t, 0, v[0]).includes(v[5]));
  assert(citiesRoadBlocked(t, v[4], 0));
  assert(!citiesRoadBlocked(t, v[4], 1));
  assert(!legalKnightMoves(t, 0, v[0]).includes(v[1]));
});
test("C&K stronger knight displaces; victim owns the relocation choice and preserves activation", () => {
  const t = table(),
    path = chain(t, 0),
    v = path.vertices;
  const mover = knight(t, 0, v[0], 2),
    victim = knight(t, 1, v[3], 1);
  const extra = t.board.vertices[v[3]].edges.find(
    (id) => !path.edges.includes(id),
  );
  assert.notEqual(extra, undefined);
  t.board.edges[extra!].owner = 1;
  const destination =
    t.board.edges[extra!].a === v[3]
      ? t.board.edges[extra!].b
      : t.board.edges[extra!].a;
  assert(legalKnightDisplacements(t, 0, v[0]).includes(v[3]));
  displaceKnight(t, 0, v[0], v[3]);
  assert.equal(mover.vertex, v[3]);
  assert(!mover.active);
  assert.equal(t.cities.choices[0].kind, "relocateKnight");
  assert.throws(() => resolveCitiesChoice(t, 0, { vertex: destination }));
  resolveCitiesChoice(t, 1, { vertex: destination });
  const relocated = t.cities.knights.find((k) => k.owner === 1)!;
  assert.equal(relocated.vertex, destination);
  assert.equal(relocated.active, victim.active);
  assert.equal(relocated.level, 1);
});
test("C&K equal knights cannot displace; trapped weaker knight returns to supply", () => {
  const t = table(),
    path = chain(t, 0),
    v = path.vertices;
  knight(t, 0, v[0], 1);
  knight(t, 1, v[2], 1);
  assert.throws(() => displaceKnight(t, 0, v[0], v[2]));
  t.cities.knights[0].level = 2;
  displaceKnight(t, 0, v[0], v[2]);
  assert.equal(t.cities.knights.length, 1);
  assert.deepEqual(t.cities.choices, []);
});
test("C&K robber is locked until first attack; an adjacent old active knight can chase it", () => {
  const t = table(),
    tile = t.board.tiles[t.board.robber];
  knight(t, 0, tile.vertices[0]);
  assert(!robberEnabled(t));
  assert.throws(() => chaseRobber(t, 0, tile.vertices[0]));
  t.cities.attacks = 1;
  assert(robberEnabled(t));
  chaseRobber(t, 0, tile.vertices[0]);
  assert.equal(t.cities.knights[0].active, false);
  assert.throws(() => chaseRobber(t, 0, tile.vertices[0]));
});
test("C&K walls use two bricks, one per city, three per player and add two to discard limits", () => {
  const t = table();
  for (let i = 0; i < 4; i++) city(t, 0, i);
  fund(t, 0, { brick: 6 });
  for (let i = 0; i < 3; i++) buildCityWall(t, 0, i);
  assert.equal(citiesDiscardLimit(t, 0), 13);
  assert.equal(citiesDiscardLimit(t, 1), 7);
  assert.deepEqual(legalCityWalls(t, 0), []);
  assert.throws(() => buildCityWall(t, 0, 3));
  invariants(t);
});
test("C&K improvements require a city and increasing commodities; Crane discounts one level only", () => {
  const t = table();
  fund(t, 0, { paper: 2 });
  assert.throws(() => improveCity(t, 0, "science"));
  city(t, 0, 0);
  improveCity(t, 0, "science");
  assert.equal(t.players[0].hand.paper, 1);
  improveCity(t, 0, "science", true);
  assert.equal(t.players[0].hand.paper, 0);
  assert.equal(t.cities.players[0].improvements.science, 2);
  invariants(t);
});
test("C&K first level-four city gains metropolis; tied level does not steal and first five locks it", () => {
  const t = table();
  city(t, 0, 0);
  city(t, 1, 1);
  level(t, 0, "science", 4);
  assert.equal(t.cities.metropolises.science!.owner, 0);
  assert.equal(citiesBonus(t, 0), 2);
  level(t, 1, "science", 4);
  assert.equal(t.cities.metropolises.science!.owner, 0);
  level(t, 1, "science", 5);
  assert.equal(t.cities.metropolises.science!.owner, 1);
  assert.equal(citiesBonus(t, 0), 0);
  assert.equal(citiesBonus(t, 1), 2);
  level(t, 0, "science", 5);
  assert.equal(t.cities.metropolises.science!.owner, 1);
  invariants(t);
});
test("C&K multiple metropolises need separate cities; maxed tracks cannot be purchased", () => {
  const t = table();
  city(t, 0, 0);
  level(t, 0, "science", 4);
  level(t, 0, "trade", 3);
  fund(t, 0, { cloth: 4 });
  assert.throws(() => improveCity(t, 0, "trade"));
  city(t, 0, 1);
  improveCity(t, 0, "trade");
  resolveCitiesChoice(t, 0, { vertex: 1 });
  assert.equal(citiesBonus(t, 0), 4);
  assert.equal(metropolisAt(t, 0), "science");
  level(t, 0, "science", 5);
  assert.throws(() => improveCity(t, 0, "science"));
  invariants(t);
});
test("C&K seven barbarian events attack, count metropolises, award strongest defender and deactivate all knights", () => {
  const t = table();
  for (let p = 0; p < 4; p++) city(t, p, p);
  t.cities.metropolises.science = { owner: 3, vertex: 3 };
  knight(t, 0, 8, 3);
  knight(t, 1, 9, 1);
  knight(t, 2, 10, 3, false);
  for (let step = 0; step < 6; step++)
    assert.equal(resolveEventDie(t, 6, 1), null);
  const result = resolveEventDie(t, 6, 1)!;
  assert.equal(result.barbarianStrength, 4);
  assert.equal(result.knightStrength, 4);
  assert(result.defended);
  assert.deepEqual(result.affected, [0]);
  assert.equal(citiesBonus(t, 0), 1);
  assert.equal(t.cities.barbarianPosition, 0);
  assert(t.cities.knights.every((k) => !k.active));
  assert.equal(t.cities.attacks, 1);
});
test("C&K equal strongest defenders choose cards in roller-relative order; only active strength counts", () => {
  const t = table();
  t.active = 2;
  city(t, 0, 0);
  city(t, 1, 1);
  knight(t, 0, 8, 1);
  knight(t, 2, 9, 1);
  knight(t, 1, 10, 3, false);
  const result = attackBarbarians(t);
  assert.deepEqual(result.affected, [2, 0]);
  assert.equal(knightStrength(t, 0), 0);
  assert.deepEqual(
    t.cities.choices.map((c) => c.player),
    [2, 0],
  );
  resolveCitiesChoice(t, 2, { track: "trade" });
  resolveCitiesChoice(t, 0, { track: "trade" });
  assert.equal(t.cities.players[2].progress.length, 1);
  assert.equal(t.cities.players[0].progress.length, 1);
  assert.equal(citiesBonus(t, 0), 0);
});
test("C&K failed defense pillages all tied weakest vulnerable players, excludes metropolis-only and city-less players", () => {
  const t = table();
  city(t, 0, 0);
  city(t, 1, 1);
  city(t, 2, 2);
  t.cities.metropolises.science = { owner: 2, vertex: 2 };
  t.cities.players[0].improvements.science = 3;
  fund(t, 0, { brick: 2 });
  buildCityWall(t, 0, 0);
  const result = attackBarbarians(t);
  assert(!result.defended);
  assert.deepEqual(result.affected, [0, 1]);
  assert.throws(() => produceCitiesGoods(t, 5));
  resolveCitiesChoice(t, 0, { vertex: 0 });
  resolveCitiesChoice(t, 1, { vertex: 1 });
  assert.equal(t.board.vertices[0].city, false);
  assert.equal(t.board.vertices[1].city, false);
  assert.equal(t.board.vertices[2].city, true);
  assert.deepEqual(t.cities.walls, []);
  assert.equal(citiesDiscardLimit(t, 0), 7);
  assert.equal(t.cities.players[0].improvements.science, 3);
  resolveEventDie(t, 1, 4);
  assert.equal(
    t.cities.players[0].progress.length + t.cities.players[0].revealed.length,
    1,
    "Losing the last city preserves progress-card draws.",
  );
  invariants(t);
});
test("C&K pillaged city produces as a settlement on the attack roll", () => {
  const t = table(),
    tile = productionBoard(t, "ore");
  city(t, 0, tile.vertices[0]);
  attackBarbarians(t);
  resolveCitiesChoice(t, 0, { vertex: tile.vertices[0] });
  const result = produceCitiesGoods(t, 5);
  assert.equal(result.received[0].ore, 1);
  assert.equal(result.received[0].coin, 0);
  invariants(t);
});
test("C&K excess settlement count after pillage forces rebuilding a demoted city before another city", () => {
  const t = table();
  city(t, 0, 0);
  for (let id = 1; id <= 5; id++) city(t, 0, id, false);
  attackBarbarians(t);
  resolveCitiesChoice(t, 0, { vertex: 0 });
  assert.deepEqual(legalCitiesUpgrades(t, 0), [0]);
  fund(t, 0, { wheat: 2, ore: 3 });
  assert.throws(() => upgradeCitiesCity(t, 0, 1));
  upgradeCitiesCity(t, 0, 0);
  assert(legalCitiesUpgrades(t, 0).includes(1));
  invariants(t);
});
test("C&K event/red dice gate progress by track/level and deal in roller-relative order", () => {
  const t = table();
  t.active = 2;
  t.cities.players[0].improvements.science = 1;
  t.cities.players[1].improvements.science = 2;
  t.cities.players[2].improvements.science = 3;
  const expected = t.cities.decks.science.slice(0, 2).map((c) => c.id);
  resolveEventDie(t, 3, 4);
  assert.deepEqual(
    [t.cities.players[2].progress[0].id, t.cities.players[1].progress[0].id],
    expected,
  );
  assert.equal(t.cities.players[0].progress.length, 0);
  assert.equal(t.cities.players[3].progress.length, 0);
  assert.throws(() => resolveEventDie(t, 0, 4));
  assert.throws(() => resolveEventDie(t, 1, 7));
});
test("C&K public progress victory cards reveal immediately and never count toward hand limit", () => {
  const t = table();
  for (const [track, kind] of [
    ["science", "printer"],
    ["politics", "constitution"],
  ] as const) {
    const deck = t.cities.decks[track],
      at = deck.findIndex((c) => c.kind === kind),
      [card] = deck.splice(at, 1);
    deck.unshift(card);
    drawProgress(t, 1, track);
    assert.throws(() => returnProgress(t, 1, card.id));
  }
  assert.equal(citiesBonus(t, 1), 2);
  assert.equal(t.cities.players[1].progress.length, 0);
  assert.deepEqual(t.cities.choices, []);
});
test("C&K active player may hold five progress cards until end; sixth discards to five then end discards to four", () => {
  const t = table();
  for (let i = 0; i < 5; i++) drawProgress(t, 0, "trade");
  assert.equal(t.cities.choices.length, 0);
  drawProgress(t, 0, "trade");
  assert.equal(t.cities.choices[0].kind, "discardProgress");
  resolveCitiesChoice(t, 0, { cardId: t.cities.players[0].progress[0].id });
  assert.equal(t.cities.players[0].progress.length, 5);
  assert.deepEqual(t.cities.choices, []);
  queueProgressLimit(t, 0, true);
  resolveCitiesChoice(t, 0, { cardId: t.cities.players[0].progress[0].id });
  assert.equal(t.cities.players[0].progress.length, 4);
  assert.deepEqual(t.cities.choices, []);
});
test("C&K opponents must return their chosen fifth progress card to the matching deck bottom", () => {
  const t = table();
  for (let i = 0; i < 5; i++) drawProgress(t, 1, "trade");
  const id = t.cities.players[1].progress[2].id;
  assert.throws(() => resolveCitiesChoice(t, 0, { cardId: id }));
  resolveCitiesChoice(t, 1, { cardId: id });
  assert.equal(t.cities.players[1].progress.length, 4);
  assert.equal(t.cities.decks.trade.at(-1)!.id, id);
});
test("C&K serialized state retains decks/knights/choices while player and spectator projections hide private hands", () => {
  const t = table();
  drawProgress(t, 0, "trade");
  drawProgress(t, 1, "politics");
  knight(t, 0, 0, 2);
  const restored = JSON.parse(JSON.stringify(t)) as CitiesTable;
  assert.deepEqual(restored.cities, t.cities);
  assert.equal(JSON.stringify(restored), JSON.stringify(t));
  const own = citiesView(restored, 0),
    other = citiesView(restored, 1),
    observer = citiesView(restored, -1);
  assert.equal(own.players[0].progress!.length, 1);
  assert.equal(own.players[1].progress, undefined);
  assert.equal(other.players[0].progress, undefined);
  assert.equal(other.players[1].progress!.length, 1);
  assert(observer.players.every((p) => p.progress === undefined));
  assert(!("decks" in observer));
  own.players[0].progress![0].kind = "spy";
  own.knights[0].level = 1;
  assert.notEqual(t.cities.players[0].progress[0].kind, "spy");
  assert.equal(t.cities.knights[0].level, 2);
});
test("C&K bank trades resource/commodities with ports, Trading House, Merchant and turn-limited Fleet", () => {
  const t = table();
  const port = t.board.ports.find((p) => p.resource === "any")!;
  city(t, 0, t.board.edges[port.edge].a);
  assert.equal(citiesBankRatio(t, 0, "paper"), 3);
  t.cities.players[0].improvements.trade = 3;
  assert.equal(citiesBankRatio(t, 0, "paper"), 2);
  fund(t, 0, { paper: 2 });
  exchangeCitiesBank(t, 0, "paper", "ore");
  assert.equal(t.players[0].hand.ore, 1);
  const wood = t.board.tiles.find((x) => x.resource === "wood")!;
  t.cities.merchant = { owner: 0, tile: wood.id };
  assert.equal(citiesBankRatio(t, 0, "wood"), 2);
  assert.equal(citiesBonus(t, 0), 1);
  t.cities.merchantFleet = { owner: 1, good: "coin", turn: t.turn };
  assert.equal(citiesBankRatio(t, 1, "coin"), 2);
  t.turn++;
  assert.equal(citiesBankRatio(t, 1, "coin"), 4);
  invariants(t);
});
