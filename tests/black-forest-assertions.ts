import assert from "node:assert/strict";
import type { Game, View } from "../lib/game";

export function assertBlackForestProjection(g: View) {
  assert(!("fogDeck" in g) && !("fogNumbers" in g));
  if (g.map !== "blackForest") return;
  assert.equal(g.board.tiles.length, 61);
  assert(
    g.board.tiles
      .filter((t) => t.fog)
      .every((t) => t.resource === "sea" && t.number === 0 && !t.home),
  );
  assert.equal(g.board.pirate, undefined);
  assert.equal(g.board.ports.length, 6);
  assert(g.board.ports.every((p) => p.resource === "wood"));
}
// Read-only inventory accounting, never used to select a future discovery.
export function assertBlackForestInventory(g: Game) {
  if (g.map !== "blackForest") return;
  assert.equal(g.board.tiles.length, 61);
  assert.equal(g.board.tiles.filter((t) => t.fog).length, g.fogDeck.length);
  assert.equal(g.fogNumbers.length, g.fogDeck.length);
  assert.equal(g.board.tiles.filter((t) => t.home).length, 24);
  // Inventor may exchange visible forest/revealed tokens. Preserve the complete
  // number inventory, without assuming a token remains in its starting region.
  for (const [number, count] of [
    [2, 1],
    [3, 2],
    [4, 7],
    [5, 9],
    [6, 9],
    [8, 9],
    [9, 8],
    [10, 6],
    [11, 2],
    [12, 1],
  ])
    assert.equal(
      g.fogNumbers.filter((n) => n === number).length +
        g.board.tiles.filter((t) => !t.fog && t.number === number).length,
      count,
    );
  for (const [resource, n] of [
    ["wood", 24],
    ["brick", 9],
    ["sheep", 8],
    ["wheat", 7],
    ["ore", 6],
    ["desert", 1],
  ] as const)
    assert.equal(
      g.fogDeck.filter((r) => r === resource).length +
        g.board.tiles.filter((t) => !t.fog && t.resource === resource).length,
      n,
    );
  assert.equal(
    g.board.tiles.filter((t) => !t.fog && t.resource === "sea").length,
    6,
  );
  assert(g.players.every((p) => p.islandBonus === 0));
  assert(
    g.board.edges
      .filter((e) => e.owner !== null)
      .every((e) => e.kind !== "ship"),
  );
}
