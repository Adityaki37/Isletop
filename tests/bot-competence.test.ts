import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  player,
  addPlayer,
  applyAction,
  awards,
  roadLength,
  view,
  points,
  resourceCardStock,
} from "../lib/game";
import { botMove, advanceBots, BOT_TRADE_WAIT, BOT_MOVE_INTERVAL } from "../lib/disconnect-bots";
import { emptyHand } from "../lib/board";
import { plannedBaseCandidates } from "../lib/bot-strategy-planned";
import { botBuildWait } from "../lib/bot-economy";
import { tradeCooldown } from "../lib/trading";
import { citiesCandidates } from "../lib/bot-strategy-cities";
import type { Game } from "../lib/game";
import { makeBaseBoard } from "../lib/base-maps";
function fixture(mode: Game["mode"] = "base", seats = 4) {
  const g = createGame("SKILLB", player("0", "Bot"), seats, false, mode);
  for (let p = 1; p < seats; p++) addPlayer(g, player(String(p), `Seat ${p}`));
  g.players.forEach((p) => (p.ready = true));
  g.turnSeconds = 0;
  applyAction(g, 0, { type: "start" }, () => 0.37);
  if (mode === "base") g.board = makeBaseBoard(seats, "base", () => 0.37);
  g.phase = "action";
  g.active = 0;
  g.turn = 10;
  return g;
}
function balanceBank(g: Game) {
  for (const r of RESOURCES)
    g.bank[r] =
      resourceCardStock(g.boardPlayers) -
      g.players.reduce((n, p) => n + p.hand[r], 0);
}

// Public geometry and own cards from the recorded turn-54 decision. Other
// hands are synthetic allocations that conserve the displayed combined stock.
function closeSettlementFixture(mode: "base" | "seafarers" = "base") {
  const g = fixture(mode);
  g.board = makeBaseBoard(4, "base", () => 0.37);
  const terrain = [
    ["wood", 4],
    ["sheep", 11],
    ["ore", 12],
    ["wood", 8],
    ["ore", 3],
    ["sheep", 6],
    ["wheat", 9],
    ["sheep", 5],
    ["wheat", 10],
    ["ore", 11],
    ["sheep", 5],
    ["wheat", 10],
    ["wheat", 2],
    ["brick", 9],
    ["wood", 4],
    ["wood", 8],
    ["desert", 0],
    ["brick", 6],
    ["brick", 3],
  ] as const;
  terrain.forEach(([resource, number], id) =>
    Object.assign(g.board.tiles[id], { resource, number }),
  );
  for (const [id, owner] of [
    [2, 2],
    [8, 1],
    [11, 1],
    [15, 0],
    [20, 1],
    [23, 1],
    [29, 0],
    [31, 3],
    [33, 2],
    [41, 3],
    [43, 3],
    [45, 2],
    [47, 3],
    [50, 3],
  ])
    Object.assign(g.board.vertices[id], { owner, city: id === 20 });
  for (const [id, owner] of [
    [7, 1],
    [12, 1],
    [16, 2],
    [24, 1],
    [25, 1],
    [26, 1],
    [27, 1],
    [30, 1],
    [31, 0],
    [32, 0],
    [33, 0],
    [34, 0],
    [36, 0],
    [43, 2],
    [44, 3],
    [47, 2],
    [50, 0],
    [51, 0],
    [52, 0],
    [56, 3],
    [58, 3],
    [59, 2],
    [60, 2],
    [66, 3],
    [67, 3],
    [68, 3],
    [69, 2],
  ])
    Object.assign(g.board.edges[id], { owner, kind: "road" });
  g.board.ports = [
    { edge: 4, resource: "sheep" },
    { edge: 10, resource: "any" },
    { edge: 30, resource: "wheat" },
    { edge: 45, resource: "wood" },
    { edge: 60, resource: "any" },
    { edge: 67, resource: "any" },
    { edge: 64, resource: "brick" },
    { edge: 52, resource: "ore" },
    { edge: 19, resource: "any" },
  ];
  g.board.robber = 6;
  g.players[0].hand = { wood: 1, brick: 0, sheep: 2, wheat: 1, ore: 2 };
  g.players[0].dev = [{ kind: "victory", bought: 22 }];
  g.players[1].hand = { ...emptyHand(), wood: 4 };
  g.players[1].knights = 2;
  g.players[2].hand = { ...emptyHand(), wood: 5, brick: 4 };
  g.players[3].hand = { ...emptyHand(), sheep: 6, wheat: 2, ore: 1 };
  g.players[3].dev = [{ kind: "knight", bought: 0 }];
  g.longest = 1;
  g.army = null;
  g.turn = 54;
  g.botTradeMemory = {
    0: { turn: 54, attempts: 2, signatures: [], startedAt: 0 },
  };
  balanceBank(g);
  return g;
}
for (const mode of ["base", "seafarers"] as const)
  test(`${mode} reserves a near settlement rather than spending its cards on development`, () => {
    const g = closeSettlementFixture(mode),
      before = structuredClone(g);
    const move = botMove(g, 0)!;
    assert.deepEqual(move, { type: "end" });
    assert.deepEqual(g, before);
    const hidden = structuredClone(g);
    hidden.players[1].hand = { ...emptyHand(), wood: 3, ore: 1 };
    hidden.players[3].hand = { ...emptyHand(), wood: 1, sheep: 6, wheat: 2 };
    hidden.players[3].dev = [{ kind: "victory", bought: 0 }];
    const publicView = view(g, "0"),
      hiddenView = view(hidden, "0");
    hiddenView.serverTime = publicView.serverTime;
    assert.deepEqual(hiddenView, publicView);
    assert.deepEqual(botMove(hidden, 0), move);
    // The next produced brick completes a normally validated settlement.
    g.players[0].hand.brick++;
    g.bank.brick--;
    const build = botMove(g, 0)!;
    assert.equal(build.type, "settlement");
    applyAction(g, 0, build);
    assert.equal(points(g, 0), 4);
  });
test("surplus road cards remain usable while reserving a settlement", () => {
  const g = closeSettlementFixture();
  g.players[0].hand = { wood: 2, brick: 2, sheep: 0, wheat: 1, ore: 2 };
  balanceBank(g);
  const move = botMove(g, 0)!;
  assert.equal(move.type, "road");
  applyAction(g, 0, move);
  assert.equal(g.players[0].hand.wood, 1);
  assert.equal(g.players[0].hand.brick, 1);
  assert.equal(g.players[0].hand.wheat, 1);
});
test("build funding estimates simultaneous dice production rather than independent deficits", () => {
  const g = fixture(),
    vertex = g.board.vertices.find((v) => v.tiles.length === 2)!;
  vertex.owner = 0;
  const [first, second] = vertex.tiles;
  Object.assign(g.board.tiles[first], { resource: "wood", number: 6 });
  Object.assign(g.board.tiles[second], { resource: "wheat", number: 6 });
  g.board.robber = g.board.tiles.find((t) => !vertex.tiles.includes(t.id))!.id;
  g.players[0].hand = emptyHand();
  g.players[1].hand = { ...emptyHand(), wood: 19, wheat: 19, ore: 19 };
  balanceBank(g);
  const projected = view(g, "0");
  // With these goods entirely held by opponents, disable the hypothetical
  // bank-conversion channel to isolate the public dice-production calculation.
  projected.bank!.wood = 0;
  projected.bank!.wheat = 0;
  assert(Math.abs(botBuildWait(projected, { wood: 1 }) - 1.8) < 1e-9);
  assert(Math.abs(botBuildWait(projected, { wood: 1, wheat: 1 }) - 1.8) < 1e-9);
  projected.board.tiles[second].number = 8;
  assert(Math.abs(botBuildWait(projected, { wood: 1, wheat: 1 }) - 2.7) < 1e-9);
  projected.bank!.ore = 0;
  assert.equal(botBuildWait(projected, { ore: 1 }), Infinity);
});

// A small public network isolates access to a distance-rule-safe site. The
// opposing building at 3 makes that legal road a dead end for expansion.
function routeProjection(mode: "base" | "seafarers", connected: boolean) {
  const projected = view(fixture(mode), "0"),
    kind = mode === "seafarers" ? "ship" : "road",
    pairs = [
      [0, 1],
      [1, 2],
      [1, 3],
      [2, 4],
      [4, 5],
    ];
  projected.board.tiles = [
    {
      ...projected.board.tiles[0],
      id: 0,
      resource: "wheat",
      number: 5,
      vertices: [0, 1, 2, 3, 4, 5],
    },
    {
      ...projected.board.tiles[1],
      id: 1,
      resource: "sea",
      number: 0,
      vertices: [0, 1, 2, 3, 4, 5],
    },
  ];
  projected.board.vertices = projected.board.vertices
    .slice(0, 6)
    .map((v, id) => ({
      ...v,
      id,
      owner: id === 0 ? 0 : id === 3 || id === 5 ? 1 : null,
      city: false,
      tiles: [0, 1],
      edges: pairs.flatMap(([a, b], eid) =>
        a === id || b === id ? [eid] : [],
      ),
    }));
  projected.board.edges = pairs.map(([a, b], id) => ({
    ...projected.board.edges[id],
    id,
    a,
    b,
    kind,
    tiles: [0, 1],
    owner: id === 0 || (connected && id === 1) ? 0 : null,
  }));
  projected.board.ports = [];
  projected.board.robber = 1;
  projected.board.pirate = null;
  projected.legal.road = kind === "road" ? (connected ? [2, 3] : [1, 2]) : [];
  projected.legal.ship = kind === "ship" ? (connected ? [2, 3] : [1, 2]) : [];
  projected.legal.city = [];
  projected.legal.settlement = connected ? [2] : [];
  projected.players[0].hand = {
    ...emptyHand(),
    wood: 1,
    brick: 1,
    sheep: 1,
    wheat: 1,
  };
  projected.players[0].roadLength = connected ? 2 : 1;
  projected.players[0].pieces = {
    ...projected.players[0].pieces,
    settlement: 1,
    city: 0,
    road: kind === "road" ? (connected ? 2 : 1) : 0,
    ship: kind === "ship" ? (connected ? 2 : 1) : 0,
  };
  return projected;
}
for (const mode of ["base", "seafarers"] as const) {
  test(`${mode} plans a settlement rather than more branches to an already connected site`, () => {
    const projected = routeProjection(mode, true);
    const plans = basePlans(projected);
    assert(
      !plans.some(
        (plan) => plan.action.type === "road" || plan.action.type === "ship",
      ),
    );
    assert.deepEqual(plannedBaseCandidates(projected)[0], {
      type: "settlement",
      id: 2,
    });
  });
  test(`${mode} routes toward the available site rather than an opposing dead end`, () => {
    const projected = routeProjection(mode, false);
    const routes = basePlans(projected).filter(
      (plan) => plan.action.type === "road" || plan.action.type === "ship",
    );
    assert.equal(routes.length, 1);
    assert.deepEqual(routes[0].action, {
      type: mode === "base" ? "road" : "ship",
      id: 1,
    });
  });
}

for (const [mode, active] of [
  ["base", 0],
  ["base", 1],
  ["seafarers", 2],
] as const)
  test(`${mode} discard on seat ${active}'s turn preserves an affordable city`, () => {
    const g = fixture(mode);
    const vertex = g.board.vertices.find(
      (v) =>
        v.tiles.length === 3 &&
        v.tiles.every((id) => g.board.tiles[id].resource !== "sea"),
    )!;
    vertex.owner = 0;
    g.players[0].hand = { ...emptyHand(), wood: 2, sheep: 3, wheat: 2, ore: 3 };
    g.players[1].hand = { ...emptyHand(), wood: 4 };
    g.players[1].dev = [{ kind: "knight", bought: 0 }];
    g.hideBank = true;
    balanceBank(g);
    g.phase = "discard";
    g.active = active;
    g.resume = "action";
    g.discards = { 0: 5 };
    assert.deepEqual(view(g, "0").legal.city, []);
    const before = structuredClone(g);
    const move = botMove(g, 0)!;
    assert.deepEqual(move, {
      type: "discard",
      resources: { ...emptyHand(), wood: 2, sheep: 3 },
    });
    assert.deepEqual(g, before);
    const hidden = structuredClone(g);
    hidden.players[1].hand = { ...emptyHand(), ore: 4 };
    hidden.players[1].dev = [{ kind: "victory", bought: 0 }];
    balanceBank(hidden);
    const hiddenView = view(hidden, "0"),
      publicView = view(g, "0");
    hiddenView.serverTime = publicView.serverTime;
    assert.deepEqual(hiddenView, publicView);
    assert.deepEqual(botMove(hidden, 0), move);
    applyAction(g, 0, move);
    assert.deepEqual(g.players[0].hand, { ...emptyHand(), wheat: 2, ore: 3 });
    g.phase = "action";
    g.active = 0;
    const build = botMove(g, 0)!;
    assert.equal(build.type, "city");
    applyAction(g, 0, build);
    assert.equal(vertex.city, true);
    assert.equal(points(g, 0), 2);
  });
test("a bot takes the road that secures Longest Road and immediately wins", () => {
  const g = fixture();
  const find = (
    v: number,
    used: number[],
    vertices: number[],
  ): { edges: number[]; vertices: number[] } | null => {
    if (used.length === 4) return { edges: used, vertices };
    for (const eid of g.board.vertices[v].edges) {
      const e = g.board.edges[eid],
        other = e.a === v ? e.b : e.a;
      if (used.includes(eid) || vertices.includes(other)) continue;
      const found = find(other, [...used, eid], [...vertices, other]);
      if (found) return found;
    }
    return null;
  };
  const path = find(0, [], [0])!;
  g.board.vertices[0].owner = 0;
  path.edges.forEach((id) => {
    g.board.edges[id].owner = 0;
    g.board.edges[id].kind = "road";
  });
  g.players[0].dev = Array.from({ length: 7 }, () => ({
    kind: "victory" as const,
    bought: 0,
  }));
  g.players[0].hand = { ...emptyHand(), wood: 1, brick: 1 };
  awards(g);
  assert.equal(roadLength(g, 0), 4);
  assert.equal(points(g, 0), 8);
  const a = botMove(g, 0)!;
  assert.equal(a.type, "road");
  applyAction(g, 0, a);
  assert.equal(g.longest, 0);
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 0);
});
test("a bot declines a resource gift that lets an opponent at nine points finish", () => {
  const g = fixture();
  g.board.vertices[0].owner = 0;
  g.board.vertices[5].owner = 1;
  g.players[0].dev = Array.from({ length: 8 }, () => ({
    kind: "victory" as const,
    bought: 0,
  }));
  g.players[0].hand = { ...emptyHand(), wood: 1 };
  g.players[1].hand = { ...emptyHand(), brick: 1 };
  applyAction(g, 0, {
    type: "offer",
    give: { ...emptyHand(), wood: 1 },
    want: { ...emptyHand(), brick: 1 },
    to: 1,
  });
  // Public nine points, rather than hidden VP cards, drives the rejection.
  const publicNine = structuredClone(view(g, "1"));
  publicNine.players[0].publicScore = 9;
  // The pure trade evaluator uses only the documented player projection.
  assert.equal(strategicTrade(publicNine, { brick: 1 }, { wood: 1 }, 0), false);
});
import { strategicTrade } from "../lib/bot-economy";
test("bots propose a missing build card using only public opponent information", () => {
  const g = fixture();
  g.botPlayers = [0];
  g.players[0].bot = true;
  g.board.vertices[0].owner = 0;
  g.players[0].hand = { ...emptyHand(), wood: 1, wheat: 2, ore: 2 };
  g.players[1].hand = { ...emptyHand(), ore: 1, sheep: 1 };
  g.players[2].hand = { ...emptyHand(), ore: 1, sheep: 1 };
  balanceBank(g);
  const move = botMove(g, 0)!;
  assert.equal(move.type, "offer");
  assert.equal(total(move.give!), 1);
  assert.equal(total(move.want!), 1);
  const handAfter = { ...g.players[0].hand };
  for (const r of RESOURCES) handAfter[r] += move.want![r] - move.give![r];
  assert(
    basePlans(view(g, "0")).some(
      (plan) =>
        RESOURCES.some((r) => g.players[0].hand[r] < (plan.cost[r] ?? 0)) &&
        RESOURCES.every((r) => handAfter[r] >= (plan.cost[r] ?? 0)),
    ),
  );
  const hidden = structuredClone(g);
  hidden.players[1].hand = { ...emptyHand(), ore: 2 };
  hidden.players[2].hand = { ...emptyHand(), sheep: 2 };
  assert.deepEqual(botMove(hidden, 0), move);
  applyAction(g, 0, move);
  assert(!("botTradeMemory" in view(g, "0")));
  assert(!("botTradeMemory" in view(g, null)));
});
test("the scheduler lets a recipient answer and the active bot confirms an accepted offer", () => {
  const g = fixture(),
    now = Date.now();
  g.botPlayers = [0, 1];
  g.players[0].bot = true;
  g.players[1].bot = true;
  g.players[0].hand = { ...emptyHand(), wood: 2 };
  g.players[1].hand = { ...emptyHand(), ore: 1 };
  applyAction(
    g,
    0,
    {
      type: "offer",
      give: { ...emptyHand(), wood: 2 },
      want: { ...emptyHand(), ore: 1 },
      to: 1,
    },
    undefined,
    now,
  );
  advanceBots(g, [0, 1], now);
  assert.deepEqual(g.offers[0].accepted, [1]);
  advanceBots(g, [0, 1], now + BOT_MOVE_INTERVAL + 1);
  assert.equal(g.offers.length, 0);
  assert.equal(g.active, 0);
  assert.equal(g.players[0].hand.ore, 1);
  assert.equal(g.players[1].hand.wood, 2);
});
test("unanswered bot offers time out, survive serialization and cannot repeat indefinitely", () => {
  let g = fixture();
  const now = Date.now();
  g.botPlayers = [0];
  g.players[0].bot = true;
  g.board.vertices[0].owner = 0;
  g.players[0].hand = { ...emptyHand(), wood: 1, wheat: 2, ore: 2 };
  g.players[1].hand = { ...emptyHand(), ore: 1 };
  balanceBank(g);
  const offer = botMove(g, 0, now)!;
  assert.equal(offer.type, "offer");
  applyAction(g, 0, offer, undefined, now);
  g = JSON.parse(JSON.stringify(g));
  const responseWindow = Math.max(BOT_TRADE_WAIT, tradeCooldown(g.turnSeconds));
  assert.equal(botMove(g, 0, now + responseWindow - 1), null);
  const close = botMove(g, 0, now + responseWindow)!;
  assert.equal(close.type, "cancelOffer");
  applyAction(g, 0, close, undefined, now + responseWindow);
  let offers = 1;
  for (let step = 1; step <= 20 && g.phase === "action"; step++) {
    const time = now + (step + 1) * responseWindow;
    const action = botMove(g, 0, time)!;
    assert(action);
    if (action.type === "offer") offers++;
    applyAction(g, 0, action, undefined, time);
  }
  assert(offers <= 2);
  assert.notEqual(g.phase, "action");
});
test("a bot cancels all-rejected offers promptly and never targets an embargoed or near-winning seat", () => {
  const g = fixture(),
    now = Date.now();
  g.botPlayers = [0];
  g.players[0].bot = true;
  g.board.vertices[0].owner = 0;
  g.players[0].hand = { ...emptyHand(), wood: 1, wheat: 2, ore: 2 };
  g.players[1].hand = { ...emptyHand(), ore: 1 };
  g.players[2].hand = { ...emptyHand(), ore: 1 };
  balanceBank(g);
  g.players[0].embargoes = [2];
  const move = botMove(g, 0, now)!;
  assert.deepEqual(move.targets, [1]);
  applyAction(g, 0, move, undefined, now);
  applyAction(g, 1, { type: "reject", id: g.offers[0].id }, undefined, now);
  assert.equal(botMove(g, 0, now)?.type, "cancelOffer");
  const projected = view(g, "0");
  projected.players[1].publicScore = 8;
  assert.equal(
    planPlayerTrade(
      projected,
      basePlans(projected).find((p) => p.action.type === "city")!,
    ),
    null,
  );
});
test("a bot preserves a human counteroffer draft beyond its original wait and responds to the submitted counter", () => {
  const g = fixture(), now = Date.now();
  g.botPlayers = [0];
  g.players[0].bot = true;
  g.players[0].hand = { ...emptyHand(), wood: 2 };
  g.players[1].hand = { ...emptyHand(), ore: 1 };
  balanceBank(g);
  applyAction(g, 0, { type: "offer", give: { ...emptyHand(), wood: 2 }, want: { ...emptyHand(), ore: 1 }, to: 1 }, undefined, now);
  const id = g.offers[0].id;
  applyAction(g, 1, { type: "accept", id }, undefined, now + 1000);
  applyAction(g, 1, { type: "prepareCounter", id, preparing: true }, undefined, now + 9000);
  assert.deepEqual(g.offers[0].accepted, [], "Countering revokes the old acceptance before the bot can execute it.");
  assert.equal(botMove(g, 0, now + 11000), null);
  assert.equal(botMove(g, 0, now + 40000), null);
  applyAction(g, 1, { type: "prepareCounter", id, preparing: true }, undefined, now + 42000);
  assert.equal(botMove(g, 0, now + 61000), null, "A renewed draft outlives the original response deadline.");
  applyAction(g, 1, { type: "counterOffer", id, give: { ...emptyHand(), ore: 1 }, want: { ...emptyHand(), wood: 1 } }, undefined, now + 62000);
  const action = botMove(g, 0, now + 63000)!;
  assert.equal(action.type, "completeTrade");
  applyAction(g, 0, action, undefined, now + 63000);
  assert.equal(g.players[0].hand.ore, 1);
  assert.equal(g.players[1].hand.wood, 1);
  assert.equal(g.offers.length, 0);
});
test("canceling a counter draft restores the response window without making the bot wait forever", () => {
  const g = fixture(), now = Date.now();
  g.botPlayers = [0];
  g.players[0].bot = true;
  g.players[0].hand = { ...emptyHand(), wood: 2 };
  g.players[1].hand = { ...emptyHand(), ore: 1 };
  applyAction(g, 0, { type: "offer", give: { ...emptyHand(), wood: 2 }, want: { ...emptyHand(), ore: 1 }, to: 1 }, undefined, now);
  const id = g.offers[0].id;
  applyAction(g, 1, { type: "prepareCounter", id, preparing: true }, undefined, now + 9000);
  applyAction(g, 1, { type: "prepareCounter", id, preparing: false }, undefined, now + 40000);
  assert.equal(botMove(g, 0, now + 61000), null);
  assert.equal(botMove(g, 0, now + 100001)?.type, "cancelOffer");
});
import { planPlayerTrade, basePlans } from "../lib/bot-economy";
import { total } from "../lib/game";
import { RESOURCES } from "../lib/board";
test("pause and resume preserve the remaining bot trade response window", () => {
  const g = fixture(),
    now = Date.now();
  g.botPlayers = [0];
  g.players[0].bot = true;
  g.players[0].hand = { ...emptyHand(), wood: 1 };
  g.players[1].hand = { ...emptyHand(), ore: 1 };
  applyAction(
    g,
    0,
    {
      type: "offer",
      give: { ...emptyHand(), wood: 1 },
      want: { ...emptyHand(), ore: 1 },
      to: 1,
    },
    undefined,
    now,
  );
  applyAction(g, 1, { type: "pauseRequest" }, undefined, now + 1000);
  for (const p of [2, 3])
    applyAction(
      g,
      p,
      { type: "pauseVote", id: g.pause.vote!.id, accept: true },
      undefined,
      now + 1000,
    );
  assert.equal(g.pause.pausedAt, now + 1000);
  advanceBots(g, [0], now + 11000);
  assert.equal(g.offers.length, 1);
  applyAction(g, 1, { type: "pauseRequest" }, undefined, now + 21000);
  for (const p of [2, 3])
    applyAction(
      g,
      p,
      { type: "pauseVote", id: g.pause.vote!.id, accept: true },
      undefined,
      now + 21000,
    );
  assert.equal(g.botTradeMemory![0].startedAt, now + 20000);
  const responseWindow = Math.max(BOT_TRADE_WAIT, tradeCooldown(g.turnSeconds));
  assert.equal(botMove(g, 0, now + 20000 + responseWindow - 1), null);
  assert.equal(botMove(g, 0, now + 20000 + responseWindow)?.type, "cancelOffer");
});
test("bot Monopoly choices are invariant to concealed opponent resource composition", () => {
  const g = fixture();
  g.hideBank = true;
  g.board.vertices[0].owner = 0;
  g.board.vertices[8].owner = 1;
  g.players[0].dev = [{ kind: "monopoly", bought: 0 }];
  g.players[1].hand = { ...emptyHand(), wood: 15 };
  const other = structuredClone(g);
  other.players[1].hand = { ...emptyHand(), ore: 15 };
  assert.deepEqual(botMove(g, 0), botMove(other, 0));
});

for (const seats of [4, 6, 8]) {
  test(`Monopoly uses the visible bank to collect the scarce resource with ${seats} seats`, () => {
    const g = createGame("STOCKB", player("0", "Bot"), seats, false, "base");
    for (let p = 1; p < seats; p++)
      addPlayer(g, player(String(p), `Seat ${p}`));
    g.players.forEach((p) => (p.ready = true));
    g.turnSeconds = 0;
    applyAction(g, 0, { type: "start" }, () => 0.37);
    g.phase = "action";
    g.turn = 10;
    g.active = 0;
    g.board.vertices[0].owner = 0;
    g.board.vertices[8].owner = 1;
    g.board.tiles.forEach((t) => {
      t.resource = "wood";
      t.number = 6;
    });
    g.players[0].dev = [{ kind: "monopoly", bought: 0 }];
    g.players[1].hand = { ...emptyHand(), wood: 3, ore: 4 };
    g.players[2].hand = { ...emptyHand(), wood: 3, ore: 3 };
    g.bank.wood -= 6;
    g.bank.ore -= 7;
    const move = botMove(g, 0)!;
    assert.deepEqual(move, { type: "monopoly", resource: "ore" });
    // Redistribute cards without changing any public bank or player total.
    const hidden = structuredClone(g);
    hidden.players[1].hand = { ...emptyHand(), wood: 4, ore: 3 };
    hidden.players[2].hand = { ...emptyHand(), wood: 2, ore: 4 };
    assert.deepEqual(botMove(hidden, 0), move);
    applyAction(g, 0, move);
    assert.equal(g.players[0].hand.ore, 7);
    assert.equal(g.players[1].hand.ore + g.players[2].hand.ore, 0);
  });
}

test("a bot avoids an impossible player trade with a visible bank but retains hidden-bank negotiation", () => {
  const g = fixture();
  g.board.vertices[0].owner = 0;
  g.players[0].hand = { ...emptyHand(), wood: 1, wheat: 2, ore: 2 };
  g.players[1].hand = { ...emptyHand(), wood: 1 };
  g.bank.wood -= 2;
  g.bank.wheat -= 2;
  g.bank.ore -= 2;
  const projected = view(g, "0"),
    city = basePlans(projected).find((p) => p.action.type === "city")!;
  assert(city);
  assert.equal(planPlayerTrade(projected, city), null);
  g.hideBank = true;
  const offer = planPlayerTrade(view(g, "0"), city)!;
  assert.equal(offer.type, "offer");
  assert.equal(offer.want!.ore, 1);
  assert.deepEqual(offer.targets, [1]);
});

for (const seats of [4, 6, 8])
  test(`Monopoly keeps public-production estimates with ${seats} seats when the bank is hidden`, () => {
    const g = fixture("base", seats);
    g.hideBank = true;
    g.board.vertices[8].owner = 1;
    g.board.tiles.forEach((t) => {
      t.resource = "wood";
      t.number = 6;
    });
    g.players[0].dev = [{ kind: "monopoly", bought: 0 }];
    g.players[1].hand = { ...emptyHand(), wood: 7 };
    assert.deepEqual(botMove(g, 0), { type: "monopoly", resource: "wood" });
  });

test("a bot saves Monopoly when a visible full bank proves no opponents hold cards of the predicted type", () => {
  const g = fixture();
  g.board.vertices[8].owner = 1;
  g.board.tiles.forEach((t) => {
    t.resource = "wood";
    t.number = 6;
  });
  g.players[0].dev = [{ kind: "monopoly", bought: 0 }];
  g.players[1].hand = { ...emptyHand(), ore: 2 };
  g.bank.ore -= 2;
  assert.equal(botMove(g, 0)?.type, "end");
});
test("a bot saves a Knight before dice when it already holds Largest Army and is unblocked", () => {
  const g = fixture();
  g.phase = "roll";
  g.players[0].knights = 4;
  g.army = 0;
  g.players[0].dev = [{ kind: "knight", bought: 0 }];
  assert.equal(botMove(g, 0)?.type, "roll");
});
test("a Seafarers bot chooses an opposing fleet over blocking its own production", () => {
  const g = fixture("seafarers");
  g.phase = "robber";
  const own = g.board.tiles.find((t) => t.resource !== "sea" && t.number > 0)!,
    sea = g.board.tiles.find((t) => t.resource === "sea")!;
  g.board.vertices[own.vertices[0]].owner = 0;
  g.board.edges.find((e) => e.tiles.includes(sea.id))!.owner = 1;
  g.board.edges.find((e) => e.tiles.includes(sea.id))!.kind = "ship";
  const projected = view(g, "0");
  projected.legal.robber = [own.id];
  projected.legal.pirate = [sea.id];
  assert.deepEqual(plannedBaseCandidates(projected)[0], {
    type: "pirate",
    id: sea.id,
  });
});
test("a C&K bot saves Inventor when a swap would help its opponent, and plays a beneficial swap", () => {
  const g = fixture("citiesKnights"),
    own = g.board.tiles[0],
    other = g.board.tiles.find((t) =>
      t.vertices.every((id) => !own.vertices.includes(id)),
    )!;
  g.board.tiles.forEach((t) => (t.number = 6));
  g.board.vertices[own.vertices[0]].owner = 0;
  g.board.vertices[other.vertices[0]].owner = 1;
  own.number = 5;
  other.number = 3;
  g.cities!.players[0].progress = [
    { id: 1, kind: "inventor", track: "science" },
  ];
  assert(
    !citiesCandidates(view(g, "0")).some(
      (a) => a.type === "progress" && a.cardId === 1,
    ),
  );
  own.number = 3;
  other.number = 5;
  const swap = citiesCandidates(view(g, "0")).find(
    (a) => a.type === "progress" && a.cardId === 1,
  );
  assert.deepEqual(swap, {
    type: "progress",
    cardId: 1,
    tiles: [own.id, other.id],
  });
});
