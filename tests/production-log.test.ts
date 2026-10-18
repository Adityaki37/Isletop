import test from "node:test";
import assert from "node:assert/strict";
import { addPlayer, applyAction, createGame, distribute, player, view } from "../lib/game";

function table() {
  const g = createGame("PROD22", player("p0", "Alice"), 4, false);
  addPlayer(g, player("p1", "Bob"));
  const tile = g.board.tiles.find((t) => t.resource === "wood")!;
  for (const t of g.board.tiles) t.number = t.id === tile.id ? 6 : 2;
  g.board.robber = g.board.tiles.find((t) => t.id !== tile.id)!.id;
  Object.assign(g.board.vertices[tile.vertices[0]], { owner: 0, city: true });
  Object.assign(g.board.vertices[tile.vertices[2]], { owner: 1, city: false });
  g.log = []; g.logDetails = [];
  return { g, tile };
}

test("production reports city and settlement income publicly, without revealing existing hands", () => {
  const { g } = table();
  g.players[0].hand.ore = 5; g.bank.ore -= 5;
  distribute(g, 6);
  assert.deepEqual(g.log, ["Alice got 2 wood.", "Bob got 1 wood."]);
  assert.deepEqual(view(g, null).log, g.log);
  assert.equal(view(g, "p1").players[0].hand, undefined);
  assert.deepEqual(view(g, null).productionFeedback?.transfers, [
    { seat: 0, good: "wood", amount: 2, tile: g.board.tiles.find(t => t.resource === "wood")!.id },
    { seat: 1, good: "wood", amount: 1, tile: g.board.tiles.find(t => t.resource === "wood")!.id },
  ]);
  assert(!JSON.stringify(view(g, null).productionFeedback).includes("ore"));
});

test("a robber produces no misleading resource receipt", () => {
  const { g, tile } = table(); g.board.robber = tile.id;
  distribute(g, 6);
  assert.deepEqual(g.log, ["No resources produced."]);
  assert.deepEqual(g.productionFeedback?.transfers, []);
});

test("shared shortages report no payouts; one claimant reports only the available card", () => {
  const { g, tile } = table(); g.bank.wood = 1;
  distribute(g, 6);
  assert.deepEqual(g.log, ["The bank has insufficient wood.", "No resources produced."]);
  assert.deepEqual(g.productionFeedback?.transfers, []);
  g.board.vertices[tile.vertices[2]].owner = null;
  distribute(g, 6);
  assert.equal(g.log.at(-1), "Alice got 1 wood.");
  assert.equal(g.players[0].hand.wood, 1);
  assert.deepEqual(g.productionFeedback?.transfers, [{ seat: 0, good: "wood", amount: 1, tile: tile.id }]);
});

test("seven is explicitly identified as no production", () => {
  const { g } = table(); g.phase = "roll"; g.active = 0; g.turn = 1; g.turnSeconds = 0;
  const dice = [0.4, 0.55];
  applyAction(g, 0, { type: "roll" }, () => dice.shift() ?? 0, Date.now());
  assert.deepEqual(g.dice, [3, 4]);
  assert(g.log.includes("No resources produced on a seven."));
  assert(!g.log.some((line) => line.includes(" got ")));
  assert.deepEqual(g.productionFeedback?.transfers, []);
  assert.equal(g.productionFeedback?.roll, 7);
});

test("gold choices record the exact public cards received", () => {
  const { g } = table(); g.phase = "gold"; g.goldClaims = { 0: 2 }; g.goldResume = "action"; g.turnSeconds = 0;
  applyAction(g, 0, { type: "gold", resources: { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 } }, () => 0.4, Date.now());
  assert.equal(g.log.at(-1), "Alice got 1 wood and 1 brick from gold.");
  assert.deepEqual(g.productionFeedback?.transfers, [
    { seat: 0, good: "wood", amount: 1, tile: null },
    { seat: 0, good: "brick", amount: 1, tile: null },
  ]);
});
