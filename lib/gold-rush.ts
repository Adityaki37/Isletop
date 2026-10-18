import { shuffle, secureRandom, type TileLayout } from "./board";
import { makeFixedMapBoard, type MapPortAnchor } from "./fun-maps";

export const GOLD_RUSH_PREVIEW = "/art/map_goldrush_preview.svg";
const W = "wood",
  B = "brick",
  S = "sheep",
  G = "wheat",
  O = "ore",
  D = "desert",
  F = "sea";
type Cell = [TileLayout["resource"], number];

// Starting terrain, number tokens, and seven hidden discovery positions.
export function makeGoldRushBoard() {
  const rows: Cell[][] = [
    [
      [S, 5],
      [W, 6],
    ],
    [
      [W, 5],
      [B, 6],
      [B, 3],
      [G, 12],
      [S, 5],
    ],
    [
      [O, 10],
      [D, 0],
      [F, 0],
      [F, 0],
      [O, 8],
      [B, 9],
    ],
    [
      [B, 4],
      [F, 0],
      [F, 0],
      [F, 0],
      [W, 11],
    ],
    [
      [B, 11],
      [G, 6],
      [F, 0],
      [F, 0],
      [S, 9],
      [W, 10],
    ],
    [
      [S, 9],
      [W, 4],
      [B, 10],
      [W, 11],
      [G, 8],
    ],
    [
      [W, 3],
      [B, 4],
    ],
  ];
  const starts = [1, -1, -2, -2, -3, -3, -2];
  const layout = rows.flatMap((row, i) =>
    row.map(([resource, number], j) => ({
      q: starts[i] + j,
      r: i - 3,
      resource,
      number,
      ...(resource === F ? { fog: true } : {}),
    })),
  );
  const anchors: MapPortAnchor[] = [
    [0, -2, 4, "any"],
    [2, -2, 5, "any"],
    [-2, -1, 2, S],
    [3, -1, 1, "any"],
    [-2, 3, 3, B],
    [-1, 3, 0, O],
  ];
  return makeFixedMapBoard(layout, anchors);
}

// The private discovery pool contains one gold tile and six resource tiles.
export function goldRushContents(rng = secureRandom) {
  return {
    fogDeck: shuffle(
      [O, O, O, G, G, G, "gold"] as TileLayout["resource"][],
      rng,
    ),
    fogNumbers: shuffle([3, 4, 5, 6, 8, 9, 10], rng),
  };
}
