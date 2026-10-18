import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import test from "node:test";
import assert from "node:assert/strict";
import { RESOURCES, Resource } from "../lib/board";
import {
  Game,
  Action,
  createGame,
  player,
  addPlayer,
  actor,
  legalSettlements,
  legalRoads,
  legalCities,
  points,
  roadLength,
  awards,
  view,
  total,
  advanceClock,
  moveContext,
  normalizeGame,
  AVAILABLE_GAME_MODES,
} from "../lib/game";
import { citiesTable, citiesTimeoutChoice } from "../lib/cities-room";
import { victoryPointBreakdown } from "../lib/match-results";
import {
  CitiesHand,
  GOODS,
  TRACKS,
  ProgressKind,
  citiesHand,
  knightAt,
} from "../lib/cities-knights";

const NOW = 100000;
test("C&K final victory breakdown includes every public expansion bonus", () => {
  const g = game();
  const ownCity = g.board.vertices.find(v => v.owner === 0 && v.city)!;
  g.cities!.players[0].defenders = 2;
  g.cities!.players[0].revealed = [{id: 999, kind: "printer", track: "science"}];
  g.cities!.metropolises.science = {owner: 0, vertex: ownCity.id};
  g.cities!.merchant = {owner: 0, tile: 0};
  g.phase = "finished";
  g.winner = 0;
  const result = view(g, null);
  const breakdown = victoryPointBreakdown(result, 0);
  assert.equal(breakdown.defenders, 2);
  assert.equal(breakdown.progressPoints, 1);
  assert.equal(breakdown.metropolises, 2);
  assert.equal(breakdown.merchant, 1);
  assert.equal(Object.values(breakdown).reduce((sum, n) => sum + n, 0), result.players[0].score);
});
test("C&K Road Building timeout places both free routes and clears the progress flow", () => {
  const g = game();
  g.phase = "action";
  g.turnSeconds = 30;
  const roads = g.board.edges.filter(e => e.owner === 0).length;
  const cardId = grant(g, 0, "roadBuilding");
  applyAction(g, 0, { type: "progress", cardId }, () => 0.42, NOW);
  advanceClock(g, g.deadline!, () => 0.42);
  assert.equal(g.board.edges.filter(e => e.owner === 0).length, roads + 2);
  assert.equal(g.phase, "action");
  assert.equal(g.freeRoads, 0);
  assert.equal(g.cities!.freeRoutes, null);
  conserved(g);
});
test("C&K statistics count Alchemist replay and same-ID redraw separately", () => {
  const g = game();
  const id = grant(g, 0, "alchemist");
  // Empty the source deck into another seat's fixture hand. Returning the
  // played Alchemist makes it the only science card available to draw.
  g.cities!.players[1].progress.push(...g.cities!.decks.science.splice(0));
  g.cities!.players[0].improvements.science = 1;
  applyAction(
    g,
    0,
    { type: "progress", cardId: id, dice: [5, 1] },
    () => 0.6,
    NOW,
  );
  const row = g.statistics!.players[0];
  assert.equal(row.cardsUsed.alchemist, 1);
  assert.equal(row.cardsBought.alchemist, 1);
  assert.equal(row.activity.progressCardsDiscarded, 0);
  assert(g.cities!.players[0].progress.some((card) => card.id === id));
  assert.equal(view(g, "p0").statistics, null);
  conserved(g);
});

test("C&K statistics count public point cards as drawn and never played", () => {
  const g = game();
  g.cities!.players[0].improvements.science = 1;
  const deck = g.cities!.decks.science;
  deck.unshift(
    deck.splice(
      deck.findIndex((card) => card.kind === "printer"),
      1,
    )[0],
  );
  applyAction(g, 0, { type: "roll" }, dice(5, 1, 4), NOW);
  assert.equal(g.statistics!.players[0].cardsBought.printer, 1);
  assert.equal(g.statistics!.players[0].cardsUsed.printer, undefined);
  assert.equal(g.statistics!.players[0].activity.devCardsUsed, 0);
  assert.equal(g.cities!.players[0].revealed[0].kind, "printer");
  conserved(g);
});

test("C&K statistics retain blocked commodity production and classify Aqueduct as dice income", () => {
  const g = game();
  zero(g);
  emptyBoard(g);
  const tile = g.board.tiles.find((tile) => tile.resource === "ore")!;
  for (const other of g.board.tiles)
    other.number = other.id === tile.id ? 6 : 2;
  Object.assign(g.board.vertices[tile.vertices[0]], { owner: 0, city: true });
  g.board.robber = tile.id;
  g.cities!.players[0].improvements.science = 3;
  applyAction(g, 0, { type: "roll" }, dice(3, 3, 5), NOW);
  assert.equal(g.cities!.choices[0].kind, "aqueduct");
  assert.equal(g.statistics!.players[0].activity.resourceIncomeBlocked, 2);
  applyAction(
    g,
    0,
    { type: "citiesChoice", resource: "wheat" },
    () => 0.42,
    NOW,
  );
  assert.equal(g.statistics!.players[0].resources.rollingIncome, 1);
  assert.equal(g.statistics!.players[0].resources.devCardIncome, 0);
  assert(g.log.includes("Alice got 1 wheat from Aqueduct."));
  assert.equal(g.statistics!.players[0].activity.resourceIncomeBlocked, 2);
  conserved(g);
});

test("C&K statistics distinguish a depleted commodity bank from paid resource production", () => {
  const g = game();
  zero(g);
  emptyBoard(g);
  const tile = g.board.tiles.find((tile) => tile.resource === "wood")!;
  g.board.robber = g.board.tiles.find((other) => other.id !== tile.id)!.id;
  for (const other of g.board.tiles)
    other.number = other.id === tile.id ? 6 : 2;
  Object.assign(g.board.vertices[tile.vertices[0]], { owner: 0, city: true });
  fund(g, 1, { paper: 12 });
  applyAction(g, 0, { type: "roll" }, dice(3, 3, 5), NOW);
  assert.equal(g.statistics!.players[0].resources.rollingIncome, 1);
  assert.equal(g.statistics!.players[0].received.paper, 0);
  assert.equal(g.statistics!.players[0].activity.resourceIncomeBlocked, 1);
  assert.equal(g.players[0].hand.wood, 1);
  assert(g.log.includes("Alice got 1 wood."));
  assert(!g.log.some((line) => line.includes("got") && line.includes("paper")));
  conserved(g);
});
function lobby(n = 4, capacity = n) {
  const g = createGame(
    "CITY22",
    player("p0", "Alice"),
    capacity,
    false,
    "citiesKnights",
  );
  g.turnSeconds = 0;
  for (let p = 1; p < n; p++) {
    addPlayer(g, player(`p${p}`, `Player ${p}`));
  }
  for (let p = 1; p < n; p++) applyAction(g, p, { type: "ready" });
  return g;
}
function setup(g: Game) {
  applyAction(g, 0, { type: "start" }, () => 0.42, NOW);
  while (g.phase.startsWith("setup")) {
    const p = actor(g);
    const moves =
      g.phase === "setupSettlement"
        ? legalSettlements(g, p, true)
        : legalRoads(g, p, true);
    assert(moves.length);
    applyAction(
      g,
      p,
      {
        type: g.phase === "setupSettlement" ? "settlement" : "road",
        id: moves[0],
      },
      () => 0.42,
      NOW,
    );
  }
}
function game(n = 4, capacity = n) {
  const g = lobby(n, capacity);
  setup(g);
  return g;
}
function fund(g: Game, p: number, h: Partial<CitiesHand>) {
  for (const r of GOODS) {
    const amount = h[r] ?? 0;
    g.players[p].hand[r] = (g.players[p].hand[r] ?? 0) + amount;
    g.bank[r] = (g.bank[r] ?? 0) - amount;
  }
}
function zero(g: Game) {
  for (let p = 0; p < g.players.length; p++)
    for (const r of GOODS) {
      g.bank[r] = (g.bank[r] ?? 0) + (g.players[p].hand[r] ?? 0);
      g.players[p].hand[r] = 0;
    }
}
function emptyBoard(g: Game) {
  for (const v of g.board.vertices) {
    v.owner = null;
    v.city = false;
  }
  for (const e of g.board.edges) {
    e.owner = null;
    delete e.kind;
  }
  g.cities!.knights = [];
  g.cities!.walls = [];
  g.longest = null;
  g.army = null;
}
function action(g: Game, p = 0) {
  g.active = p;
  g.phase = "action";
  g.citiesFlow = null;
  g.cities!.choices = [];
  g.turn = 10;
}
function grant(g: Game, p: number, kind: ProgressKind) {
  const track = TRACKS.find((track) =>
    g.cities!.decks[track].some((c) => c.kind === kind),
  );
  assert(track);
  const deck = g.cities!.decks[track],
    at = deck.findIndex((c) => c.kind === kind),
    card = deck.splice(at, 1)[0];
  g.cities!.players[p].progress.push(card);
  return card.id;
}
function conserved(g: Game) {
  for (const r of GOODS) {
    assert((g.bank[r] ?? 0) >= 0, `negative bank ${r}`);
    const expected = RESOURCES.includes(r as Resource)
      ? g.capacity <= 4
        ? 19
        : 24
      : g.capacity <= 4
        ? 12
        : 18;
    assert.equal(
      (g.bank[r] ?? 0) + g.players.reduce((n, p) => n + (p.hand[r] ?? 0), 0),
      expected,
      r,
    );
    for (const p of g.players)
      assert(Number.isInteger(p.hand[r]) && (p.hand[r] ?? 0) >= 0);
  }
  const cards = [
    ...TRACKS.flatMap((track) => g.cities!.decks[track]),
    ...g.cities!.players.flatMap((p) => [...p.progress, ...p.revealed]),
  ];
  assert.equal(cards.length, 54);
  assert.equal(new Set(cards.map((c) => c.id)).size, 54);
}
function rejected(g: Game, p: number, a: Action, pattern?: RegExp) {
  const before = JSON.stringify(g);
  assert.throws(() => applyAction(g, p, a, () => 0.42, NOW), pattern ?? Error);
  assert.equal(JSON.stringify(g), before);
}
function dice(yellow: number, red: number, event: number) {
  const rolls = [yellow, red, event];
  return () => {
    const n = rolls.shift();
    assert.notEqual(n, undefined, "rolled a die twice");
    return (n! - 0.5) / 6;
  };
}
function resolve(g: Game) {
  let count = 0;
  while (g.phase === "citiesChoice") {
    assert(count++ < 30);
    applyAction(
      g,
      actor(g),
      citiesTimeoutChoice(g, () => 0.42),
      () => 0.42,
      NOW,
    );
  }
}
function chain(g: Game, p = 0, length = 6) {
  const vertices: number[] = [],
    edges: number[] = [];
  function walk(v: number): boolean {
    vertices.push(v);
    if (edges.length === length) return true;
    for (const id of g.board.vertices[v].edges) {
      const e = g.board.edges[id],
        next = e.a === v ? e.b : e.a;
      if (vertices.includes(next) || e.owner !== null) continue;
      edges.push(id);
      if (walk(next)) return true;
      edges.pop();
    }
    vertices.pop();
    return false;
  }
  assert(walk(0));
  for (const id of edges)
    Object.assign(g.board.edges[id], { owner: p, kind: "road" });
  return { vertices, edges };
}

test("C&K room setup places one settlement and one city per seat, grants resources once and uses no development deck", () => {
  for (const n of [3, 4, 6]) {
    const g = lobby(n);
    assert.equal(g.target, 13);
    assert(AVAILABLE_GAME_MODES.includes("citiesKnights"));
    setup(g);
    assert.equal(g.phase, "roll");
    assert.equal(g.turn, 1);
    assert.equal(g.active, 0);
    assert.equal(g.deck.length, 0);
    for (let p = 0; p < n; p++) {
      const buildings = g.board.vertices.filter((v) => v.owner === p);
      assert.equal(buildings.length, 2);
      assert.equal(buildings.filter((v) => v.city).length, 1);
      assert.equal(points(g, p), 3);
      const initial = citiesHand();
      for (const id of buildings.find((v) => v.city)!.tiles) {
        const r = g.board.tiles[id].resource;
        if (RESOURCES.includes(r as Resource)) initial[r as Resource]++;
      }
      assert.deepEqual(g.players[p].hand, initial);
      assert.equal(g.board.edges.filter((e) => e.owner === p).length, 2);
    }
    conserved(g);
  }
});
test("C&K room capacity, readiness and lobby rule changes remain authoritative", () => {
  assert.throws(() =>
    createGame("CITY22", player("p0", "Alice"), 8, false, "citiesKnights"),
  );
  const g = lobby(3, 6);
  g.players[1].ready = false;
  assert.throws(() => applyAction(g, 0, { type: "start" }), /ready/);
  g.players[1].ready = true;
  applyAction(g, 0, { type: "settings", mode: "base" });
  assert.equal(g.target, 10);
  assert(g.players.every((p) => !p.ready));
  applyAction(g, 0, { type: "settings", mode: "citiesKnights", capacity: 4 });
  assert.equal(g.target, 13);
  assert.equal(g.mode, "citiesKnights");
});
test("C&K room city production uses all eight goods and finite resources", () => {
  const g = game();
  zero(g);
  emptyBoard(g);
  const tile = g.board.tiles.find(
    (t) => t.resource === "wood" && t.id !== g.board.robber,
  )!;
  tile.number = 6;
  for (const t of g.board.tiles) if (t.id !== tile.id) t.number = 2;
  Object.assign(g.board.vertices[tile.vertices[0]], { owner: 0, city: true });
  applyAction(g, 0, { type: "roll" }, dice(3, 3, 4), NOW);
  assert.equal(g.phase, "action");
  assert.equal(g.players[0].hand.wood, 1);
  assert.equal(g.players[0].hand.paper, 1);
  assert.equal(total(g.players[0].hand), 2);
  assert.equal(g.statistics!.players[0].resources.rollingIncome, 2);
  assert.equal(g.statistics!.players[0].received.paper, 1);
  conserved(g);
});
test("C&K event choices precede production; pillaged cities produce as settlements on the same roll", () => {
  const g = game();
  zero(g);
  emptyBoard(g);
  const tile = g.board.tiles.find(
    (t) => t.resource === "wood" && t.id !== g.board.robber,
  )!;
  for (const t of g.board.tiles) t.number = t.id === tile.id ? 6 : 2;
  Object.assign(g.board.vertices[tile.vertices[0]], { owner: 0, city: true });
  g.cities!.barbarianPosition = 6;
  applyAction(g, 0, { type: "roll" }, dice(3, 3, 1), NOW);
  assert.equal(g.phase, "citiesChoice");
  assert.equal(g.cities!.choices[0].kind, "pillage");
  assert.equal(g.players[0].hand.wood, 0);
  assert.equal(g.players[0].hand.paper, 0);
  const reload = JSON.parse(JSON.stringify(g)) as Game;
  rejected(reload, 0, { type: "roll" });
  applyAction(
    reload,
    0,
    { type: "citiesChoice", vertex: tile.vertices[0] },
    () => 0.42,
    NOW,
  );
  assert.equal(reload.phase, "action");
  assert.equal(reload.players[0].hand.wood, 1);
  assert.equal(reload.players[0].hand.paper, 0);
  assert.equal(reload.board.vertices[tile.vertices[0]].city, false);
  rejected(reload, 0, { type: "citiesChoice", vertex: tile.vertices[0] });
  assert.equal(reload.rollCounts[6], 1);
  assert.equal(reload.statistics!.players[0].resources.rollingIncome, 1);
  assert.equal(reload.statistics!.players[0].resources.devCardIncome, 0);
  assert.equal(reload.statistics!.players[0].activity.resourceIncomeBlocked, 0);
  conserved(reload);
});
test("C&K progress-hand discards resolve before numbered production and can be resumed after reload", () => {
  const g = game();
  zero(g);
  emptyBoard(g);
  const tile = g.board.tiles.find(
    (t) => t.resource === "wood" && t.id !== g.board.robber,
  )!;
  Object.assign(g.board.vertices[tile.vertices[0]], { owner: 1, city: true });
  for (const t of g.board.tiles) t.number = t.id === tile.id ? 6 : 2;
  g.cities!.players[1].improvements.science = 1;
  for (let i = 0; i < 4; i++) grant(g, 1, i % 2 ? "inventor" : "irrigation");
  // Put a non-VP card first so the event necessarily requires an opponent discard.
  const deck = g.cities!.decks.science,
    at = deck.findIndex((c) => c.kind === "medicine");
  deck.unshift(deck.splice(at, 1)[0]);
  applyAction(g, 0, { type: "roll" }, dice(5, 1, 4), NOW);
  assert.equal(actor(g), 1);
  assert.equal(g.phase, "citiesChoice");
  assert.equal(g.players[1].hand.paper, 0);
  const reload = JSON.parse(JSON.stringify(g)) as Game;
  const context = moveContext(reload);
  applyAction(
    reload,
    1,
    { type: "citiesChoice", cardId: reload.cities!.players[1].progress[0].id },
    () => 0.42,
    NOW,
  );
  assert.notEqual(moveContext(reload), context);
  assert.equal(reload.phase, "action");
  assert.equal(reload.players[1].hand.paper, 1);
  assert.equal(reload.cities!.players[1].progress.length, 4);
  assert.equal(reload.statistics!.players[1].cardsBought.medicine, 1);
  assert.equal(
    reload.statistics!.players[1].activity.progressCardsDiscarded,
    1,
  );
  assert.equal(reload.statistics!.players[1].activity.devCardsUsed, 0);
  assert.equal(reload.statistics!.players[1].resources.rollingIncome, 2);
  conserved(reload);
});
test("C&K seven discards include commodities and skip robber movement before the first attack", () => {
  const g = game();
  zero(g);
  fund(g, 0, { paper: 5, cloth: 4 });
  const robber = g.board.robber;
  applyAction(g, 0, { type: "roll" }, dice(3, 4, 4), NOW);
  assert.equal(g.phase, "discard");
  assert.equal(g.discards[0], 4);
  rejected(g, 0, { type: "discard", resources: { ...citiesHand(), paper: 5 } });
  applyAction(
    g,
    0,
    { type: "discard", resources: { ...citiesHand(), paper: 4 } },
    () => 0.42,
    NOW,
  );
  assert.equal(g.phase, "action");
  assert.equal(g.board.robber, robber);
  assert.equal(total(g.players[0].hand), 5);
  assert.deepEqual(view(g, "p0").legal.robber, []);
  conserved(g);
});
test("C&K an attack destroys walls before the same seven checks discard protection", () => {
  const g = game();
  zero(g);
  emptyBoard(g);
  const vertex = 0;
  Object.assign(g.board.vertices[vertex], { owner: 0, city: true });
  g.cities!.walls = [vertex];
  g.cities!.barbarianPosition = 6;
  fund(g, 0, { paper: 8 });
  applyAction(g, 0, { type: "roll" }, dice(3, 4, 1), NOW);
  assert.equal(g.phase, "citiesChoice");
  applyAction(g, 0, { type: "citiesChoice", vertex }, () => 0.42, NOW);
  assert.equal(g.phase, "discard");
  assert.equal(g.discards[0], 4);
  assert.deepEqual(g.cities!.walls, []);
  applyAction(
    g,
    0,
    { type: "discard", resources: { ...citiesHand(), paper: 4 } },
    () => 0.42,
    NOW,
  );
  assert.equal(g.phase, "robber");
  conserved(g);
});
test("C&K normal robbery can steal a commodity without revealing its identity in logs", () => {
  const g = game();
  zero(g);
  emptyBoard(g);
  action(g);
  g.cities!.attacks = 1;
  const tile = g.board.tiles.find(
    (t) => t.id !== g.board.robber && t.resource !== "desert",
  )!;
  g.board.vertices[tile.vertices[0]].owner = 1;
  fund(g, 1, { coin: 1 });
  g.phase = "robber";
  g.resume = "action";
  applyAction(g, 0, { type: "robber", id: tile.id }, () => 0.42, NOW);
  assert.equal(g.phase, "action");
  assert.equal(g.players[0].hand.coin, 1);
  assert.equal(g.players[1].hand.coin, 0);
  assert(!g.log.at(-1)!.includes("coin"));
  assert.equal(g.phase, "action");
  conserved(g);
});
test("C&K commodity player trades use consent, actual holdings and private response cooldowns", () => {
  const g = game();
  zero(g);
  action(g);
  g.turnSeconds = 60;
  fund(g, 0, { paper: 2 });
  fund(g, 1, { coin: 2 });
  applyAction(
    g,
    0,
    {
      type: "offer",
      give: { ...citiesHand(), paper: 1 },
      want: { ...citiesHand(), coin: 1 },
      targets: [1],
    },
    () => 0.5,
    NOW,
  );
  assert.equal(g.offers[0].responseDeadlines[1], NOW + 30000);
  const id = g.offers[0].id;
  applyAction(g, 1, { type: "accept", id }, () => 0.5, NOW);
  assert.equal(g.players[0].hand.coin, 0);
  applyAction(g, 0, { type: "completeTrade", id, to: 1 }, () => 0.5, NOW);
  assert.equal(g.players[0].hand.coin, 1);
  assert.equal(g.players[1].hand.paper, 1);
  assert.equal(g.offers.length, 0);
  conserved(g);
});
test("C&K trades allow the same commodity on both sides and conserve stock", () => {
  const g = game();
  zero(g);
  action(g);
  fund(g, 0, { paper: 2 });
  fund(g, 1, { paper: 1, coin: 1 });
  applyAction(g, 0, {
    type: "offer", targets: [1],
    give: { ...citiesHand(), paper: 2 },
    want: { ...citiesHand(), paper: 1, coin: 1 },
  }, () => 0.5, NOW);
  const id = g.offers[0].id;
  applyAction(g, 1, { type: "accept", id }, () => 0.5, NOW);
  applyAction(g, 0, { type: "completeTrade", id, to: 1 }, () => 0.5, NOW);
  assert.equal(g.players[0].hand.paper, 1);
  assert.equal(g.players[0].hand.coin, 1);
  assert.equal(g.players[1].hand.paper, 2);
  assert.equal(g.players[1].hand.coin, 0);
  conserved(g);
});

test("C&K offers cannot confirm cards that were spent", () => {
  const g = game();
  zero(g);
  action(g);
  fund(g, 0, { paper: 1 });
  fund(g, 1, { coin: 1 });
  applyAction(
    g,
    0,
    {
      type: "offer",
      give: { ...citiesHand(), paper: 1 },
      want: { ...citiesHand(), coin: 1 },
      targets: [1],
    },
    () => 0.5,
    NOW,
  );
  const id = g.offers[0].id;
  applyAction(g, 1, { type: "accept", id }, () => 0.5, NOW);
  g.players[1].hand.coin = 0;
  g.bank.coin = (g.bank.coin ?? 0) + 1;
  rejected(g, 0, { type: "completeTrade", id, to: 1 }, /no longer/);
  conserved(g);
});
test("C&K bank exchanges apply Trading House and Fleet rates to commodities and conserve cards", () => {
  const g = game();
  zero(g);
  action(g);
  fund(g, 0, { paper: 6, cloth: 2 });
  g.cities!.players[0].improvements.trade = 3;
  applyAction(
    g,
    0,
    {
      type: "bankTrade",
      give: { ...citiesHand(), paper: 2 },
      want: { ...citiesHand(), ore: 1 },
    },
    () => 0.42,
    NOW,
  );
  const id = grant(g, 0, "merchantFleet");
  applyAction(
    g,
    0,
    { type: "progress", cardId: id, good: "cloth" },
    () => 0.42,
    NOW,
  );
  applyAction(
    g,
    0,
    {
      type: "bankTrade",
      give: { ...citiesHand(), cloth: 2 },
      want: { ...citiesHand(), coin: 1 },
    },
    () => 0.42,
    NOW,
  );
  assert.equal(g.players[0].hand.coin, 1);
  assert.equal(g.players[0].hand.ore, 1);
  assert.equal(view(g, "p0").rates.paper, 2);
  assert.equal(g.statistics!.players[0].activity.bankTrades, 2);
  assert.equal(g.statistics!.players[0].resources.tradeIncome, 2);
  assert.equal(g.statistics!.players[0].resources.tradeLoss, 4);
  assert.equal(g.statistics!.players[0].activity.resourcesUsed, 0);
  conserved(g);
});
test("C&K knights interrupt Longest Road and block building routes and settlements", () => {
  const g = game();
  zero(g);
  emptyBoard(g);
  action(g);
  const path = chain(g, 0, 6);
  awards(g);
  assert.equal(g.longest, 0);
  const vertex = path.vertices[3],
    other = g.board.vertices[vertex].edges.find(
      (id) => !path.edges.includes(id),
    );
  assert.notEqual(other, undefined);
  g.board.edges[other!].owner = 1;
  fund(g, 1, { sheep: 1, ore: 1 });
  action(g, 1);
  applyAction(g, 1, { type: "placeKnight", id: vertex }, () => 0.42, NOW);
  assert.equal(g.longest, null);
  assert.equal(roadLength(g, 0), 3);
  assert(!legalSettlements(g, 0).includes(vertex));
  assert.equal(g.army, null);
  g.players[0].knights = 10;
  awards(g);
  assert.equal(g.army, null);
  conserved(g);
});
test("C&K knight activation, promotion, moving and displacement require the right actor and phase", () => {
  const g = game();
  zero(g);
  emptyBoard(g);
  action(g);
  const path = chain(g);
  fund(g, 0, { sheep: 3, ore: 3, wheat: 2 });
  applyAction(
    g,
    0,
    { type: "placeKnight", id: path.vertices[0] },
    () => 0.42,
    NOW,
  );
  applyAction(
    g,
    0,
    { type: "activateKnight", id: path.vertices[0] },
    () => 0.42,
    NOW,
  );
  applyAction(
    g,
    0,
    { type: "promoteKnight", id: path.vertices[0] },
    () => 0.42,
    NOW,
  );
  rejected(
    g,
    0,
    { type: "moveKnight", id: path.vertices[0], to: path.vertices[1] },
    /before/,
  );
  rejected(g, 1, { type: "activateKnight", id: path.vertices[0] });
  g.turn++;
  applyAction(
    g,
    0,
    { type: "moveKnight", id: path.vertices[0], to: path.vertices[1] },
    () => 0.42,
    NOW,
  );
  assert.equal(knightAt(citiesTable(g), path.vertices[1])!.active, false);
  assert.equal(g.statistics!.players[0].activity.resourcesUsed, 5);
  assert.equal(g.statistics!.players[0].spent.wheat, 1);
  assert.equal(g.statistics!.players[0].spent.sheep, 2);
  assert.equal(g.statistics!.players[0].spent.ore, 2);
  conserved(g);
});
test("C&K improvement choices assign a metropolis only after the owner selects an available city", () => {
  const g = game();
  zero(g);
  action(g);
  fund(g, 0, { paper: 4 });
  g.cities!.players[0].improvements.science = 3;
  applyAction(g, 0, { type: "improve", track: "science" }, () => 0.42, NOW);
  assert.equal(g.phase, "citiesChoice");
  const choice = g.cities!.choices[0];
  assert.equal(choice.kind, "metropolis");
  assert.equal(g.statistics!.players[0].activity.resourcesUsed, 4);
  assert.equal(g.statistics!.players[0].spent.paper, 4);
  rejected(g, 1, {
    type: "citiesChoice",
    vertex: g.board.vertices.find((v) => v.owner === 1 && v.city)!.id,
  });
  const own = g.board.vertices.find((v) => v.owner === 0 && v.city)!.id;
  applyAction(g, 0, { type: "citiesChoice", vertex: own }, () => 0.42, NOW);
  assert.equal(g.cities!.metropolises.science!.vertex, own);
  assert.equal(points(g, 0), 5);
  assert.equal(g.phase, "action");
  conserved(g);
});
test("C&K Warlord and free progress roads run through authoritative room actions without old dev cards", () => {
  const g = game();
  zero(g);
  action(g);
  const knightVertex = g.board.vertices.find(
    (v) =>
      v.owner === null && v.edges.some((id) => g.board.edges[id].owner === 0),
  )!.id;
  fund(g, 0, { sheep: 1, ore: 1 });
  applyAction(g, 0, { type: "placeKnight", id: knightVertex }, () => 0.42, NOW);
  const warlord = grant(g, 0, "warlord");
  applyAction(g, 0, { type: "progress", cardId: warlord }, () => 0.42, NOW);
  assert(knightAt(citiesTable(g), knightVertex)!.active);
  const roads = grant(g, 0, "roadBuilding");
  applyAction(g, 0, { type: "progress", cardId: roads }, () => 0.42, NOW);
  assert.equal(g.phase, "roadBuilding");
  assert.equal(g.freeRoads, 2);
  rejected(g, 0, { type: "end" });
  applyAction(g, 0, { type: "road", id: legalRoads(g, 0)[0] }, () => 0.42, NOW);
  assert.equal(g.freeRoads, 1);
  rejected(g, 0, { type: "skipRoads" }, /remaining free routes/);
  applyAction(g, 0, { type: "road", id: legalRoads(g, 0)[0] }, () => 0.42, NOW);
  assert.equal(g.phase, "action");
  assert.equal(g.cities!.freeRoutes, null);
  rejected(g, 0, { type: "buyDev" }, /progress/);
  rejected(g, 0, { type: "knight" }, /progress/);
  conserved(g);
});
test("C&K Alchemist selects both numbered dice while the event die still resolves exactly once", () => {
  const g = game();
  zero(g);
  const id = grant(g, 0, "alchemist");
  g.cities!.barbarianPosition = 2;
  let calls = 0;
  applyAction(
    g,
    0,
    { type: "progress", cardId: id, dice: [2, 3] },
    () => {
      calls++;
      return 0;
    },
    NOW,
  );
  assert.equal(calls, 1);
  assert.deepEqual(g.dice, [2, 3]);
  assert.equal(g.cities!.barbarianPosition, 3);
  assert.equal(g.rollCounts[5], 1);
  rejected(g, 0, { type: "roll" });
  conserved(g);
});
test("C&K balanced numbered dice consume the private deck while the event die remains independent", () => {
  const g = game();
  zero(g);
  g.diceMode = "balanced";
  let calls = 0;
  applyAction(
    g,
    0,
    { type: "roll" },
    () => {
      calls++;
      return 0.3;
    },
    NOW,
  );
  assert.equal(calls, 3);
  assert.equal(g.diceState.pairs.length, 35);
  assert.equal(g.cities!.barbarianPosition, 1);
  assert.equal(g.diceState.recent.at(-1), g.dice[0] + g.dice[1]);
  assert(!("diceState" in view(g, "p0")));
  conserved(g);
});
test("C&K Spy and Master Merchant private grants are projected through the full room view and disappear after resolution", () => {
  const g = game();
  zero(g);
  action(g);
  const spy = grant(g, 0, "spy"),
    victim = grant(g, 1, "merchant");
  fund(g, 1, { coin: 1, paper: 1 });
  applyAction(
    g,
    0,
    { type: "progress", cardId: spy, target: 1 },
    () => 0.42,
    NOW,
  );
  const me = view(g, "p0"),
    other = view(g, "p2"),
    spectator = view(g, null);
  assert.equal(me.cities!.peek!.progress![0].id, victim);
  assert.equal(other.cities!.peek, null);
  assert.equal(spectator.cities!.peek, null);
  assert(!("decks" in me.cities!));
  assert(!("citiesFlow" in me));
  assert.equal(other.players[1].hand, undefined);
  const restored = normalizeGame(JSON.parse(JSON.stringify(g)));
  assert.equal(view(restored, "p0").cities!.peek!.progress![0].id, victim);
  applyAction(
    restored,
    0,
    { type: "citiesChoice", cardId: victim },
    () => 0.42,
    NOW,
  );
  assert.equal(view(restored, "p0").cities!.peek, null);
  assert.equal(restored.statistics!.players[0].cardsUsed.spy, 1);
  assert.equal(restored.statistics!.players[0].activity.progressCardsStolen, 1);
  assert.equal(restored.statistics!.players[1].activity.progressCardsLost, 1);
  assert.equal(restored.statistics!.players[0].activity.devCardsBought, 0);
  assert.equal(restored.statistics!.players[1].activity.devCardsUsed, 0);
  restored.cities!.players[1].defenders = 1;
  const merchant = grant(restored, 0, "masterMerchant");
  applyAction(
    restored,
    0,
    { type: "progress", cardId: merchant, target: 1 },
    () => 0.42,
    NOW,
  );
  assert.equal(view(restored, "p0").cities!.peek!.hand!.coin, 1);
  assert.equal(view(restored, "p1").cities!.peek, null);
  applyAction(
    restored,
    0,
    { type: "citiesChoice", resources: { ...citiesHand(), coin: 1, paper: 1 } },
    () => 0.42,
    NOW,
  );
  assert.equal(view(restored, "p0").cities!.peek, null);
  conserved(restored);
});
test("C&K Wedding scores include Longest Road and responses belong to each opponent", () => {
  const g = game();
  zero(g);
  emptyBoard(g);
  action(g);
  chain(g, 1, 5);
  awards(g);
  fund(g, 1, { cloth: 2 });
  const id = grant(g, 0, "wedding");
  applyAction(g, 0, { type: "progress", cardId: id }, () => 0.42, NOW);
  assert.equal(actor(g), 1);
  assert.equal(g.statistics!.players[0].activity.successfulTrades, 0);
  assert.equal(actor(view(g, "p0")), 1);
  assert.equal(g.cities!.choices[0].kind, "wedding");
  rejected(g, 0, {
    type: "citiesChoice",
    resources: { ...citiesHand(), cloth: 2 },
  });
  applyAction(
    g,
    1,
    { type: "citiesChoice", resources: { ...citiesHand(), cloth: 2 } },
    () => 0.42,
    NOW,
  );
  assert.equal(g.players[0].hand.cloth, 2);
  assert.equal(g.phase, "action");
  conserved(g);
});
test("C&K Commercial Harbor pauses trading and exposes the offered resource only to its two players", () => {
  const g = game();
  zero(g);
  action(g);
  fund(g, 0, { wood: 1 });
  fund(g, 1, { coin: 1 });
  const id = grant(g, 0, "commercialHarbor");
  applyAction(g, 0, { type: "progress", cardId: id }, () => 0.42, NOW);
  applyAction(
    g,
    0,
    { type: "harborExchange", cardId: id, to: 1, resource: "wood" },
    () => 0.42,
    NOW,
  );
  assert.equal(actor(g), 1);
  assert(!("resource" in view(g, "p2").cities!.choice!));
  assert.equal(
    (view(g, "p1").cities!.choice as { resource: Resource }).resource,
    "wood",
  );
  rejected(g, 0, {
    type: "offer",
    give: { ...citiesHand(), wood: 1 },
    want: { ...citiesHand(), coin: 1 },
  });
  applyAction(g, 1, { type: "citiesChoice", good: "coin" }, () => 0.42, NOW);
  assert.equal(g.players[1].hand.wood, 1);
  assert.equal(g.players[0].hand.coin, 1);
  for (const seat of [0, 1]) {
    assert.equal(g.statistics!.players[seat].activity.successfulTrades, 1);
    assert.equal(g.statistics!.players[seat].resources.tradeIncome, 1);
    assert.equal(g.statistics!.players[seat].resources.tradeLoss, 1);
  }
  conserved(g);
});
test("C&K end turn requires discarding a fifth progress card before switching the active player", () => {
  const g = game();
  zero(g);
  action(g);
  for (const kind of [
    "alchemist",
    "crane",
    "engineer",
    "inventor",
    "medicine",
  ] as ProgressKind[])
    grant(g, 0, kind);
  applyAction(g, 0, { type: "end" }, () => 0.42, NOW);
  assert.equal(g.phase, "citiesChoice");
  assert.equal(g.active, 0);
  assert.equal(g.cities!.choices[0].kind, "discardProgress");
  rejected(g, 0, { type: "pass" });
  applyAction(
    g,
    0,
    { type: "citiesChoice", cardId: g.cities!.players[0].progress[0].id },
    () => 0.42,
    NOW,
  );
  assert.equal(g.active, 1);
  assert.equal(g.phase, "roll");
  assert.equal(g.cities!.players[0].progress.length, 4);
  conserved(g);
});
test("C&K larger-room special phases permit knight activation and improvements but forbid progress play, movement and victory", () => {
  const g = game(6);
  zero(g);
  action(g);
  fund(g, 1, { sheep: 1, ore: 1, wheat: 1, cloth: 1 });
  applyAction(g, 1, { type: "specialBuild", requested: true }, () => 0.42, NOW);
  applyAction(g, 0, { type: "end" }, () => 0.42, NOW);
  assert.equal(g.phase, "special");
  assert.equal(actor(g), 1);
  const vertex = legalRoads(g, 1)
    .flatMap((id) => [g.board.edges[id].a, g.board.edges[id].b])
    .find(
      (id) =>
        g.board.vertices[id].owner === null &&
        g.board.vertices[id].edges.some(
          (edge) => g.board.edges[edge].owner === 1,
        ),
    )!;
  applyAction(g, 1, { type: "placeKnight", id: vertex }, () => 0.42, NOW);
  applyAction(g, 1, { type: "activateKnight", id: vertex }, () => 0.42, NOW);
  applyAction(g, 1, { type: "improve", track: "trade" }, () => 0.42, NOW);
  const id = grant(g, 1, "merchant");
  rejected(g, 1, { type: "progress", cardId: id, tile: 0 });
  rejected(g, 1, { type: "moveKnight", id: vertex, to: 0 });
  g.target = 3;
  assert.equal(g.winner, null);
  while (g.phase === "special")
    applyAction(g, actor(g), { type: "pass" }, () => 0.42, NOW);
  assert.equal(g.active, 1);
  assert.equal(g.winner, 1);
  assert.equal(g.phase, "finished");
  conserved(g);
});
test("C&K special-phase metropolis choice returns to the same special player and preserves the remaining clock", () => {
  const g = game(6);
  zero(g);
  action(g);
  g.turnSeconds = 60;
  applyAction(g, 1, { type: "specialBuild", requested: true }, () => 0.42, NOW);
  applyAction(g, 0, { type: "end" }, () => 0.42, NOW);
  g.cities!.players[1].improvements.trade = 3;
  fund(g, 1, { cloth: 4 });
  const deadline = g.deadline!;
  applyAction(
    g,
    1,
    { type: "improve", track: "trade" },
    () => 0.42,
    NOW + 5000,
  );
  assert.equal(g.phase, "citiesChoice");
  assert.equal(g.clockResume!.remaining, deadline - (NOW + 5000));
  const vertex = g.board.vertices.find((v) => v.owner === 1 && v.city)!.id;
  applyAction(g, 1, { type: "citiesChoice", vertex }, () => 0.42, NOW + 15000);
  assert.equal(g.phase, "special");
  assert.equal(actor(g), 1);
  assert.equal(g.deadline, deadline + 10000);
  conserved(g);
});
test("C&K required choices each receive a new timer and context; normal-turn time resumes after the last response", () => {
  const g = game();
  zero(g);
  action(g);
  g.turnSeconds = 60;
  applyAction(g, 0, { type: "chat", text: "start clock" }, () => 0.42, NOW);
  const deadline = g.deadline!;
  g.cities!.players[1].defenders = 1;
  g.cities!.players[2].defenders = 1;
  fund(g, 1, { paper: 2 });
  fund(g, 2, { coin: 2 });
  const id = grant(g, 0, "wedding");
  applyAction(g, 0, { type: "progress", cardId: id }, () => 0.42, NOW + 5000);
  const first = g.deadline!,
    context = moveContext(g);
  assert.equal(actor(g), 1);
  applyAction(
    g,
    1,
    { type: "citiesChoice", resources: { ...citiesHand(), paper: 2 } },
    () => 0.42,
    NOW + 10000,
  );
  assert.equal(actor(g), 2);
  assert.notEqual(moveContext(g), context);
  assert.equal(g.deadline, first + 5000);
  applyAction(
    g,
    2,
    { type: "citiesChoice", resources: { ...citiesHand(), coin: 2 } },
    () => 0.42,
    NOW + 20000,
  );
  assert.equal(g.phase, "action");
  assert.equal(g.deadline, deadline + 15000);
  conserved(g);
});
test("C&K expired owned choices resolve once, conserve all goods and never take optional strategic actions", () => {
  const g = game();
  zero(g);
  action(g);
  g.turnSeconds = 30;
  g.cities!.players[1].defenders = 1;
  fund(g, 1, { paper: 3 });
  const id = grant(g, 0, "saboteur");
  applyAction(g, 0, { type: "progress", cardId: id }, () => 0.42, NOW);
  const deadline = g.deadline!;
  advanceClock(g, deadline, () => 0.42);
  assert.equal(g.phase, "action");
  assert.equal(g.players[1].hand.paper, 2);
  assert.equal(g.cities!.choices.length, 0);
  const cards = total(g.players[1].hand);
  advanceClock(g, deadline + 1, () => 0.42);
  assert.equal(total(g.players[1].hand), cards);
  assert.equal(g.board.vertices.filter((v) => v.owner !== null).length, 8);
  conserved(g);
});
test("C&K seven timeout discards commodities; expired fifth-card choice completes ending exactly once", () => {
  const g = game();
  zero(g);
  fund(g, 0, { coin: 8 });
  g.turnSeconds = 30;
  applyAction(g, 0, { type: "roll" }, dice(3, 4, 4), NOW);
  assert.equal(g.phase, "discard");
  advanceClock(g, g.deadline!, () => 0.42);
  assert.equal(g.players[0].hand.coin, 4);
  assert.equal(g.phase, "action");
  for (const kind of [
    "alchemist",
    "crane",
    "engineer",
    "inventor",
    "medicine",
  ] as ProgressKind[])
    grant(g, 0, kind);
  applyAction(g, 0, { type: "end" }, () => 0.42, NOW + 20000);
  const deadline = g.deadline!;
  advanceClock(g, deadline, () => 0.42);
  assert.equal(g.active, 1);
  assert.equal(g.turn, 2);
  assert.equal(g.cities!.players[0].progress.length, 4);
  conserved(g);
});
test("C&K public progress points can win only on the owner normal turn, and raw state never leaks through projections", () => {
  const g = game();
  zero(g);
  g.target = 4;
  g.cities!.players[1].improvements.science = 1;
  const deck = g.cities!.decks.science,
    at = deck.findIndex((c) => c.kind === "printer");
  deck.unshift(deck.splice(at, 1)[0]);
  applyAction(g, 0, { type: "roll" }, dice(5, 1, 4), NOW);
  assert.equal(points(g, 1), 4);
  assert.equal(g.winner, null);
  assert.equal(view(g, null).players[1].score, 4);
  applyAction(g, 0, { type: "end" }, () => 0.42, NOW);
  assert.equal(g.winner, 1);
  assert.equal(g.phase, "finished");
  const spectator = view(g, null);
  assert(!("decks" in spectator.cities!));
  assert(spectator.cities!.players.every((p) => !("progress" in p)));
  conserved(g);
});
test("C&K full-game mandatory roll cycles survive JSON reloads without duplicate production or cards", () => {
  let g = game(6);
  g.target = 20;
  for (let round = 0; round < 36; round++) {
    assert.equal(g.phase, "roll");
    applyAction(
      g,
      g.active,
      { type: "roll" },
      dice(3, 3, round % 3 === 0 ? 1 : 4),
      NOW + round * 100,
    );
    g = normalizeGame(JSON.parse(JSON.stringify(g)));
    resolve(g);
    if (g.phase === "discard")
      for (const seat of Object.keys({ ...g.discards })) {
        const p = Number(seat),
          h = citiesHand(),
          bag = GOODS.flatMap(
            (r) =>
              Array(g.players[p].hand[r] ?? 0).fill(
                r,
              ) as (typeof GOODS)[number][],
          );
        for (let i = 0; i < g.discards[p]; i++) h[bag.pop()!]++;
        applyAction(g, p, { type: "discard", resources: h }, () => 0.42, NOW);
      }
    if (g.phase === "robber")
      applyAction(
        g,
        g.active,
        { type: "robber", id: view(g, `p${g.active}`).legal.robber[0] },
        () => 0.42,
        NOW,
      );
    if (g.phase === "steal")
      applyAction(
        g,
        g.active,
        { type: "steal", id: g.victims[0] },
        () => 0.42,
        NOW,
      );
    assert.equal(g.phase, "action");
    applyAction(g, g.active, { type: "end" }, () => 0.42, NOW);
    resolve(g);
    while ((g.phase as string) === "special")
      applyAction(g, actor(g), { type: "pass" }, () => 0.42, NOW);
    conserved(g);
  }
  assert.equal(g.turn, 37);
  assert.equal(g.rollCounts[6], 36);
  assert.equal(g.cities!.attacks, 1);
});
