import test from "node:test";
import assert from "node:assert/strict";
import { makeBoard } from "../lib/board";
import { productionTransfers } from "../lib/production-feedback";

test("Cities & Knights splits a city's production into resource and commodity without overpaying", () => {
  const board = makeBoard(4, () => .41);
  const tile = board.tiles.find(t => t.resource === "wood")!;
  board.tiles.forEach(t => t.number = t.id === tile.id ? 6 : 2);
  board.robber = board.tiles.find(t => t.id !== tile.id)!.id;
  Object.assign(board.vertices[tile.vertices[0]], { owner: 0, city: true });
  Object.assign(board.vertices[tile.vertices[2]], { owner: 1, city: false });
  assert.deepEqual(productionTransfers(board, true, 6, [{ wood: 1, paper: 1 }, { wood: 1 }]), [
    { seat: 0, good: "wood", amount: 1, tile: tile.id },
    { seat: 0, good: "paper", amount: 1, tile: tile.id },
    { seat: 1, good: "wood", amount: 1, tile: tile.id },
  ]);
  assert.deepEqual(productionTransfers(board, true, 6, [{ paper: 1 }, {}]), [
    { seat: 0, good: "paper", amount: 1, tile: tile.id },
  ]);
});

test("one player's scarce payout shared among multiple sources is conserved", () => {
  const board = makeBoard(8, () => .41);
  const tiles = board.tiles.filter(t => t.resource === "wheat").slice(0, 2);
  board.tiles.forEach(t => t.number = tiles.includes(t) ? 6 : 2);
  board.robber = board.tiles.find(t => !tiles.includes(t))!.id;
  tiles.forEach(t => Object.assign(board.vertices[t.vertices[0]], { owner: 0, city: true }));
  const transfers = productionTransfers(board, false, 6, [{ wheat: 3 }]);
  assert.equal(transfers.reduce((sum, t) => sum + t.amount, 0), 3);
  assert(transfers.every(t => t.seat === 0 && t.good === "wheat" && tiles.some(tile => tile.id === t.tile)));
});
