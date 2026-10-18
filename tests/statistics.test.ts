import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import test from "node:test";
import assert from "node:assert/strict";
import { emptyHand, RESOURCES, type Hand } from "../lib/board";
import {
  actor,
  addPlayer,
  createGame,
  player,
  view,
  legalRoads,
  legalCities,
  advanceClock,
  total,
} from "../lib/game";
import { createMatchStatistics } from "../lib/match-statistics";
import { archivedMatch } from "../lib/match-history";
import { victoryPointBreakdown } from "../lib/match-results";
import { chooseMove } from "./autoplay";
const cards = (values: Partial<Hand>) => ({ ...emptyHand(), ...values });
function game(n = 4, rush = false) {
  const g = createGame(
    "STATS2",
    player("owner", "Host"),
    n,
    false,
    rush ? "rush" : n === 2 ? "duel" : "base",
  );
  for (let p = 1; p < n; p++) {
    addPlayer(g, player(`p${p}`, `Player ${p}`));
    g.players[p].ready = true;
  }
  applyAction(g, 0, { type: "start" }, () => 0.3, 1000);
  while (g.phase.startsWith("setup"))
    applyAction(g, actor(g), chooseMove(g, actor(g))!, () => 0.3, 1000);
  return g;
}
function grant(g: ReturnType<typeof game>, p: number, hand: Partial<Hand>) {
  for (const r of RESOURCES) {
    const n = hand[r] ?? 0;
    g.players[p].hand[r] += n;
    g.bank[r] -= n;
  }
}
test("statistics track starting income and stay private until the game ends", () => {
  const g = game();
  assert.equal(g.statistics!.startedAt, 1000);
  g.players.forEach((p, i) =>
    assert.equal(g.statistics!.players[i].resources.setupIncome, total(p.hand)),
  );
  assert(g.statistics!.points.length > 1);
  for (const id of ["owner", "p1", null])
    assert.equal(view(g, id).statistics, null);
  assert.equal(archivedMatch(g), null);
});
test("payments distinguish construction and purchases from bank trades and free routes", () => {
  const g = game();
  g.phase = "action";
  g.active = 0;
  grant(g, 0, { wood: 7, brick: 3, wheat: 4, ore: 5, sheep: 3 });
  const stats = g.statistics!.players[0],
    before = stats.activity.resourcesUsed;
  applyAction(g, 0, { type: "road", id: legalRoads(g, 0)[0] });
  assert.equal(stats.activity.resourcesUsed - before, 2);
  applyAction(g, 0, { type: "city", id: legalCities(g, 0)[0] });
  assert.equal(stats.activity.resourcesUsed - before, 7);
  g.deck = ["roadBuilding"];
  applyAction(g, 0, { type: "buyDev" });
  assert.equal(stats.activity.resourcesUsed - before, 10);
  assert.equal(stats.cardsBought.roadBuilding, 1);
  g.turn++;
  applyAction(g, 0, { type: "roadBuilding" });
  applyAction(g, 0, { type: "road", id: legalRoads(g, 0)[0] });
  applyAction(g, 0, { type: "road", id: legalRoads(g, 0)[0] });
  assert.equal(stats.activity.resourcesUsed - before, 10);
  assert.equal(stats.cardsUsed.roadBuilding, 1);
  const rate = view(g, "owner").rates.wood;
  applyAction(g, 0, {
    type: "bankTrade",
    give: cards({ wood: rate }),
    want: cards({ sheep: 1 }),
  });
  assert.equal(stats.resources.tradeIncome, 1);
  assert.equal(stats.resources.tradeLoss, rate);
  assert.equal(stats.activity.bankTrades, 1);
  assert.equal(stats.activity.resourcesUsed - before, 10);
  assert.deepEqual(stats.builds, { road: 3, ship: 0, settlement: 0, city: 1 });
});

test("final victory breakdown reconciles buildings, awards, islands and revealed cards", () => {
  const g = game();
  g.board.vertices.forEach((v) => { v.owner = null; v.city = false; });
  g.board.vertices[0].owner = 0;
  Object.assign(g.board.vertices[2], { owner: 0, city: true });
  g.players[0].dev = [{ kind: "victory", bought: g.turn }];
  g.players[0].islandBonus = 2;
  g.longest = 0;
  g.army = 0;
  assert.equal(victoryPointBreakdown(view(g, "owner"), 0).victoryCards, 0);
  g.phase = "finished";
  g.winner = 0;
  const result = view(g, null);
  const breakdown = victoryPointBreakdown(result, 0);
  assert.equal(breakdown.victoryCards, 1);
  assert.equal(breakdown.settlements, 1);
  assert.equal(breakdown.cities, 2);
  assert.equal(Object.values(breakdown).reduce((sum, value) => sum + value, 0), result.players[0].score);
});
test("proposals and consent are separate from completed player exchanges", () => {
  const g = game();
  g.phase = "action";
  grant(g, 0, { wood: 2 });
  grant(g, 1, { brick: 2 });
  applyAction(g, 0, {
    type: "offer",
    give: cards({ wood: 1 }),
    want: cards({ brick: 1 }),
  });
  const id = g.offers[0].id;
  applyAction(g, 1, { type: "accept", id });
  assert.equal(g.statistics!.players[0].activity.proposedTrades, 1);
  assert.equal(g.statistics!.players[1].activity.successfulTrades, 0);
  applyAction(g, 0, { type: "completeTrade", id, to: 1 });
  for (const seat of [0, 1]) {
    assert.equal(g.statistics!.players[seat].activity.successfulTrades, 1);
    assert.equal(g.statistics!.players[seat].resources.tradeIncome, 1);
    assert.equal(g.statistics!.players[seat].resources.tradeLoss, 1);
  }
  const before = structuredClone(g.statistics);
  assert.throws(() => applyAction(g, 0, { type: "completeTrade", id, to: 1 }));
  assert.deepEqual(g.statistics, before);
});
test("discards, theft and Monopoly have separate losses from construction", () => {
  const g = game();
  g.phase = "discard";
  grant(g, 0, { ore: 4 });
  g.discards = { 0: 2 };
  const stats = g.statistics!.players[0],
    used = stats.activity.resourcesUsed;
  applyAction(g, 0, { type: "discard", resources: cards({ ore: 2 }) });
  assert.equal(stats.resources.rollingLoss, 2);
  assert.equal(stats.activity.resourcesUsed, used);
  g.phase = "steal";
  g.victims = [1];
  g.active = 0;
  applyAction(g, 0, { type: "steal", id: 1 }, () => 0);
  assert.equal(stats.resources.robbingIncome, 1);
  assert.equal(g.statistics!.players[1].resources.robbingLoss, 1);
  g.phase = "action";
  g.players[0].dev.push({ kind: "monopoly", bought: 0 });
  g.turn = 1;
  grant(g, 1, { ore: 2 });
  const victimAmount = g.players[1].hand.ore;
  const amount = g.players.slice(1).reduce((n, p) => n + p.hand.ore, 0);
  applyAction(g, 0, { type: "monopoly", resource: "ore" });
  assert.equal(stats.resources.devCardIncome, amount);
  assert.equal(g.statistics!.players[1].resources.devCardLoss, victimAmount);
});
test("production counts blocked tiles and bank shortages without counting them as income", () => {
  const g = game();
  const tile = g.board.tiles.find((t) =>
    RESOURCES.includes(t.resource as never),
  )!;
  // Isolate this roll from other randomly numbered tiles at the same vertex.
  g.board.tiles.forEach((t) => {
    t.number = 0;
  });
  g.board.vertices.forEach((v) => {
    v.owner = null;
    v.city = false;
  });
  g.board.vertices[tile.vertices[0]].owner = 0;
  tile.number = 6;
  g.board.robber = tile.id;
  g.phase = "roll";
  applyAction(g, 0, { type: "roll" }, () => 0.4);
  assert.equal(g.statistics!.players[0].activity.resourceIncomeBlocked, 1);
  g.board.robber = g.board.tiles.find((t) => t.id !== tile.id)!.id;
  g.bank[tile.resource as keyof Hand] = 0;
  g.phase = "roll";
  applyAction(g, 0, { type: "roll" }, () => 0.4);
  assert.equal(g.statistics!.players[0].activity.resourceIncomeBlocked, 2);
});
test("timed Rush rolls and discards are recorded once through automatic transitions", () => {
  const g = game(4, true);
  const sequence = g.statistics!.sequence;
  advanceClock(g, g.rush!.rollAt!, () => 0.4);
  assert.equal(g.rollCounts[6], 1);
  assert.equal(g.statistics!.sequence, sequence + 1);
  const same = structuredClone(g.statistics);
  advanceClock(g, 1001, () => 0.4);
  assert.deepEqual(g.statistics, same);
  grant(g, 0, { wood: 10 });
  let die = 0;
  advanceClock(g, g.rush!.rollAt!, () => (die++ % 2 ? 0.5 : 0.34));
  assert.equal(g.dice[0] + g.dice[1], 7);
  const required = g.discards[0];
  assert(required > 0);
  advanceClock(g, g.rush!.discardUntil!, () => 0);
  assert.equal(g.statistics!.players[0].resources.rollingLoss, required);
  const after = structuredClone(g.statistics);
  advanceClock(g, 1001, () => 0);
  assert.deepEqual(g.statistics, after);
});
test("completed archives redact secrets, retain exact results and do not expose IDs", () => {
  const g = game(2);
  applyAction(g, 0, { type: "resign" });
  const archive = archivedMatch(g)!;
  assert.equal(archive.summary.winner, 1);
  assert.equal(archive.summary.id, g.statistics!.id);
  assert(archive.result.statistics);
  assert(!("deck" in archive.result) && !("diceState" in archive.result));
  assert(archive.result.players.every((p) => !("id" in p) && !p.hand));
  assert.deepEqual(archive.result.chat, []);
  archive.result.statistics!.players[0].activity.proposedTrades = 999;
  assert.notEqual(g.statistics!.players[0].activity.proposedTrades, 999);
});
test("legacy statistics retain their recorded availability", () => {
  const g = game();
  delete (g as Partial<typeof g>).statistics;
  assert.equal(view(g, null).statistics, null);
  assert.equal(g.statistics!.complete, false);
  g.mode = "citiesKnights";
  g.statistics = createMatchStatistics(g, 0);
  assert.equal(g.statistics.detailed, true);
  g.statistics.detailed = false;
  g.phase = "finished";
  assert.equal(view(g, null).statistics!.detailed, false);
});
