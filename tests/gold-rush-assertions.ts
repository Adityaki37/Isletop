import assert from "node:assert/strict";
import type { Game, View } from "../lib/game";
import { RESOURCES } from "../lib/board";

export function assertGoldRushProjection(g: View) {
  assert(!("fogDeck" in g) && !("fogNumbers" in g));
  if (g.map !== "goldRush") return;
  assert.equal(g.board.tiles.length, 31);
  assert(
    g.board.tiles
      .filter((t) => t.fog)
      .every((t) => t.resource === "sea" && t.number === 0),
  );
  assert.equal(g.board.pirate, undefined);
  assert.equal(
    g.goldAmount,
    g.me < 0
      ? 0
      : Math.min(
          g.goldClaims[g.me] ?? 0,
          RESOURCES.reduce((a, r) => a + (g.bank?.[r] ?? 0), 0),
        ),
  );
}
// Read-only conservation assertions; no hidden order is used to select actions.
export function assertGoldRushInventory(g: Game) {
  if (g.map !== "goldRush") return;
  assert.equal(g.board.tiles.length, 31);
  const fog = g.board.tiles.filter((t) => t.fog);
  assert.equal(fog.length, g.fogDeck.length);
  assert.equal(g.fogDeck.length, g.fogNumbers.length);
  assert.equal(
    g.fogDeck.filter((r) => r === "gold").length +
      g.board.tiles.filter((t) => t.resource === "gold").length,
    1,
  );
  assert(fog.every((t) => t.resource === "sea" && t.number === 0));
  assert(
    g.board.tiles
      .filter((t) => !t.fog && t.resource !== "desert")
      .every((t) => t.number >= 2 && t.number <= 12 && t.number !== 7),
  );
  assert(g.players.every((p) => p.islandBonus === 0));
  assert(
    g.board.edges
      .filter((e) => e.owner !== null)
      .every((e) => e.kind !== "ship"),
  );
}
