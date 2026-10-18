import { Tile, shuffle, secureRandom } from "./board";
import { goldRushContents } from "./gold-rush";
import { blackForestContents } from "./black-forest";
export function explorationContents(g: {
  map: string;
  scenario: string;
  capacity: number;
}) {
  return g.map === "goldRush"
    ? goldRushContents()
    : g.map === "blackForest"
      ? blackForestContents()
      : g.scenario === "fogIslands"
        ? fogContents(g.capacity)
        : { fogDeck: [], fogNumbers: [] };
}
// Component pools support the 24/27/39-land scenario layouts.
// Future terrain and tokens are drawn independently, and stay server-private.
export function fogContents(players: number, rng = secureRandom) {
  const counts: [Tile["resource"], number][] =
    players > 4
      ? [
          ["sea", 12],
          ["gold", 1],
          ["wheat", 2],
          ["brick", 2],
          ["ore", 2],
          ["sheep", 3],
          ["wood", 3],
        ]
      : [
          ["sea", 2],
          ["gold", 2],
          ["wheat", 2],
          ["brick", 2],
          ["ore", 2],
          ["sheep", 1],
          ["wood", 1],
        ];
  const numbers =
    players > 4
      ? [2, 2, 3, 4, 5, 5, 6, 8, 9, 9, 10, 11, 12]
      : players === 3
        ? [3, 3, 4, 5, 6, 8, 9, 10, 11, 12]
        : [3, 4, 5, 6, 8, 9, 10, 11, 11, 12];
  return {
    fogDeck: shuffle(
      counts.flatMap(([r, n]) => Array<Tile["resource"]>(n).fill(r)),
      rng,
    ),
    fogNumbers: shuffle(numbers, rng),
  };
}
