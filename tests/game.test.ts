import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import test from "node:test";
import "./turn-order.test";
import "./clock-gate.test";
import "./robber-timeouts.test";
import "./production-log.test";
import "./card-feedback.test";
import "./board-navigation.test";
import "./board-generation.test";
import "./sea-frame.test";
import "./disconnect-bots.test";
import "./tab-takeover.test";
import "./bot-speed.test";
import "./bot-competence.test";
import "./seafarers.test";
import "./combined.test";
import "./scenarios.test";
import "./fog.test";
import "./trades.test";
import "./cities-knights.test";
import "./cities-progress.test";
import "./cities-room.test";
import "./cities-full-matches.test";
import "./sounds.test";
import "./base-maps.test";
import "./room-setup.test";
import "./large-rooms.test";
import "./fun-maps.test";
import "./restored-layouts.test";
import "./request-limits.test";
import "./gold-rush.test";
import "./black-forest.test";
import "./cities-browser-helpers.test";
import "./room-transport.test";
import "./pause.test";
import "./result-image.test";
import "./avatars.test";
import "./matchmaking.test";
import "./ranked.test";
import "./regions.test";
import "./rush.test";
import "./solo.test";
import "./statistics.test";
import "./replay.test";
import "./accounts.test";
import "./special-building.test";
import assert from "node:assert/strict";
import { RESOURCES, emptyHand, makeBoard, Hand } from "../lib/board";
import {
  createGame,
  player,
  addPlayer,
  actor,
  legalRoads,
  legalSettlements,
  legalCities,
  points,
  roadLength,
  awards,
  view,
  total,
  distribute,
  advanceClock,
  legalRobberTiles,
  normalizeGame,
  bankRate,
  Game,
  TURN_SPEEDS,
  minimumPlayers,
} from "../lib/game";
import { publicLeader } from "../lib/game-display";
import { chooseMove } from "./autoplay";
import {
  balancedWeights,
  createBalancedDice,
  drawBalancedDice,
} from "../lib/dice";
test("1v1 preset, mode changes and seating limits are authoritative", () => {
  const duel = createGame("DUEL22", player("a", "A"), 2);
  assert.equal(duel.mode, "duel");
  assert.deepEqual(
    [
      duel.target,
      duel.discardLimit,
      duel.friendlyRobber,
      duel.turnSeconds,
      duel.diceMode,
    ],
    [15, 9, false, 30, "balanced"],
  );
  assert.equal(duel.board.tiles.length, 19);
  assert.throws(() => applyAction(duel, 0, { type: "start" }), /Two players/);
  addPlayer(duel, player("b", "B"));
  assert.throws(() => addPlayer(duel, player("c", "C")), /full/);
  applyAction(duel, 1, { type: "ready" });
  applyAction(duel, 0, { type: "start" });
  assert.equal(duel.phase, "setupSettlement");
  const base = game(3);
  const before = JSON.stringify(base);
  assert.throws(
    () => applyAction(base, 0, { type: "settings", mode: "duel", target: 12 }),
    /enough for everyone/,
  );
  assert.equal(JSON.stringify(base), before);
  applyAction(base, 0, { type: "remove", id: 2 });
  applyAction(base, 0, { type: "settings", mode: "duel" });
  assert.equal(base.capacity, 2);
  assert.equal(base.target, 15);
  assert(base.players.every((p) => !p.ready));
  applyAction(base, 0, {
    type: "settings",
    mode: "base",
    diceMode: "balanced",
  });
  assert.deepEqual(
    [
      base.capacity,
      base.target,
      base.discardLimit,
      base.friendlyRobber,
      base.diceMode,
    ],
    [4, 10, 7, false, "balanced"],
  );
});
test("balanced dice weights damp recent sums and balance seven ownership", () => {
  const state = createBalancedDice();
  assert.equal(state.pairs.length, 36);
  assert.equal(new Set(state.pairs.map((p) => p.join(","))).size, 36);
  const base = balancedWeights(state, 0, 2);
  assert(Math.abs(base[7] - 6 / 36) < 1e-12);
  state.recent = [6, 6, 8, 5, 8];
  const recent = balancedWeights(state, 0, 2);
  assert(Math.abs(recent[6] / base[6] - 0.32) < 1e-12);
  assert(Math.abs(recent[5] / base[5] - 0.66) < 1e-12);
  state.sevens = { 0: 4, 1: 1 };
  state.lastSeven = 0;
  state.streak = 2;
  assert.equal(balancedWeights(state, 0, 2)[7], 0);
  assert(Math.abs(balancedWeights(state, 1, 2)[7] - 2 * base[7]) < 1e-12);
});
test("balanced dice draw without replacement, replenish below 13, and persist their histories", () => {
  const state = createBalancedDice(),
    random = rng(29),
    seen = new Set<string>();
  for (let i = 0; i < 24; i++) {
    const pair = drawBalancedDice(state, i % 2, 2, random);
    assert(pair.every((n) => n >= 1 && n <= 6));
    assert(!seen.has(pair.join(",")));
    seen.add(pair.join(","));
    assert.equal(state.pairs.length, 35 - i);
  }
  assert.equal(state.pairs.length, 12);
  const saved = JSON.parse(JSON.stringify(state));
  const pair = drawBalancedDice(state, 0, 2, () => 0);
  assert.deepEqual(
    drawBalancedDice(saved, 0, 2, () => 0),
    pair,
  );
  assert.equal(state.pairs.length, 35);
  assert.equal(state.recent.length, 5);
  state.pairs = [
    [1, 6],
    [2, 5],
    ...Array.from({ length: 11 }, () => [1, 1] as [number, number]),
  ];
  state.recent = [];
  state.sevens = {};
  state.lastSeven = null;
  state.streak = 0;
  drawBalancedDice(state, 1, 2, () => 0.99);
  assert.equal(state.lastSeven, 1);
  assert.equal(state.streak, 1);
  drawBalancedDice(state, 0, 2, () => 0);
  assert.equal(state.lastSeven, 1, "Non-sevens preserve the ownership streak.");
});
test("future balanced dice stay private and resignation gives the opponent a win", () => {
  const g = setup(2);
  assert.equal(g.setupStep, 4);
  for (const p of g.players) assert.equal(piecesFor(p), 2);
  function piecesFor(p: (typeof g.players)[number]) {
    return g.board.vertices.filter((v) => v.owner === g.players.indexOf(p))
      .length;
  }
  assert(!("diceState" in view(g, "secret-0")));
  assert(!("diceState" in view(g, null)));
  applyAction(g, 1, { type: "chat", text: "/resign" });
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 0);
  assert.equal(g.resignedBy, 1);
  assert.equal(g.deadline, null);
  assert.throws(() => applyAction(g, 1, { type: "resign" }), /active 1v1/);
  const base = setup();
  assert.throws(() => applyAction(base, 0, { type: "resign" }), /active 1v1/);
});
function rng(seed = 1) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function game(n = 4) {
  const g = createGame("ABC234", player("secret-0", "Alice"), n);
  for (let i = 1; i < n; i++)
    addPlayer(g, player(`secret-${i}`, `Player ${i}`));
  g.players.forEach((p) => (p.ready = true));
  return g;
}
function setup(n = 4) {
  const g = game(n);
  applyAction(g, 0, { type: "start" });
  while (g.phase.startsWith("setup")) applyAction(g, g.active, chooseMove(g)!);
  return g;
}
function resources(g: Game, p: number, h: Partial<Hand>) {
  for (const r of RESOURCES) {
    g.bank[r] += g.players[p].hand[r] - (h[r] ?? 0);
    g.players[p].hand[r] = h[r] ?? 0;
  }
}
function actionGame(n = 4) {
  const g = setup(n);
  g.phase = "action";
  return g;
}
function path(g: Game, length: number, excluded = new Set<number>()) {
  const walk = (
    v: number,
    edges: number[],
    vertices: number[],
  ): { edges: number[]; vertices: number[] } | null => {
    if (edges.length === length) return { edges, vertices };
    for (const eid of g.board.vertices[v].edges) {
      const e = g.board.edges[eid],
        other = e.a === v ? e.b : e.a;
      if (
        !edges.includes(eid) &&
        !vertices.includes(other) &&
        !excluded.has(eid)
      ) {
        const found = walk(other, [...edges, eid], [...vertices, other]);
        if (found) return found;
      }
    }
    return null;
  };
  for (const v of g.board.vertices) {
    const found = walk(v.id, [], [v.id]);
    if (found) return found;
  }
  throw Error("No path found.");
}
test("maps have correct land, resource, token, and port counts", () => {
  for (const [n, count, ports] of [
    [4, 19, 9],
    [6, 30, 11],
    [8, 37, 12],
  ]) {
    const b = makeBoard(n, rng(n));
    assert.equal(b.tiles.length, count);
    assert.equal(b.ports.length, ports);
    assert.equal(
      b.tiles.filter((t) => t.resource === "desert").length,
      n === 4 ? 1 : 2,
    );
    assert.equal(
      b.tiles.filter((t) => t.number > 0).length,
      count - (n === 4 ? 1 : 2),
    );
    assert(b.edges.every((e) => e.tiles.length <= 2));
    assert(b.vertices.every((v) => v.tiles.length <= 3));
    assert.equal(
      new Set(
        b.vertices.map(
          (v) => `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)}`,
        ),
      ).size,
      b.vertices.length,
    );
    assert.equal(
      new Set(b.ports.flatMap((p) => [b.edges[p.edge].a, b.edges[p.edge].b]))
        .size,
      ports * 2,
    );
  }
});
test("base topology has 54 vertices and 72 edges", () => {
  const b = makeBoard();
  assert.equal(b.vertices.length, 54);
  assert.equal(b.edges.length, 72);
});
test("random maps keep six and eight tokens nonadjacent", () => {
  for (let seed = 1; seed <= 30; seed++)
    for (const n of [4, 6, 8]) {
      const b = makeBoard(n, rng(seed));
      assert(
        !b.edges.some(
          (e) =>
            e.tiles.length === 2 &&
            e.tiles.every((i) => [6, 8].includes(b.tiles[i].number)),
        ),
      );
    }
});
test("room capacity and host authority are validated", () => {
  assert.throws(() => createGame("ABC234", player("0", "A"), 13));
  const g = game(3);
  assert.throws(() => addPlayer(g, player("x", "extra")));
  assert.throws(() => applyAction(g, 1, { type: "settings", target: 12 }));
  assert.throws(() => applyAction(g, 0, { type: "settings", target: 99 }));
});
test("minimum players and ready checks prevent premature starts", () => {
  const g = createGame("ABC234", player("0", "A"));
  assert.throws(() => applyAction(g, 0, { type: "start" }));
  addPlayer(g, player("1", "B"));
  addPlayer(g, player("2", "C"));
  assert.throws(() => applyAction(g, 0, { type: "start" }));
});
test("Base starts with two seated players regardless of room capacity", () => {
  for (const [capacity, minimum] of [
    [2, 2],
    [3, 2],
    [4, 2],
    [5, 2],
    [6, 2],
    [7, 2],
    [8, 2],
  ]) {
    assert.equal(minimumPlayers("base", capacity), minimum);
    const g = createGame(
      "SEAT22",
      player("0", "Host"),
      capacity,
      false,
      "base",
    );
    for (let seat = 1; seat < minimum - 1; seat++) {
      addPlayer(g, player(String(seat), `Seat ${seat}`));
      applyAction(g, seat, { type: "ready" });
    }
    const before = structuredClone(g);
    assert.throws(
      () => applyAction(g, 0, { type: "start" }),
      /players are required/,
    );
    assert.deepEqual(g, before);
    addPlayer(g, player(String(minimum - 1), "Last seat"));
    assert.throws(() => applyAction(g, 0, { type: "start" }), /ready/);
    applyAction(g, minimum - 1, { type: "ready" });
    applyAction(g, 0, { type: "start" });
    assert.equal(g.players.length, minimum);
    assert.equal(g.capacity, capacity);
    assert.equal(g.board.tiles.length, 19);
    assert.equal(g.deck.length, 25);
    assert.deepEqual(
      RESOURCES.map((r) => g.bank[r]),
      Array(5).fill(19),
    );
    while (g.phase.startsWith("setup"))
      applyAction(g, actor(g), chooseMove(g)!);
    assert.equal(g.phase, "roll");
    for (let seat = 0; seat < minimum; seat++) assert.equal(points(g, seat), 2);
    g.phase = "action";
    assert.throws(() =>
      applyAction(g, 1, { type: "specialBuild", requested: true }),
    );
    applyAction(g, 0, { type: "end" });
    assert.equal(g.phase, "roll");
    assert.equal(g.active, 1);
  }
});
test("changing Base capacity preserves rules and sizes from occupied seats", () => {
  const g = createGame("SEAT22", player("0", "Host"), 4);
  addPlayer(g, player("1", "Guest"));
  applyAction(g, 1, { type: "ready" });
  applyAction(g, 0, { type: "settings", capacity: 2 });
  assert.deepEqual(
    [g.mode, g.target, g.discardLimit, g.friendlyRobber, g.diceMode],
    ["base", 10, 7, false, "random"],
  );
  assert(!g.players[1].ready);
  applyAction(g, 0, { type: "settings", capacity: 8 });
  applyAction(g, 1, { type: "ready" });
  assert.equal(minimumPlayers(g.mode, g.capacity), 2);
  applyAction(g, 0, { type: "settings", capacity: 6 });
  applyAction(g, 1, { type: "ready" });
  applyAction(g, 0, { type: "start" });
  assert.equal(g.board.tiles.length, 19);
});
test("setup uses forward then reverse player order and gives second resources", () => {
  const g = game(4),
    order: number[] = [];
  applyAction(g, 0, { type: "start" });
  while (g.phase.startsWith("setup")) {
    if (g.phase === "setupSettlement") order.push(g.active);
    applyAction(g, g.active, chooseMove(g)!);
  }
  assert.deepEqual(order, [0, 1, 2, 3, 3, 2, 1, 0]);
  assert.equal(g.phase, "roll");
  assert.equal(g.turn, 1);
  for (let p = 0; p < 4; p++) {
    assert.equal(points(g, p), 2);
    assert.equal(g.board.edges.filter((e) => e.owner === p).length, 2);
    assert(total(g.players[p].hand) > 0);
    const cards = RESOURCES.filter((r) => g.players[p].hand[r] > 0)
      .map((r) => `${g.players[p].hand[r]} ${r}`)
      .join(" and ");
    const receipt = `${g.players[p].name} got ${cards}.`;
    assert.equal(g.log.filter((line) => line === receipt).length, 1);
    assert(view(g, null).log.includes(receipt), "Starting resources are public");
  }
});
test("settlement distance and setup-road adjacency are enforced", () => {
  const g = game();
  applyAction(g, 0, { type: "start" });
  const v = legalSettlements(g, 0, true)[0];
  applyAction(g, 0, { type: "settlement", id: v });
  assert(
    legalRoads(g, 0, true).every((eid) =>
      [g.board.edges[eid].a, g.board.edges[eid].b].includes(v),
    ),
  );
  const bad = g.board.edges.find((e) => ![e.a, e.b].includes(v))!;
  assert.throws(() => applyAction(g, 0, { type: "road", id: bad.id }));
  applyAction(g, 0, { type: "road", id: legalRoads(g, 0, true)[0] });
  const neighbor = g.board.edges[g.board.vertices[v].edges[0]];
  assert.throws(() =>
    applyAction(g, 1, {
      type: "settlement",
      id: neighbor.a === v ? neighbor.b : neighbor.a,
    }),
  );
});
test("eight player setup completes with two settlements per player", () => {
  const g = setup(8);
  assert.equal(g.phase, "roll");
  assert.equal(g.board.vertices.filter((v) => v.owner !== null).length, 16);
});
test("turn restrictions and costs prevent illegal moves", () => {
  const g = setup();
  assert.throws(() => applyAction(g, 1, { type: "roll" }));
  assert.throws(() => applyAction(g, 0, { type: "end" }));
  g.phase = "action";
  resources(g, 0, {});
  assert.throws(() =>
    applyAction(g, 0, { type: "road", id: legalRoads(g, 0)[0] }),
  );
  resources(g, 0, { wood: 1, brick: 1 });
  const eid = legalRoads(g, 0)[0];
  applyAction(g, 0, { type: "road", id: eid });
  assert.equal(total(g.players[0].hand), 0);
  assert.throws(() => applyAction(g, 0, { type: "road", id: eid }));
});
test("settlements collect once and cities twice, robber blocks production", () => {
  const g = game();
  g.phase = "action";
  const t = g.board.tiles.find(
    (t) => t.resource !== "desert" && t.id !== g.board.robber,
  )!;
  // Isolate this tile's payout: another random tile can share its resource
  // and roll, and must continue producing even after this tile is robbed.
  g.board.tiles.forEach((tile) => {
    if (tile.id !== t.id) tile.number = 0;
  });
  g.board.vertices[t.vertices[0]].owner = 0;
  g.board.vertices[t.vertices[1]].owner = 1;
  g.board.vertices[t.vertices[1]].city = true;
  distribute(g, t.number);
  assert.equal(g.players[0].hand[t.resource as keyof Hand], 1);
  assert.equal(g.players[1].hand[t.resource as keyof Hand], 2);
  const before = g.players[0].hand[t.resource as keyof Hand];
  g.board.robber = t.id;
  distribute(g, t.number);
  assert.equal(g.players[0].hand[t.resource as keyof Hand], before);
});
test("multi-player bank shortages pay nobody for that resource", () => {
  const g = game(),
    t = g.board.tiles.find((t) => t.resource !== "desert")!;
  g.board.robber = (t.id + 1) % g.board.tiles.length;
  g.board.vertices[t.vertices[0]].owner = 0;
  g.board.vertices[t.vertices[1]].owner = 1;
  g.bank[t.resource as keyof Hand] = 1;
  distribute(g, t.number);
  assert.equal(g.players[0].hand[t.resource as keyof Hand], 0);
  assert.equal(g.players[1].hand[t.resource as keyof Hand], 0);
});
test("single recipient receives remaining bank stock", () => {
  const g = game(),
    t = g.board.tiles.find((t) => t.resource !== "desert")!;
  g.board.robber = (t.id + 1) % g.board.tiles.length;
  g.board.vertices[t.vertices[0]].owner = 0;
  g.board.vertices[t.vertices[0]].city = true;
  g.bank[t.resource as keyof Hand] = 1;
  distribute(g, t.number);
  assert.equal(g.players[0].hand[t.resource as keyof Hand], 1);
});
test("seven requires exact half discard and waits for every player", () => {
  const g = setup();
  resources(g, 0, { wood: 9 });
  resources(g, 1, { brick: 8 });
  applyAction(
    g,
    0,
    { type: "roll" },
    (() => {
      let i = 0;
      return () => (i++ === 0 ? 0.4 : 0.55);
    })(),
  );
  assert.equal(g.phase, "discard");
  assert.deepEqual(g.discards, { 0: 4, 1: 4 });
  assert.throws(() =>
    applyAction(g, 0, {
      type: "discard",
      resources: { ...emptyHand(), wood: 3 },
    }),
  );
  applyAction(g, 1, {
    type: "discard",
    resources: { ...emptyHand(), brick: 4 },
  });
  assert.equal(g.phase, "discard");
  applyAction(g, 0, {
    type: "discard",
    resources: { ...emptyHand(), wood: 4 },
  });
  assert.equal(g.phase, "robber");
  assert.equal(g.players[0].hand.wood, 5);
});
test("robber movement and stealing validate eligible opponents", () => {
  const g = game();
  g.phase = "robber";
  g.resume = "action";
  const t = g.board.tiles.find((t) => t.id !== g.board.robber)!;
  g.board.vertices[t.vertices[0]].owner = 1;
  resources(g, 1, { ore: 2 });
  assert.throws(() =>
    applyAction(g, 0, { type: "robber", id: g.board.robber }),
  );
  applyAction(g, 0, { type: "robber", id: t.id });
  assert.equal(g.phase, "action");
  assert.throws(() => applyAction(g, 0, { type: "steal", id: 2 }));
  assert.equal(g.players[0].hand.ore, 1);
  assert.equal(g.players[1].hand.ore, 1);
  assert.equal(g.phase, "action");
});
test("robbery ignores empty neighbors, automatically steals the sole eligible card and preserves privacy", () => {
  const g = actionGame();
  g.board.vertices.forEach(v => v.owner = null);
  g.players.forEach(p => { for (const r of RESOURCES) { g.bank[r] += p.hand[r]; p.hand[r] = 0; } });
  const tile = g.board.tiles.find(t => t.id !== g.board.robber)!;
  g.board.vertices[tile.vertices[0]].owner = 1;
  g.board.vertices[tile.vertices[2]].owner = 2;
  resources(g, 2, { ore: 1, wheat: 1 });
  g.phase = "robber";
  g.resume = "action";
  const income = g.statistics!.players[0].resources.robbingIncome;
  const loss = g.statistics!.players[2].resources.robbingLoss;
  applyAction(g, 0, {type: "robber", id: tile.id}, () => .99);
  assert.equal(g.phase, "action");
  assert.equal(total(g.players[0].hand), 1);
  assert.equal(total(g.players[2].hand), 1);
  assert.equal(g.statistics!.players[0].resources.robbingIncome, income + 1);
  assert.equal(g.statistics!.players[2].resources.robbingLoss, loss + 1);
  const publicLog = view(g, null).log.at(-1)!;
  assert(publicLog.includes("hidden card"));
  assert(!publicLog.includes("ore") && !publicLog.includes("wheat"));
  assert(view(g, g.players[0].id).log.at(-1)!.includes("ore"));
});
test("robbery keeps the player choice when two neighbors have cards", () => {
  const g = actionGame();
  g.board.vertices.forEach(v => v.owner = null);
  const tile = g.board.tiles.find(t => t.id !== g.board.robber)!;
  g.board.vertices[tile.vertices[0]].owner = 1;
  g.board.vertices[tile.vertices[2]].owner = 2;
  resources(g, 1, { ore: 1 });
  resources(g, 2, { wheat: 1 });
  g.phase = "robber";
  g.resume = "action";
  const before = total(g.players[0].hand);
  applyAction(g, 0, {type: "robber", id: tile.id});
  assert.equal(g.phase, "steal");
  assert.deepEqual(g.victims, [1, 2]);
  assert.equal(total(g.players[0].hand), before);
  applyAction(g, 0, {type: "steal", id: 2}, () => 0);
  assert.equal(g.phase, "action");
  assert.equal(total(g.players[0].hand), before + 1);
});
test("bank trade uses 4:1 and acquired ports use 3:1 or 2:1", () => {
  const g = actionGame();
  g.board.vertices.forEach((v) => (v.owner = null));
  resources(g, 0, { wood: 4 });
  applyAction(g, 0, {
    type: "bankTrade",
    give: { ...emptyHand(), wood: 4 },
    want: { ...emptyHand(), ore: 1 },
  });
  assert.equal(g.players[0].hand.ore, 1);
  const generic = g.board.ports.find((p) => p.resource === "any")!,
    special = g.board.ports.find((p) => p.resource === "wood")!;
  g.board.vertices[g.board.edges[generic.edge].a].owner = 0;
  assert.equal(bankRate(g, 0, "wood"), 3);
  g.board.vertices[g.board.edges[special.edge].a].owner = 0;
  assert.equal(bankRate(g, 0, "wood"), 2);
});
test("player trades exchange cards atomically", () => {
  const g = actionGame();
  resources(g, 0, { wood: 2 });
  resources(g, 1, { brick: 3 });
  applyAction(g, 0, {
    type: "offer",
    give: { ...emptyHand(), wood: 2 },
    want: { ...emptyHand(), brick: 3 },
  });
  applyAction(g, 1, { type: "accept", id: g.offers[0].id });
  assert.equal(
    g.players[0].hand.brick,
    0,
    "Accepting does not exchange cards yet.",
  );
  applyAction(g, 0, { type: "completeTrade", id: g.offers[0].id, to: 1 });
  assert.equal(g.players[0].hand.brick, 3);
  assert.equal(g.players[1].hand.wood, 2);
  assert.equal(g.offers.length, 0);
});
test("only the active player can initiate an offer; other players may counter", () => {
  const g = actionGame();
  resources(g, 1, { wood: 1 });
  resources(g, 2, { brick: 1 });
  const before = JSON.stringify(g);
  assert.throws(
    () =>
      applyAction(g, 1, {
        type: "offer",
        give: { ...emptyHand(), wood: 1 },
        want: { ...emptyHand(), brick: 1 },
        to: 2,
      }),
    /Only the active player/,
  );
  assert.equal(JSON.stringify(g), before);
  resources(g, 0, { brick: 1 });
  applyAction(g, 0, {
    type: "offer",
    give: { ...emptyHand(), brick: 1 },
    want: { ...emptyHand(), wood: 1 },
  });
  applyAction(g, 1, {
    type: "counterOffer",
    id: g.offers[0].id,
    give: { ...emptyHand(), wood: 1 },
    want: { ...emptyHand(), brick: 1 },
  });
  assert.equal(g.offers[1].from, 1);
  applyAction(g, 0, { type: "completeTrade", id: g.offers[1].id });
  assert.equal(g.players[0].hand.wood, 1);
});
test("new development cards cannot be played that turn", () => {
  const g = actionGame();
  resources(g, 0, { wheat: 1, ore: 1, sheep: 1 });
  g.deck = ["knight"];
  applyAction(g, 0, { type: "buyDev" });
  assert.throws(() => applyAction(g, 0, { type: "knight" }));
  g.turn++;
  applyAction(g, 0, { type: "knight" });
  assert.equal(g.players[0].knights, 1);
  assert.equal(g.phase, "robber");
});
test("development deck counts match base and extended variants", () => {
  for (const [n, deck] of [
    [4, 25],
    [6, 34],
    [8, 43],
  ]) {
    const g = game(n);
    applyAction(g, 0, { type: "start" });
    assert.equal(g.deck.length, deck);
  }
});
test("knight before rolling returns to roll and one card per turn is enforced", () => {
  const g = setup();
  g.players[0].dev = [
    { kind: "knight", bought: 0 },
    { kind: "monopoly", bought: 0 },
  ];
  applyAction(g, 0, { type: "knight" });
  const safe = g.board.tiles.find(
    (t) =>
      t.id !== g.board.robber &&
      t.vertices.every(
        (i) =>
          g.board.vertices[i].owner === null || g.board.vertices[i].owner === 0,
      ),
  )!;
  applyAction(g, 0, { type: "robber", id: safe.id });
  assert.equal(g.phase, "roll");
  assert.throws(() =>
    applyAction(g, 0, { type: "monopoly", resource: "wood" }),
  );
});
test("Year of Plenty allows same resource twice but checks bank stock", () => {
  const g = actionGame();
  resources(g, 0, {});
  g.players[0].dev = [{ kind: "plenty", bought: 0 }];
  g.bank.ore = 1;
  assert.throws(() =>
    applyAction(g, 0, {
      type: "plenty",
      resources: { ...emptyHand(), ore: 2 },
    }),
  );
  assert.equal(g.players[0].dev.length, 1);
  g.bank.ore = 2;
  applyAction(g, 0, { type: "plenty", resources: { ...emptyHand(), ore: 2 } });
  assert.equal(g.players[0].hand.ore, 2);
  assert.equal(g.bank.ore, 0);
});
test("Monopoly takes selected resource only and does not alter bank", () => {
  const g = actionGame();
  resources(g, 0, {});
  resources(g, 1, { wood: 3, ore: 2 });
  resources(g, 2, { wood: 2 });
  resources(g, 3, {});
  const bank = g.bank.wood;
  g.players[0].dev = [{ kind: "monopoly", bought: 0 }];
  applyAction(g, 0, { type: "monopoly", resource: "wood" });
  assert.equal(g.players[0].hand.wood, 5);
  assert.equal(g.players[1].hand.wood, 0);
  assert.equal(g.players[1].hand.ore, 2);
  assert.equal(g.bank.wood, bank);
});
test("Road Building requires both free connected roads and rejects voluntary skipping", () => {
  const g = actionGame();
  resources(g, 0, {});
  g.players[0].dev = [{ kind: "roadBuilding", bought: 0 }];
  applyAction(g, 0, { type: "roadBuilding" });
  assert.throws(() => applyAction(g, 0, { type: "skipRoads" }), /remaining free routes/);
  applyAction(g, 0, { type: "road", id: legalRoads(g, 0)[0] });
  assert.equal(g.freeRoads, 1);
  assert.equal(total(g.players[0].hand), 0);
  assert.throws(() => applyAction(g, 0, { type: "skipRoads" }), /remaining free routes/);
  assert.throws(() => applyAction(g, 0, { type: "end" }), /Finish the current action/);
  applyAction(g, 0, { type: "road", id: legalRoads(g, 0)[0] });
  assert.equal(g.phase, "action");
  assert.equal(g.freeRoads, 0);
  assert.equal(total(g.players[0].hand), 0);
});
test("Road Building returns to rolling after both free roads are placed before the roll", () => {
  const g = setup();
  g.players[0].dev = [{ kind: "roadBuilding", bought: 0 }];
  applyAction(g, 0, { type: "roadBuilding" });
  for (let i = 0; i < 2; i++) applyAction(g, 0, { type: "road", id: legalRoads(g, 0)[0] });
  assert.equal(g.phase, "roll");
  assert.equal(g.freeRoads, 0);
});
test("Road Building finishes after one road when only one road piece remains", () => {
  const g = game();
  g.phase = "action";
  g.turn = 1;
  const chain = path(g, 14);
  chain.edges.forEach(id => g.board.edges[id].owner = 0);
  g.players[0].dev = [{ kind: "roadBuilding", bought: 0 }];
  applyAction(g, 0, { type: "roadBuilding" });
  assert.equal(g.freeRoads, 1);
  applyAction(g, 0, { type: "road", id: legalRoads(g, 0)[0] });
  assert.equal(g.phase, "action");
  assert.equal(g.freeRoads, 0);
  assert.equal(g.board.edges.filter(e => e.owner === 0).length, 15);
});
test("Road Building finishes when no second legal road remains", () => {
  const g = game();
  g.phase = "action";
  g.turn = 1;
  const edge = g.board.edges[0];
  g.board.vertices[edge.a].owner = 0;
  g.board.vertices[edge.b].owner = 1;
  g.board.vertices[edge.a].edges.forEach(id => { if (id !== edge.id) g.board.edges[id].owner = 1; });
  g.players[0].dev = [{ kind: "roadBuilding", bought: 0 }];
  applyAction(g, 0, { type: "roadBuilding" });
  applyAction(g, 0, { type: "road", id: edge.id });
  assert.equal(g.phase, "action");
  assert.equal(g.freeRoads, 0);
});
test("Road Building timeout places both remaining free roads rather than forfeiting them", () => {
  const g = actionGame();
  g.turnSeconds = 30;
  g.players[0].dev = [{ kind: "roadBuilding", bought: 0 }];
  const roads = g.board.edges.filter(e => e.owner === 0).length;
  applyAction(g, 0, { type: "roadBuilding" }, () => 0, 1000);
  advanceClock(g, g.deadline!, () => 0);
  assert.equal(g.phase, "action");
  assert.equal(g.freeRoads, 0);
  assert.equal(g.board.edges.filter(e => e.owner === 0).length, roads + 2);
});
test("longest road follows trails, handles cycles and opponent cuts", () => {
  const g = game(),
    p = path(g, 6);
  p.edges.forEach((id) => (g.board.edges[id].owner = 0));
  assert.equal(roadLength(g, 0), 6);
  awards(g);
  assert.equal(g.longest, 0);
  g.board.vertices[p.vertices[3]].owner = 1;
  awards(g);
  assert.equal(roadLength(g, 0), 3);
  assert.equal(g.longest, null);
  g.board.edges.forEach((e) => (e.owner = null));
  g.board.vertices.forEach((v) => (v.owner = null));
  const t = g.board.tiles[5];
  for (const vid of t.vertices)
    for (const eid of g.board.vertices[vid].edges) {
      const e = g.board.edges[eid];
      if (t.vertices.includes(e.a) && t.vertices.includes(e.b)) e.owner = 0;
    }
  assert.equal(roadLength(g, 0), 6);
});
test("award ties retain incumbent and remove holder on shared tie after cut", () => {
  const g = game();
  g.players[0].knights = 3;
  awards(g);
  assert.equal(g.army, 0);
  g.players[1].knights = 3;
  awards(g);
  assert.equal(g.army, 0);
  g.players[1].knights = 4;
  awards(g);
  assert.equal(g.army, 1);
  const a = path(g, 5),
    b = path(g, 5, new Set(a.edges));
  a.edges.forEach((id) => (g.board.edges[id].owner = 0));
  awards(g);
  b.edges.forEach((id) => (g.board.edges[id].owner = 1));
  awards(g);
  assert.equal(g.longest, 0);
});
test("piece limits and city upgrades return settlements to supply", () => {
  const g = actionGame();
  g.board.vertices.forEach((v) => {
    v.owner = null;
    v.city = false;
  });
  for (let i = 0; i < 5; i++) g.board.vertices[i * 3].owner = 0;
  assert.equal(legalSettlements(g, 0, true).length, 0);
  resources(g, 0, { ore: 3, wheat: 2 });
  applyAction(g, 0, { type: "city", id: legalCities(g, 0)[0] });
  assert.equal(
    g.board.vertices.filter((v) => v.owner === 0 && !v.city).length,
    4,
  );
  assert(legalSettlements(g, 0, true).length > 0);
});
test("hidden hands, player credentials, cards and victory points stay private", () => {
  const g = setup();
  g.players[1].dev = [
    { kind: "victory", bought: 0 },
    { kind: "knight", bought: 0 },
  ];
  const v = view(g, "secret-0");
  assert(v.players[0].hand);
  assert.equal(v.players[1].hand, undefined);
  assert.equal(v.players[1].dev, undefined);
  assert.equal(v.players[1].score, 2);
  assert.equal(v.players[1].development, 2);
  assert(!JSON.stringify(v).includes("secret-"));
  assert.equal(view(g, null).me, -1);
  assert.equal(view(g, "secret-1").players[1].score, 3);
});
test("hidden VP purchase can win immediately on normal turn", () => {
  const g = actionGame();
  g.target = 3;
  g.deck = ["victory"];
  resources(g, 0, { ore: 1, wheat: 1, sheep: 1 });
  applyAction(g, 0, { type: "buyDev" });
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 0);
});
test("special phases allow building, forbid trades and card play, and defer victory", () => {
  const g = actionGame(6);
  applyAction(g, 1, { type: "specialBuild", requested: true });
  applyAction(g, 0, { type: "end" });
  assert.equal(g.phase, "special");
  assert.equal(actor(g), 1);
  g.target = 3;
  g.deck = ["victory"];
  resources(g, 1, { ore: 1, wheat: 1, sheep: 1 });
  g.players[1].dev = [{ kind: "knight", bought: 0 }];
  assert.throws(() => applyAction(g, 1, { type: "knight" }));
  assert.throws(() =>
    applyAction(g, 1, {
      type: "bankTrade",
      give: { ...emptyHand(), wood: 4 },
      want: { ...emptyHand(), ore: 1 },
    }),
  );
  applyAction(g, 1, { type: "buyDev" });
  assert.equal(g.phase, "special");
  while (g.phase === "special") applyAction(g, actor(g), { type: "pass" });
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 1);
});
test("special-phase purchased cards are playable on next normal turn", () => {
  const g = actionGame(6);
  applyAction(g, 1, { type: "specialBuild", requested: true });
  applyAction(g, 0, { type: "end" });
  g.deck = ["knight"];
  resources(g, 1, { ore: 1, wheat: 1, sheep: 1 });
  applyAction(g, 1, { type: "buyDev" });
  while (g.phase === "special") applyAction(g, actor(g), { type: "pass" });
  assert.equal(g.active, 1);
  assert.equal(g.phase, "roll");
  applyAction(g, 1, { type: "knight" });
  assert.equal(g.phase, "robber");
});
test("chat validates length and cannot alter game turn", () => {
  const g = setup();
  applyAction(g, 2, { type: "chat", text: "hello" });
  assert.equal(g.chat[0].name, "Player 2");
  assert.equal(g.phase, "roll");
  assert.throws(() =>
    applyAction(g, 2, { type: "chat", text: "a".repeat(241) }),
  );
});
test("complete simulated base games conserve resources and reach a legal winner", () => {
  for (const n of [2, 3, 4, 6, 8, 12]) {
    const g = setup(n),
      random = rng(n + 30),
      bankSize = n <= 4 ? 19 : n <= 6 ? 24 : n <= 8 ? 29 : 39;
    let steps = 0;
    while (g.phase !== "finished" && steps < 16000) {
      const p =
        g.phase === "discard" ? Number(Object.keys(g.discards)[0]) : actor(g);
      const a = chooseMove(g, p);
      assert(a, `Missing action at ${g.phase}`);
      applyAction(g, p, a!, random);
      for (const r of RESOURCES) {
        assert.equal(
          g.bank[r] + g.players.reduce((v, p) => v + p.hand[r], 0),
          bankSize,
        );
        assert(g.bank[r] >= 0);
        assert(
          g.players.every((p) => Number.isInteger(p.hand[r]) && p.hand[r] >= 0),
        );
      }
      steps++;
    }
    assert.equal(
      g.phase,
      "finished",
      `${n}-player game stalled after ${steps} actions at turn ${g.turn}`,
    );
    assert(points(g, g.winner!) >= g.target);
    console.log(
      `${n} players: winner in ${g.turn} turns, ${steps} legal actions`,
    );
  }
});

test("host custom rules validate atomically and reset ready checks", () => {
  const g = game(4);
  assert.throws(
    () => applyAction(g, 1, { type: "settings", discardLimit: 9 }),
    /host/,
  );
  assert.throws(
    () => applyAction(g, 0, { type: "settings", target: 15, discardLimit: 25 }),
    /discard/,
  );
  assert.equal(g.target, 10);
  applyAction(g, 0, {
    type: "settings",
    capacity: 8,
    target: 15,
    discardLimit: 9,
    friendlyRobber: true,
    hideBank: true,
    turnSeconds: 30,
    text: "Friday friends",
  });
  assert.equal(g.board.tiles.length, 19);
  assert.equal(g.bank.wood, 19);
  assert.equal(g.players.length, 4);
  assert.equal(g.title, "Friday friends");
  assert(g.players.every((p) => !p.ready));
  assert.throws(() => applyAction(g, 0, { type: "start" }), /ready/);
  assert.throws(
    () => applyAction(g, 0, { type: "settings", capacity: 3 }),
    /seats/,
  );
  assert.throws(
    () => applyAction(g, 0, { type: "settings", turnSeconds: 1 }),
    /timer/,
  );
  assert.throws(
    () =>
      applyAction(g, 0, {
        type: "settings",
        hideBank: "yes" as unknown as boolean,
      }),
    /setting/,
  );
});
test("color choice stays unique and stable when a lobby seat leaves", () => {
  const g = game(4);
  applyAction(g, 1, { type: "color", color: 7 });
  assert.throws(() => applyAction(g, 2, { type: "color", color: 7 }), /taken/);
  applyAction(g, 0, { type: "remove", id: 1 });
  assert.equal(g.players[1].color, 2);
  addPlayer(g, player("new", "New"));
  assert.equal(g.players[3].color, 1);
  applyAction(g, 2, { type: "nickname", text: "Updated name" });
  assert.equal(g.players[2].name, "Updated name");
  g.players.forEach((p) => (p.ready = true));
  applyAction(g, 0, { type: "start" });
  assert.throws(
    () => applyAction(g, 2, { type: "color", color: 6 }),
    /turn|Unknown/,
  );
});
test("custom discard threshold changes who discards, not the half-card amount", () => {
  const g = setup();
  g.discardLimit = 9;
  resources(g, 0, { wood: 9 });
  resources(g, 1, { brick: 10 });
  let i = 0;
  applyAction(g, 0, { type: "roll" }, () => (i++ % 2 === 0 ? 0 : 0.99));
  assert.deepEqual(g.discards, { 1: 5 });
});
test("friendly robber protects visible two-point players including hidden VP holders", () => {
  const g = setup();
  g.friendlyRobber = true;
  g.phase = "robber";
  g.resume = "action";
  g.players[1].dev.push({ kind: "victory", bought: 0 });
  const occupied = g.board.tiles.find(
    (t) =>
      t.id !== g.board.robber &&
      t.vertices.some((id) => g.board.vertices[id].owner === 1),
  )!;
  assert(!legalRobberTiles(g).includes(occupied.id));
  assert.throws(
    () => applyAction(g, 0, { type: "robber", id: occupied.id }),
    /Friendly robber/,
  );
  for (const v of g.board.vertices) if (v.owner !== null) v.city = true;
  assert(legalRobberTiles(g).includes(occupied.id));
  const projected = view(g, g.players[0].id);
  assert.deepEqual(projected.legal.robber, legalRobberTiles(g));
  assert.deepEqual(view(g, null).legal.robber, []);
});
test("friendly robber moves automatically with one legal tile and handles none", () => {
  const g = actionGame();
  g.friendlyRobber = true;
  g.phase = "roll";
  g.board.vertices.forEach((v) => (v.owner = null));
  // A minimal two-tile fixture exercises the single-choice/no-choice paths.
  g.board.tiles = g.board.tiles.slice(0, 2);
  g.board.tiles.forEach((t, i) => (t.id = i));
  g.board.robber = 0;
  g.board.tiles[1].vertices = [];
  let k = 0;
  applyAction(g, 0, { type: "roll" }, () => (k++ % 2 === 0 ? 0 : 0.99));
  assert.equal(g.board.robber, 1);
  assert.equal(g.phase, "action");
  g.phase = "roll";
  g.board.robber = 0;
  const vid = g.board.vertices[0].id;
  g.board.vertices[vid].owner = 1;
  g.board.tiles[1].vertices = [vid];
  k = 0;
  applyAction(g, 0, { type: "roll" }, () => (k++ % 2 === 0 ? 0 : 0.99));
  assert.equal(g.board.robber, 0);
  assert.equal(g.phase, "action");
  assert(g.log.some((line) => line.includes("protects every")));
});
test("custom room turns preserve supported presets and old clocks", () => {
  assert.deepEqual(TURN_SPEEDS, [0, 15, 30, 60, 120, 200]);
  const g = game();
  applyAction(g, 0, { type: "settings", turnSeconds: 15 });
  assert.equal(g.turnSeconds, 15);
  assert(g.players.every((p) => !p.ready));
  applyAction(g, 0, { type: "settings", turnSeconds: 73 });
  assert.equal(g.turnSeconds, 73);
  applyAction(g, 0, { type: "settings", turnSeconds: 240 });
  assert.equal(g.turnSeconds, 240);
  const before = JSON.stringify(g);
  assert.throws(
    () => applyAction(g, 0, { type: "settings", turnSeconds: 301 }),
    /available turn timer/,
  );
  assert.equal(JSON.stringify(g), before);
  const older = actionGame();
  older.turnSeconds = 240;
  older.deadline = 241000;
  older.clockKey = "legacy";
  normalizeGame(older);
  assert.equal(older.turnSeconds, 240);
  assert.equal(older.deadline, 241000);
});
test("15-second phase clocks have finite setup, roll, action and choice deadlines", () => {
  const opening = game();
  applyAction(opening, 0, { type: "settings", turnSeconds: 15 }, rng(), 1000);
  opening.players.forEach((p) => (p.ready = true));
  applyAction(opening, 0, { type: "start" }, rng(), 1000);
  assert.equal(opening.deadline, 31000);
  const g = actionGame();
  g.turnSeconds = 15;
  g.phase = "roll";
  g.deadline = null;
  g.clockKey = null;
  advanceClock(g, 1000);
  assert.equal(g.deadline, 6000);
  advanceClock(g, 6000, () => 0.99);
  assert.equal(g.phase, "action");
  assert.equal(g.deadline, 21000);
  advanceClock(g, 21000, () => 0.99);
  assert.equal(g.active, 1);
  assert.equal(g.phase, "roll");
  assert.equal(g.deadline, 26000);
  const choice = actionGame();
  choice.turnSeconds = 15;
  choice.phase = "robber";
  choice.resume = "action";
  choice.clockKey = null;
  choice.deadline = null;
  advanceClock(choice, 1000);
  assert.equal(choice.deadline, 6000);
});
test("Friendly Robber auto-moves on full 19/37-tile boards only after all discards finish", () => {
  for (const [n, robber, selected] of [
    [4, 5, [6, 14, 25, 29, 31, 43, 42, 24]],
    [8, 16, [7, 18, 11, 26, 20, 22, 24, 41, 40, 58, 57, 83, 82, 76, 53, 46]],
  ] as const) {
    const g = game(n);
    g.board = makeBoard(n, rng(n));
    assert.equal(g.board.tiles.length, n === 4 ? 19 : 37);
    assert.equal(g.board.robber, robber);
    selected.forEach((id, i) => {
      g.board.vertices[id].owner = Math.floor(i / 2);
    });
    for (const e of g.board.edges)
      assert(
        !(
          g.board.vertices[e.a].owner !== null &&
          g.board.vertices[e.b].owner !== null
        ),
        "All fixture settlements obey the distance rule",
      );
    assert(g.players.every((_, i) => points(g, i, false) === 2));
    g.friendlyRobber = true;
    g.phase = "roll";
    assert.deepEqual(legalRobberTiles(g), [0]);
    resources(g, 0, { wood: 8 });
    resources(g, 1, { brick: 8 });
    let k = 0;
    applyAction(g, 0, { type: "roll" }, () => (k++ % 2 === 0 ? 0 : 0.99), 1000);
    assert.equal(g.phase, "discard");
    assert.equal(g.board.robber, robber);
    applyAction(
      g,
      0,
      { type: "discard", resources: { ...emptyHand(), wood: 4 } },
      rng(),
      2000,
    );
    assert.equal(g.phase, "discard");
    assert.equal(g.board.robber, robber);
    applyAction(
      g,
      1,
      { type: "discard", resources: { ...emptyHand(), brick: 4 } },
      rng(),
      3000,
    );
    assert.equal(g.board.robber, 0);
    assert.equal(g.phase, "action");
    assert.equal(g.log.filter((l) => l.includes("moved the robber")).length, 1);
    for (const resource of RESOURCES)
      assert.equal(
        g.bank[resource] +
          g.players.reduce((sum, p) => sum + p.hand[resource], 0),
        n <= 4 ? 19 : n <= 6 ? 24 : 29,
      );
  }
});
test("the public leader is independent of perspective and hidden victory cards", () => {
  const g = actionGame();
  g.board.vertices.filter((v) => v.owner === 1)[0].city = true;
  g.players[0].dev.push(
    { kind: "victory", bought: 0 },
    { kind: "victory", bought: 0 },
  );
  assert(points(g, 0) > points(g, 1));
  const spectators = view(g, null);
  for (const id of [null, ...g.players.map((p) => p.id)]) {
    const projected = view(g, id);
    assert.deepEqual(
      projected.players.map((p) => p.publicScore),
      spectators.players.map((p) => p.publicScore),
    );
    assert.equal(publicLeader(projected), 1);
  }
  assert.equal(view(g, g.players[0].id).players[0].score, 4);
  assert.equal(spectators.players[0].score, 2);
  g.board.vertices.filter((v) => v.owner === 0)[0].city = true;
  assert.equal(
    publicLeader(view(g, null)),
    null,
    "Tied public leaders have no crown",
  );
  for (const phase of ["lobby", "setupSettlement", "setupRoad"] as const) {
    g.phase = phase;
    assert.equal(publicLeader(view(g, null)), null);
  }
  assert.equal(publicLeader({ phase: "action", players: [] }), null);
  assert.equal(
    publicLeader({ phase: "action", players: [{ publicScore: NaN }] }),
    null,
  );
});
test("hidden bank values are removed from every live projection", () => {
  const g = setup();
  g.hideBank = true;
  assert.equal(view(g, g.players[0].id).bank, null);
  assert.equal(view(g, null).bank, null);
  assert.equal(
    g.bank.wood + g.players.reduce((n, p) => n + p.hand.wood, 0),
    19,
  );
  g.phase = "finished";
  assert.deepEqual(view(g, null).bank, g.bank);
});
test("setup settlement and road get separate timers; chat does not extend either", () => {
  const g = game();
  applyAction(g, 0, { type: "start" }, rng(), 1000);
  assert.equal(g.deadline, 121000);
  applyAction(g, 1, { type: "chat", text: "Hello" }, rng(), 50000);
  assert.equal(g.deadline, 121000);
  applyAction(
    g,
    0,
    { type: "settlement", id: legalSettlements(g, 0, true)[0] },
    rng(),
    70000,
  );
  assert.equal(g.deadline, 100000);
  applyAction(g, 1, {type: "chat", text: "Road time"}, rng(), 80000);
  assert.equal(g.deadline, 100000);
  advanceClock(g, 100000, rng());
  assert.equal(g.setupStep, 1);
  assert.equal(g.phase, "setupSettlement");
  assert.equal(g.deadline, 220000);
  assert.equal(g.board.edges.filter((e) => e.owner === 0).length, 1);
});
test("every supported speed uses separate settlement, road, roll and robbery durations", () => {
  for (const [speed, settlement, road, roll, robber] of [[15,30,8,5,5],[30,60,15,10,10],[60,120,30,10,20],[120,180,45,20,40],[200,300,75,30,60],[12000,18000,4500,3000,3000]]) {
    const g = game();
    g.turnSeconds = speed;
    applyAction(g, 0, {type: "start"}, rng(), 1000);
    assert.equal(g.deadline, 1000 + settlement * 1000);
    applyAction(g, 0, {type: "settlement", id: legalSettlements(g,0,true)[0]}, rng(), 2000);
    assert.equal(g.deadline, 2000 + road * 1000);
    g.phase = "roll"; g.clockKey = null; g.deadline = null;
    advanceClock(g, 3000);
    assert.equal(g.deadline, 3000 + roll * 1000);
    g.phase = "robber"; g.clockKey = null; g.deadline = null;
    advanceClock(g, 4000);
    assert.equal(g.deadline, 4000 + robber * 1000);
  }
});
test("buying a card adds action time while chat and rejected purchases add none", () => {
  const g = actionGame();
  g.turnSeconds = 60; g.deadline = null; g.clockKey = null;
  advanceClock(g, 1000);
  resources(g, 0, {sheep: 1, wheat: 1, ore: 1});
  applyAction(g, 0, {type: "buyDev"}, rng(), 5000);
  assert.equal(g.deadline, 71000);
  applyAction(g, 0, {type: "chat", text: "No extra time"}, rng(), 6000);
  assert.equal(g.deadline, 71000);
  g.deck = [];
  assert.throws(() => applyAction(g, 0, {type: "buyDev"}, rng(), 7000));
  assert.equal(g.deadline, 71000);
});

test("Very Slow normal turns expire at 200 seconds and reject the old 200-minute selection", () => {
  const g = game();
  applyAction(g, 0, {type:"settings", turnSeconds:200}, rng(), 1000);
  assert.throws(() => applyAction(g, 0, {type:"settings", turnSeconds:12000}), /available turn timer/);
  g.phase = "action";
  g.turn = 1;
  g.clockKey = null;
  g.deadline = null;
  advanceClock(g, 1000);
  assert.equal(g.deadline, 201000);
  advanceClock(g, 200999);
  assert.equal(g.active, 0);
  advanceClock(g, 201000);
  assert.equal(g.active, 1);
});
test("expired setup resolves only mandatory placements, with legal distance", () => {
  const g = game();
  applyAction(g, 0, { type: "start" }, rng(), 1000);
  advanceClock(g, 121000, rng());
  assert.equal(g.board.vertices.filter((v) => v.owner === 0).length, 1);
  assert.equal(g.board.edges.filter((e) => e.owner === 0).length, 1);
  assert.equal(g.active, 1);
  advanceClock(g, 121001, rng());
  assert.equal(g.active, 1);
});
test("server clock rolls and ends turns once without buying or building", () => {
  const g = setup();
  g.turnSeconds = 30;
  g.clockKey = null;
  g.deadline = null;
  advanceClock(g, 1000, () => 0);
  assert.equal(g.deadline, 11000);
  advanceClock(g, 10999, () => 0);
  assert.equal(g.dice.length, 0);
  advanceClock(g, 11000, () => 0);
  assert.deepEqual(g.dice, [1, 1]);
  assert.equal(g.deadline, 41000);
  const structures = g.board.vertices.filter((v) => v.owner !== null).length;
  advanceClock(g, 41000, () => 0);
  assert.equal(g.active, 1);
  assert.equal(g.turn, 2);
  assert.equal(
    g.board.vertices.filter((v) => v.owner !== null).length,
    structures,
  );
  advanceClock(g, 41001, () => 0);
  assert.equal(g.turn, 2);
});
test("development interruption preserves remaining normal-turn time", () => {
  const g = actionGame();
  g.turnSeconds = 30;
  g.clockKey = null;
  g.deadline = null;
  advanceClock(g, 1000, rng());
  g.players[0].dev = [{ kind: "knight", bought: 0 }];
  applyAction(g, 0, { type: "knight" }, rng(), 5000);
  assert.equal(g.deadline, 15000);
  const empty = legalRobberTiles(g).find((id) =>
    g.board.tiles[id].vertices.every(
      (v) =>
        g.board.vertices[v].owner === null || g.board.vertices[v].owner === 0,
    ),
  )!;
  applyAction(g, 0, { type: "robber", id: empty }, rng(), 6000);
  assert.equal(g.phase, "action");
  assert.equal(g.deadline, 32000);
  applyAction(g, 1, { type: "chat", text: "No extra time" }, rng(), 9000);
  assert.equal(g.deadline, 32000);
});
test("expired discard returns exactly the required cards and keeps bank totals", () => {
  const g = setup();
  resources(g, 0, { wood: 8 });
  resources(g, 1, { brick: 9 });
  let k = 0;
  applyAction(g, 0, { type: "roll" }, () => (k++ % 2 === 0 ? 0 : 0.99), 1000);
  advanceClock(g, 21000, rng());
  assert.deepEqual(g.discards, {});
  assert.equal(total(g.players[0].hand), 4);
  assert.equal(total(g.players[1].hand), 5);
  for (const r of RESOURCES)
    assert.equal(g.bank[r] + g.players.reduce((n, p) => n + p.hand[r], 0), 19);
  assert.equal(g.phase, "robber");
});
test("legacy persisted rooms normalize without enabling timers or changing colors", () => {
  const original = game();
  const old = JSON.parse(JSON.stringify(original));
  for (const field of [
    "discardLimit",
    "friendlyRobber",
    "hideBank",
    "turnSeconds",
    "deadline",
    "clockKey",
    "clockResume",
  ])
    delete old[field];
  old.players.forEach((p: { color?: number }) => delete p.color);
  normalizeGame(old);
  assert.equal(old.turnSeconds, 0);
  assert.equal(old.discardLimit, 7);
  assert.deepEqual(
    old.players.map((p: { color: number }) => p.color),
    [0, 1, 2, 3],
  );
  applyAction(old, 0, { type: "start" });
  advanceClock(old, Number.MAX_SAFE_INTEGER);
  assert.equal(old.phase, "setupSettlement");
  assert.equal(old.deadline, null);
});

test("third Knight awards a winning Largest Army immediately", () => {
  const g = actionGame();
  g.target = 9;
  g.players[0].knights = 2;
  g.players[0].dev = [
    { kind: "knight", bought: 0 },
    ...Array.from({ length: 5 }, () => ({
      kind: "victory" as const,
      bought: 0,
    })),
  ];
  applyAction(g, 0, { type: "knight" });
  assert.equal(g.army, 0);
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 0);
  assert.equal(g.deadline, null);
});
