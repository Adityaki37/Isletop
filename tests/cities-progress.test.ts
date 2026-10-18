import test from "node:test";
import assert from "node:assert/strict";
import { makeBoard, Resource } from "../lib/board";
import {
  BoardKnight,
  CitiesTable,
  GOODS,
  PROGRESS_COUNTS,
  ProgressKind,
  TRACKS,
  citiesBank,
  citiesBankRatio,
  citiesBonus,
  citiesHand,
  citiesView,
  createCitiesState,
  drawProgress,
  goodsTotal,
  moveKnight,
  resolveCitiesChoice,
} from "../lib/cities-knights";
import {
  ProgressArgs,
  ProgressContext,
  beginHarborExchange,
  buildProgressRoad,
  endCitiesEffects,
  finishHarbor,
  finishProgressRoads,
  openDiplomatRoads,
  playProgress,
  progressRoadChoices,
  resolveProgressChoice,
} from "../lib/cities-progress";
const exercised = new Set<ProgressKind>();
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
    const n = counts[r] ?? 0;
    t.players[p].hand[r] += n;
    t.bank[r] -= n;
  }
}
function city(t: CitiesTable, p: number, v: number, isCity = true) {
  Object.assign(t.board.vertices[v], { owner: p, city: isCity });
}
function knight(
  t: CitiesTable,
  owner: number,
  vertex: number,
  level: 1 | 2 | 3 = 1,
  active = true,
): BoardKnight {
  const k = {
    owner,
    vertex,
    level,
    active,
    activatedAt: active ? 9 : -1,
    upgradedAt: -1,
  };
  t.cities.knights.push(k);
  return k;
}
function grant(t: CitiesTable, p: number, kind: ProgressKind) {
  const track = TRACKS.find((track) => kind in PROGRESS_COUNTS[track])!;
  const deck = t.cities.decks[track],
    at = deck.findIndex((c) => c.kind === kind);
  assert(at >= 0);
  const [card] = deck.splice(at, 1);
  deck.unshift(card);
  assert.equal(drawProgress(t, p, track)!.id, card.id);
  return card.id;
}
function play(
  t: CitiesTable,
  kind: ProgressKind,
  a: ProgressArgs = {},
  context: ProgressContext = { phase: "action" },
  p = 0,
) {
  const id = grant(t, p, kind),
    result = playProgress(t, p, id, a, context, () => 0.5);
  exercised.add(kind);
  return { id, result };
}
function chain(t: CitiesTable, p = 0, length = 5) {
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
function conserved(t: CitiesTable) {
  const bank = citiesBank(t.players.length);
  for (const r of GOODS)
    assert.equal(
      t.bank[r] + t.players.reduce((n, p) => n + p.hand[r], 0),
      bank[r],
      `${r} conserved`,
    );
  const cards = [
    ...TRACKS.flatMap((track) => t.cities.decks[track]),
    ...t.cities.players.flatMap((p) => [...p.progress, ...p.revealed]),
  ];
  assert.equal(cards.length, 54);
  assert.equal(new Set(cards.map((c) => c.id)).size, 54);
}
function rejectsWithoutMutation(t: CitiesTable, action: () => unknown) {
  const before = JSON.stringify(t);
  assert.throws(action);
  assert.equal(JSON.stringify(t), before);
}

test("C&K Alchemist selects both numbered dice only before roll; malformed dice preserve card and state", () => {
  const t = table();
  const { id, result } = play(
    t,
    "alchemist",
    { dice: [6, 1] },
    { phase: "roll" },
  );
  assert.deepEqual(result.forcedDice, [6, 1]);
  assert.equal(t.cities.decks.science.at(-1)!.id, id);
  const second = grant(t, 0, "alchemist");
  for (const dice of [[7, 0], [1], [2, 1.2], [1, 2, 3]])
    rejectsWithoutMutation(t, () =>
      playProgress(t, 0, second, { dice }, { phase: "roll" }),
    );
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, second, { dice: [2, 3] }, { phase: "action" }),
  );
  conserved(t);
});
test("C&K Crane discounts a single city improvement and Engineer places a free legal wall", () => {
  const t = table();
  city(t, 0, 0);
  play(t, "crane", { track: "science" });
  assert.equal(t.cities.players[0].improvements.science, 1);
  fund(t, 0, { paper: 1 });
  play(t, "crane", { track: "science" });
  assert.equal(t.players[0].hand.paper, 0);
  assert.equal(t.cities.players[0].improvements.science, 2);
  play(t, "engineer", { vertex: 0 });
  assert.deepEqual(t.cities.walls, [0]);
  const id = grant(t, 0, "engineer");
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, { vertex: 0 }, { phase: "action" }),
  );
  conserved(t);
});
test("C&K Medicine pays one grain/two ore and requires a legal city upgrade", () => {
  const t = table();
  city(t, 0, 0, false);
  fund(t, 0, { wheat: 1, ore: 2 });
  play(t, "medicine", { vertex: 0 });
  assert(t.board.vertices[0].city);
  assert.equal(goodsTotal(t.players[0].hand), 0);
  const id = grant(t, 0, "medicine");
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, { vertex: 1 }, { phase: "action" }),
  );
  conserved(t);
});
test("C&K Inventor swaps eligible tokens including the robber tile, but rejects 2/6/8/12, same tile and fog", () => {
  const t = table(),
    a = t.board.tiles.find((x) => x.number === 3)!,
    b = t.board.tiles.find((x) => x.number === 11)!;
  t.board.robber = a.id;
  play(t, "inventor", { tiles: [a.id, b.id] });
  assert.equal(t.board.tiles[a.id].number, 11);
  assert.equal(t.board.tiles[b.id].number, 3);
  const id = grant(t, 0, "inventor");
  for (const n of [2, 6, 8, 12]) {
    const x = t.board.tiles.find((x) => x.number === n)!;
    rejectsWithoutMutation(t, () =>
      playProgress(t, 0, id, { tiles: [x.id, b.id] }, { phase: "action" }),
    );
  }
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, { tiles: [a.id, a.id] }, { phase: "action" }),
  );
  t.board.tiles[a.id].fog = true;
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, { tiles: [a.id, b.id] }, { phase: "action" }),
  );
  conserved(t);
});
test("C&K Irrigation/Mining count distinct touching terrain, ignore robber, and respect finite supply", () => {
  for (const [kind, r] of [
    ["irrigation", "wheat"],
    ["mining", "ore"],
  ] as const) {
    const t = table(),
      tiles = t.board.tiles.filter((tile) => tile.resource === r).slice(0, 2);
    for (const tile of tiles) {
      city(t, 0, tile.vertices[0]);
      city(t, 0, tile.vertices[2], false);
    }
    t.board.robber = tiles[0].id;
    const expected =
      2 *
      t.board.tiles.filter(
        (tile) =>
          tile.resource === r &&
          tile.vertices.some((id) => t.board.vertices[id].owner === 0),
      ).length;
    play(t, kind);
    assert.equal(t.players[0].hand[r], expected);
    conserved(t);
    fund(t, 1, { [r]: t.bank[r] - 1 });
    play(t, kind);
    assert.equal(t.players[0].hand[r], expected + 1);
    conserved(t);
  }
  const t = table(),
    id = grant(t, 0, "mining");
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, {}, { phase: "action" }),
  );
});
test("C&K Road Building requires two legal free placements and caps supply at fifteen", () => {
  const t = table();
  city(t, 0, 0, false);
  play(t, "roadBuilding");
  buildProgressRoad(t, 0, progressRoadChoices(t, 0)[0]);
  assert.equal(t.cities.freeRoutes!.remaining, 1);
  buildProgressRoad(t, 0, progressRoadChoices(t, 0)[0]);
  assert.equal(t.cities.freeRoutes, null);
  assert.equal(t.board.edges.filter((e) => e.owner === 0).length, 2);
  assert.equal(goodsTotal(t.players[0].hand), 0);
  conserved(t);
  const partial = table(),
    path = chain(partial, 0, 14);
  city(partial, 0, path.vertices[0], false);
  play(partial, "roadBuilding");
  buildProgressRoad(partial, 0, progressRoadChoices(partial, 0)[0]);
  assert.equal(partial.cities.freeRoutes, null);
  assert.equal(partial.board.edges.filter((e) => e.owner === 0).length, 15);
  const stop = table();
  city(stop, 0, 0, false);
  play(stop, "roadBuilding");
  assert.throws(() => finishProgressRoads(stop, 1));
  rejectsWithoutMutation(stop, () => finishProgressRoads(stop, 0));
  buildProgressRoad(stop, 0, progressRoadChoices(stop, 0)[0]);
  rejectsWithoutMutation(stop, () => finishProgressRoads(stop, 0));
  buildProgressRoad(stop, 0, progressRoadChoices(stop, 0)[0]);
  assert.equal(stop.cities.freeRoutes, null);
});
test("C&K Smith freely promotes two different knights, with an atomic rollback if the second is illegal", () => {
  const t = table();
  knight(t, 0, 0);
  knight(t, 0, 1, 1, false);
  play(t, "smith", { knights: [0, 1] });
  assert.deepEqual(
    t.cities.knights.map((k) => k.level),
    [2, 2],
  );
  assert.deepEqual(
    t.cities.knights.map((k) => k.active),
    [true, false],
  );
  assert.equal(goodsTotal(t.players[0].hand), 0);
  conserved(t);
  const invalid = table();
  knight(invalid, 0, 0);
  knight(invalid, 1, 1);
  const id = grant(invalid, 0, "smith");
  rejectsWithoutMutation(invalid, () =>
    playProgress(invalid, 0, id, { knights: [0, 1] }, { phase: "action" }),
  );
  rejectsWithoutMutation(invalid, () =>
    playProgress(invalid, 0, id, { knights: [0, 0] }, { phase: "action" }),
  );
});
test("C&K Merchant transfers its point and ratio to its owner and still works on the robber's tile", () => {
  const t = table(),
    tile = t.board.tiles.find((x) => x.resource === "wood")!;
  city(t, 0, tile.vertices[0]);
  city(t, 1, tile.vertices[2]);
  t.board.robber = tile.id;
  play(t, "merchant", { tile: tile.id });
  assert.equal(citiesBonus(t, 0), 1);
  assert.equal(citiesBankRatio(t, 0, "wood"), 2);
  endCitiesEffects(t);
  t.active = 1;
  t.turn++;
  play(t, "merchant", { tile: tile.id }, { phase: "action" }, 1);
  assert.equal(citiesBonus(t, 0), 0);
  assert.equal(citiesBonus(t, 1), 1);
  assert.equal(citiesBankRatio(t, 1, "wood"), 2);
  conserved(t);
});
test("C&K Merchant can occupy touching desert for its point but cannot occupy sea, gold or unrelated terrain", () => {
  const t = table(),
    desert = t.board.tiles.find((x) => x.resource === "desert")!;
  city(t, 0, desert.vertices[0]);
  play(t, "merchant", { tile: desert.id });
  assert.equal(citiesBonus(t, 0), 1);
  const id = grant(t, 0, "merchant"),
    unrelated = t.board.tiles.find(
      (x) => !x.vertices.includes(desert.vertices[0]),
    )!;
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, { tile: unrelated.id }, { phase: "action" }),
  );
  t.board.tiles[desert.id].resource = "sea";
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, { tile: desert.id }, { phase: "action" }),
  );
  t.board.tiles[desert.id].resource = "gold";
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, { tile: desert.id }, { phase: "action" }),
  );
});
test("C&K two Merchant Fleets retain both chosen card discounts until the turn ends", () => {
  const t = table();
  play(t, "merchantFleet", { good: "wood" });
  play(t, "merchantFleet", { good: "coin" });
  assert.equal(citiesBankRatio(t, 0, "wood"), 2);
  assert.equal(citiesBankRatio(t, 0, "coin"), 2);
  assert.equal(citiesBankRatio(t, 1, "coin"), 4);
  endCitiesEffects(t);
  assert.equal(citiesBankRatio(t, 0, "wood"), 4);
  assert.equal(citiesBankRatio(t, 0, "coin"), 4);
  conserved(t);
});
test("C&K Resource/Commodity Monopoly take up to two/one per opponent and leave unrelated cards/bank alone", () => {
  const t = table();
  fund(t, 1, { wood: 3, paper: 3 });
  fund(t, 2, { wood: 1, paper: 1 });
  fund(t, 3, { cloth: 1 });
  play(t, "resourceMonopoly", { good: "wood" });
  assert.equal(t.players[0].hand.wood, 3);
  assert.equal(t.players[1].hand.wood, 1);
  play(t, "commodityMonopoly", { good: "paper" });
  assert.equal(t.players[0].hand.paper, 2);
  assert.equal(t.players[1].hand.paper, 2);
  assert.equal(t.players[3].hand.cloth, 1);
  const id = grant(t, 0, "resourceMonopoly");
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, { good: "coin" }, { phase: "action" }),
  );
  conserved(t);
});
test("C&K Commercial Harbor gives its victim the commodity choice and hides the offered resource from spectators", () => {
  const t = table();
  fund(t, 0, { wood: 2 });
  fund(t, 1, { paper: 1, coin: 1 });
  const { id } = play(t, "commercialHarbor");
  beginHarborExchange(t, 0, id, 1, "wood");
  assert.equal(t.players[0].hand.wood, 2);
  assert.equal(citiesView(t, 0).choice!.kind, "harborExchange");
  assert.equal("resource" in citiesView(t, -1).choice!, false);
  assert.equal("resource" in citiesView(t, 2).choice!, false);
  assert.equal("resource" in citiesView(t, 1).choice!, true);
  rejectsWithoutMutation(t, () =>
    resolveProgressChoice(t, 0, { commodity: "paper" }),
  );
  rejectsWithoutMutation(t, () =>
    resolveProgressChoice(t, 1, { commodity: "cloth" }),
  );
  resolveProgressChoice(t, 1, { commodity: "coin" });
  assert.equal(t.players[0].hand.coin, 1);
  assert.equal(t.players[1].hand.wood, 1);
  assert.equal(t.players[1].hand.paper, 1);
  rejectsWithoutMutation(t, () => beginHarborExchange(t, 0, id, 1, "wood"));
  conserved(t);
});
test("C&K Commercial Harbor can stop early, grants no exchange without a commodity and expires after the turn", () => {
  const t = table();
  fund(t, 0, { wheat: 1 });
  const { id } = play(t, "commercialHarbor");
  beginHarborExchange(t, 0, id, 1, "wheat");
  assert.equal(t.players[0].hand.wheat, 1);
  assert.equal(t.cities.choices.length, 0);
  finishHarbor(t, 0, id);
  assert.equal(t.cities.harbors.length, 0);
  const next = play(t, "commercialHarbor");
  endCitiesEffects(t);
  rejectsWithoutMutation(t, () =>
    beginHarborExchange(t, 0, next.id, 2, "wheat"),
  );
  conserved(t);
});
test("C&K Master Merchant reveals a higher-scoring victim only to the user and takes their exact two selected cards", () => {
  const t = table();
  fund(t, 1, { wood: 1, paper: 2, coin: 1 });
  play(
    t,
    "masterMerchant",
    { target: 1 },
    { phase: "action", points: [2, 5, 2, 2] },
  );
  assert.deepEqual(citiesView(t, 0).peek!.hand, t.players[1].hand);
  for (const viewer of [-1, 1, 2, 3])
    assert.equal(citiesView(t, viewer).peek, null);
  citiesView(t, 0).peek!.hand!.paper = 100;
  assert.equal(t.players[1].hand.paper, 2);
  const restored = JSON.parse(JSON.stringify(t)) as CitiesTable;
  assert.deepEqual(citiesView(restored, 0).peek!.hand, t.players[1].hand);
  rejectsWithoutMutation(t, () =>
    resolveProgressChoice(t, 1, { resources: { wood: 1, paper: 1 } }),
  );
  rejectsWithoutMutation(t, () =>
    resolveProgressChoice(t, 0, { resources: { sheep: 2 } }),
  );
  resolveProgressChoice(t, 0, { resources: { wood: 1, paper: 1 } });
  assert.equal(t.players[0].hand.wood, 1);
  assert.equal(t.players[0].hand.paper, 1);
  assert.equal(t.players[1].hand.coin, 1);
  assert.equal(citiesView(t, 0).peek, null);
  rejectsWithoutMutation(t, () =>
    resolveProgressChoice(t, 0, { resources: { coin: 1, paper: 1 } }),
  );
  conserved(t);
});
test("C&K Master Merchant rejects equal-score targets and takes only one if the victim has one card", () => {
  const t = table();
  fund(t, 1, { coin: 1 });
  const id = grant(t, 0, "masterMerchant");
  rejectsWithoutMutation(t, () =>
    playProgress(
      t,
      0,
      id,
      { target: 1 },
      { phase: "action", points: [3, 3, 3, 3] },
    ),
  );
  playProgress(
    t,
    0,
    id,
    { target: 1 },
    { phase: "action", points: [2, 3, 2, 2] },
  );
  resolveProgressChoice(t, 0, { resources: { coin: 1 } });
  assert.equal(t.players[0].hand.coin, 1);
  conserved(t);
});
test("C&K Bishop steals once per adjacent opponent, includes commodities, ignores own pieces and respects robber locks", () => {
  const t = table(),
    tile = t.board.tiles.find((x) => x.id !== t.board.robber)!;
  city(t, 0, tile.vertices[0]);
  city(t, 1, tile.vertices[1]);
  city(t, 1, tile.vertices[2]);
  city(t, 2, tile.vertices[3]);
  fund(t, 1, { coin: 2 });
  fund(t, 2, { cloth: 1 });
  const id = grant(t, 0, "bishop");
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, { tile: tile.id }, { phase: "action" }),
  );
  t.cities.attacks = 1;
  rejectsWithoutMutation(t, () =>
    playProgress(
      t,
      0,
      id,
      { tile: tile.id },
      { phase: "action", legalRobberTiles: [] },
    ),
  );
  playProgress(
    t,
    0,
    id,
    { tile: tile.id },
    { phase: "action", legalRobberTiles: [tile.id] },
    () => 0.5,
  );
  exercised.add("bishop");
  assert.equal(t.players[0].hand.coin, 1);
  assert.equal(t.players[0].hand.cloth, 1);
  assert.equal(t.players[1].hand.coin, 1);
  assert.equal(t.board.robber, tile.id);
  conserved(t);
});
test("C&K active mighty Deserter may be placed without Fortress and can act immediately", () => {
  const t = table(),
    path = chain(t),
    v = path.vertices;
  knight(t, 1, v[5], 3);
  play(t, "deserter", { target: 1 });
  rejectsWithoutMutation(t, () =>
    resolveProgressChoice(t, 0, { vertex: v[5] }),
  );
  resolveProgressChoice(t, 1, { vertex: v[5] });
  assert.equal(t.cities.choices[0].kind, "deserterPlace");
  resolveProgressChoice(t, 0, { vertex: v[0] });
  assert.equal(t.cities.knights[0].level, 3);
  assert.equal(t.cities.players[0].improvements.politics, 0);
  assert(t.cities.knights[0].active);
  moveKnight(t, 0, v[0], v[1]);
  assert.equal(t.cities.knights[0].active, false);
  conserved(t);
});
test("C&K Deserter's victim selects the knight; unavailable strength falls back to basic or skips placement", () => {
  const t = table(),
    path = chain(t),
    v = path.vertices;
  knight(t, 0, v[0], 3);
  knight(t, 0, v[1], 3);
  knight(t, 1, v[4], 3, false);
  knight(t, 1, v[5], 1);
  play(t, "deserter", { target: 1 });
  resolveProgressChoice(t, 1, { vertex: v[4] });
  const choice = t.cities.choices[0];
  assert.equal(choice.kind, "deserterPlace");
  if (choice.kind !== "deserterPlace")
    throw new Error("Expected placement choice");
  assert.equal(choice.knight.level, 1);
  assert.equal(choice.knight.active, false);
  resolveProgressChoice(t, 0, { vertex: v[2] });
  assert(t.cities.knights.some((k) => k.owner === 1 && k.vertex === v[5]));
  const full = table();
  chain(full, 0, 8);
  for (let i = 0; i < 6; i++)
    knight(full, 0, i, (1 + Math.floor(i / 2)) as 1 | 2 | 3);
  knight(full, 1, 9, 2);
  play(full, "deserter", { target: 1 });
  resolveProgressChoice(full, 1, { vertex: 9 });
  assert.equal(full.cities.knights.filter((k) => k.owner === 0).length, 6);
  assert.equal(full.cities.choices.length, 0);
  conserved(full);
});
test("C&K Intrigue can displace a mighty knight without another knight and preserves the victim's active state", () => {
  const t = table(),
    path = chain(t),
    v = path.vertices,
    extra = t.board.vertices[v[3]].edges.find((id) => !path.edges.includes(id));
  assert.notEqual(extra, undefined);
  t.board.edges[extra!].owner = 1;
  const e = t.board.edges[extra!],
    dest = e.a === v[3] ? e.b : e.a;
  knight(t, 1, v[3], 3);
  play(t, "intrigue", { vertex: v[3] });
  assert.equal(t.cities.choices[0].kind, "relocateKnight");
  rejectsWithoutMutation(t, () =>
    resolveProgressChoice(t, 1, { vertex: dest }),
  );
  resolveCitiesChoice(t, 1, { vertex: dest });
  assert.equal(t.cities.knights[0].vertex, dest);
  assert.equal(t.cities.knights[0].level, 3);
  assert(t.cities.knights[0].active);
  conserved(t);
});
test("C&K Deserter allows the card owner to decline the free knight after the victim removes theirs", () => {
  const t = table(),
    path = chain(t);
  knight(t, 1, path.vertices[5], 2);
  play(t, "deserter", { target: 1 });
  resolveProgressChoice(t, 1, { vertex: path.vertices[5] });
  assert.equal(t.cities.choices[0].kind, "deserterPlace");
  rejectsWithoutMutation(t, () => resolveProgressChoice(t, 0, {}));
  rejectsWithoutMutation(t, () =>
    resolveProgressChoice(t, 1, { vertex: null }),
  );
  resolveProgressChoice(t, 0, { vertex: null });
  assert.equal(t.cities.choices.length, 0);
  assert.equal(t.cities.knights.length, 0);
  conserved(t);
});
test("C&K Diplomat removes an opponent's open road, or defers own road award until relocation/skip", () => {
  const foreign = table(),
    path = chain(foreign, 1);
  city(foreign, 1, path.vertices[0]);
  play(foreign, "diplomat", { edge: path.edges.at(-1) });
  assert.equal(foreign.board.edges[path.edges.at(-1)!].owner, null);
  assert.equal(foreign.cities.choices.length, 0);
  const t = table(),
    own = chain(t);
  city(t, 0, own.vertices[0]);
  const old = own.edges.at(-1)!;
  const { result } = play(t, "diplomat", { edge: old });
  assert(result.deferRoadAward);
  assert.equal(t.cities.choices[0].kind, "relocateRoad");
  const choice = t.cities.choices[0];
  if (choice.kind !== "relocateRoad") throw new Error("Expected relocation");
  resolveProgressChoice(t, 0, { edge: choice.edges[0] });
  assert.equal(
    t.board.edges.filter((e) => e.owner === 0).length,
    own.edges.length,
  );
  const skip = table(),
    skipPath = chain(skip);
  city(skip, 0, skipPath.vertices[0]);
  play(skip, "diplomat", { edge: skipPath.edges.at(-1) });
  resolveProgressChoice(skip, 0, { edge: null });
  assert.equal(
    skip.board.edges.filter((e) => e.owner === 0).length,
    skipPath.edges.length - 1,
  );
  conserved(t);
});
test("C&K Diplomat cannot treat opposing road interruptions as open ends or strand a knight", () => {
  const t = table(),
    path = chain(t);
  knight(t, 1, path.vertices[2]);
  assert(!openDiplomatRoads(t).includes(path.edges[1]));
  assert(!openDiplomatRoads(t).includes(path.edges[2]));
  const stranded = table(),
    e = stranded.board.edges[0];
  e.owner = 0;
  knight(stranded, 0, e.a);
  const id = grant(stranded, 0, "diplomat");
  rejectsWithoutMutation(stranded, () =>
    playProgress(stranded, 0, id, { edge: e.id }, { phase: "action" }),
  );
});
test("C&K Wedding affects higher scores only, lets each victim choose cards, and handles one-card hands", () => {
  const t = table();
  fund(t, 1, { wood: 1, paper: 2 });
  fund(t, 2, { ore: 2 });
  fund(t, 3, { cloth: 1 });
  play(t, "wedding", {}, { phase: "action", points: [2, 3, 2, 4] });
  assert.deepEqual(
    t.cities.choices.map((c) => c.player),
    [1, 3],
  );
  rejectsWithoutMutation(t, () =>
    resolveProgressChoice(t, 0, { resources: { wood: 1, paper: 1 } }),
  );
  resolveProgressChoice(t, 1, { resources: { wood: 1, paper: 1 } });
  resolveProgressChoice(t, 3, { resources: { cloth: 1 } });
  assert.equal(t.players[0].hand.wood, 1);
  assert.equal(t.players[0].hand.paper, 1);
  assert.equal(t.players[0].hand.cloth, 1);
  assert.equal(t.players[2].hand.ore, 2);
  conserved(t);
});
test("C&K Saboteur affects equal/higher opponents, uses total resources/commodities and exact floor-half discards", () => {
  const t = table();
  fund(t, 0, { wood: 2 });
  fund(t, 1, { coin: 3, brick: 2 });
  fund(t, 2, { paper: 4, wheat: 2 });
  play(t, "saboteur", {}, { phase: "action", points: [3, 3, 4, 2] });
  assert.deepEqual(
    t.cities.choices.map((c) => c.player),
    [1, 2],
  );
  rejectsWithoutMutation(t, () =>
    resolveProgressChoice(t, 1, { resources: { coin: 3 } }),
  );
  resolveProgressChoice(t, 1, { resources: { coin: 2 } });
  resolveProgressChoice(t, 2, { resources: { paper: 2, wheat: 1 } });
  assert.equal(goodsTotal(t.players[1].hand), 3);
  assert.equal(goodsTotal(t.players[2].hand), 3);
  assert.equal(t.players[0].hand.wood, 2);
  conserved(t);
});
test("C&K Spy grants a temporary private progress-hand view, cannot steal victory cards and can replay a stolen Spy", () => {
  const t = table(),
    victimSpy = grant(t, 1, "spy");
  grant(t, 1, "mining");
  const printer = grant(t, 1, "printer");
  const merchant = grant(t, 2, "merchant");
  play(t, "spy", { target: 1 });
  assert.equal(citiesView(t, 0).peek!.progress!.length, 2);
  for (const p of [-1, 1, 2, 3]) assert.equal(citiesView(t, p).peek, null);
  rejectsWithoutMutation(t, () =>
    resolveProgressChoice(t, 0, { cardId: printer }),
  );
  resolveProgressChoice(t, 0, { cardId: victimSpy });
  assert.equal(citiesView(t, 0).peek, null);
  playProgress(t, 0, victimSpy, { target: 2 }, { phase: "action" });
  resolveProgressChoice(t, 0, { cardId: merchant });
  assert(t.cities.players[0].progress.some((c) => c.id === merchant));
  conserved(t);
});
test("C&K Warlord activates inactive knights for free, preserves old active timing, and cannot enable a new same-turn action", () => {
  const t = table(),
    path = chain(t),
    v = path.vertices;
  knight(t, 0, v[0]);
  knight(t, 0, v[4], 1, false);
  play(t, "warlord");
  assert(t.cities.knights.every((k) => k.active));
  assert.equal(goodsTotal(t.players[0].hand), 0);
  rejectsWithoutMutation(t, () => moveKnight(t, 0, v[4], v[3]));
  moveKnight(t, 0, v[0], v[1]);
  assert(!t.cities.knights.find((k) => k.vertex === v[1])!.active);
  conserved(t);
});
test("C&K progress ownership, before-roll restrictions, pending choices and duplicate uses are authoritative", () => {
  const t = table();
  city(t, 0, 0);
  const id = grant(t, 0, "engineer");
  rejectsWithoutMutation(t, () =>
    playProgress(t, 1, id, { vertex: 0 }, { phase: "action" }),
  );
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, { vertex: 0 }, { phase: "roll" }),
  );
  t.cities.choices.push({ kind: "aqueduct", player: 0 });
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, { vertex: 0 }, { phase: "action" }),
  );
  resolveCitiesChoice(t, 0, { resource: "wood" });
  playProgress(t, 0, id, { vertex: 0 }, { phase: "action" });
  rejectsWithoutMutation(t, () =>
    playProgress(t, 0, id, { vertex: 0 }, { phase: "action" }),
  );
  conserved(t);
});
test("C&K general choice handler cannot silently dismiss a private progress-card choice", () => {
  const t = table();
  grant(t, 1, "mining");
  play(t, "spy", { target: 1 });
  rejectsWithoutMutation(t, () => resolveCitiesChoice(t, 0, {}));
  assert.equal(t.cities.choices[0].kind, "spy");
});
test("C&K all playable progress effects have exercised outcomes; victory cards are covered by automatic draw tests", () => {
  const required = TRACKS.flatMap((track) =>
    Object.keys(PROGRESS_COUNTS[track]),
  )
    .filter((kind) => !["printer", "constitution"].includes(kind))
    .sort();
  assert.deepEqual([...exercised].sort(), required);
});
