import type { View } from "./game";

// Read only the public final board and revealed scores; never expose hidden
// development points through an in-progress results view.
export function victoryPointBreakdown(game: View, seat: number) {
  const buildings = game.board.vertices.filter((v) => v.owner === seat);
  const cities = game.cities;
  return {
    settlements: buildings.filter((v) => !v.city).length,
    cities: buildings.filter((v) => v.city).length * 2,
    victoryCards: game.phase === "finished"
      ? Math.max(0, game.players[seat].score - game.players[seat].publicScore)
      : 0,
    longestRoad: game.longest === seat ? 2 : 0,
    largestArmy: game.army === seat ? 2 : 0,
    islands: game.players[seat].islandBonus ?? 0,
    defenders: cities?.players[seat].defenders ?? 0,
    progressPoints: cities?.players[seat].revealed.length ?? 0,
    metropolises: cities
      ? Object.values(cities.metropolises).filter((m) => m?.owner === seat).length * 2
      : 0,
    merchant: cities?.merchant?.owner === seat ? 1 : 0,
  };
}
