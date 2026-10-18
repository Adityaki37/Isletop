import type { Board, Resource } from "./board";
import { CITY_COMMODITY, GOODS, type Good } from "./cities-knights";

export type ResourceTransfer = { seat: number; good: Good; amount: number; tile: number | null };
export type ProductionFeedback = { sequence: number; roll: number | null; source: string; transfers: ResourceTransfer[] };

// Allocate only cards actually paid. Public board sources never reveal a hand.
export function productionTransfers(board: Board, cities: boolean, sum: number,
  received: Partial<Record<Good, number>>[]): ResourceTransfer[] {
  const remaining = received.map((hand) => ({ ...hand }));
  const transfers: ResourceTransfer[] = [];
  for (const tile of board.tiles) {
    if (tile.fog || tile.number !== sum || tile.id === board.robber ||
      !["wood", "brick", "sheep", "wheat", "ore"].includes(tile.resource)) continue;
    const resource = tile.resource as Resource;
    for (const id of tile.vertices) {
      const vertex = board.vertices[id];
      if (vertex.owner === null) continue;
      const commodity = cities && vertex.city ? CITY_COMMODITY[resource] : undefined;
      const demand: Partial<Record<Good, number>> = { [resource]: vertex.city && !commodity ? 2 : 1 };
      if (commodity) demand[commodity] = 1;
      for (const good of GOODS) {
        const amount = Math.min(demand[good] ?? 0, remaining[vertex.owner]?.[good] ?? 0);
        if (amount > 0) {
          transfers.push({ seat: vertex.owner, good, amount, tile: tile.id });
          remaining[vertex.owner][good] = (remaining[vertex.owner][good] ?? 0) - amount;
        }
      }
    }
  }
  // Legacy/imported board fallback: exact payout from bank, no invented tile.
  remaining.forEach((hand, seat) => GOODS.forEach((good) => {
    if ((hand[good] ?? 0) > 0) transfers.push({ seat, good, amount: hand[good]!, tile: null });
  }));
  return transfers;
}
