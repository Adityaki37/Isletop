import { shuffle, secureRandom, type TileLayout } from "./board";
import { makeFixedMapBoard, type MapPortAnchor } from "./fun-maps";

export const BLACK_FOREST_PREVIEW = "/art/map_blackforest_preview.svg";

// Original preview: 24 forests around six water tiles and a central desert,
// with 30 fog tiles outside. Sample player pieces are not starting pieces.
export function makeBlackForestBoard(rng = secureRandom) {
  const rows = [
    [0, 0, 0, 0, 0],
    [0, 0, 10, 6, 0, 0],
    [0, 8, 5, 9, 11, 6, 0],
    [0, 4, 9, -1, -1, 5, 4, 0],
    [0, 0, 8, -1, -2, -1, 8, 0, 0],
    [0, 12, 9, -1, -1, 10, 4, 0],
    [0, 6, 2, 3, 5, 6, 0],
    [0, 0, 5, 8, 0, 0],
    [0, 0, 0, 0, 0],
  ];
  const layout: TileLayout[] = rows.flatMap((row, i) =>
    row.map((n, j) => ({
      q: Math.max(-4, -i) + j,
      r: i - 4,
      resource: n > 0 ? "wood" : n === -2 ? "desert" : "sea",
      number: Math.max(0, n),
      home: n > 0,
      ...(n === 0 ? { fog: true } : {}),
    })),
  );
  const anchors: MapPortAnchor[] = [
    [0, -2, 1, "wood"],
    [2, -2, 2, "wood"],
    [-2, 0, 0, "wood"],
    [2, 0, 3, "wood"],
    [-2, 2, 5, "wood"],
    [0, 2, 4, "wood"],
  ];
  const board = makeFixedMapBoard(layout, anchors);
  const forests = board.tiles.filter((t) => t.home);
  const red = shuffle(
    forests.map((t) => t.number).filter((n) => n === 6 || n === 8),
    rng,
  );
  const other = shuffle(
    forests.map((t) => t.number).filter((n) => n !== 6 && n !== 8),
    rng,
  );
  const neighbors = new Map(forests.map((t) => [t.id, new Set<number>()]));
  for (const edge of board.edges)
    if (edge.tiles.length === 2) {
      const [a, b] = edge.tiles;
      neighbors.get(a)?.add(b);
      neighbors.get(b)?.add(a);
    }
  function spaced(candidates: number[], selected: number[]): number[] | null {
    if (selected.length === red.length) return selected;
    if (candidates.length < red.length - selected.length) return null;
    const [first, ...rest] = candidates;
    if (first === undefined) return null;
    return (
      spaced(
        rest.filter((id) => !neighbors.get(first)!.has(id)),
        [...selected, first],
      ) ?? spaced(rest, selected)
    );
  }
  const selected = new Set(
    spaced(
      shuffle(
        forests.map((t) => t.id),
        rng,
      ),
      [],
    )!,
  );
  for (const tile of forests)
    tile.number = selected.has(tile.id) ? red.pop()! : other.pop()!;
  return board;
}

// Hidden terrain and token pools are shuffled independently for each game.
export function blackForestContents(rng = secureRandom) {
  return {
    fogDeck: shuffle(
      (
        [
          ["brick", 9],
          ["sheep", 8],
          ["wheat", 7],
          ["ore", 6],
        ] as const
      ).flatMap(([resource, n]) =>
        Array<TileLayout["resource"]>(n).fill(resource),
      ),
      rng,
    ),
    fogNumbers: shuffle(
      [
        3,
        ...Array<number>(4).fill(4),
        ...Array<number>(5).fill(5),
        ...Array<number>(5).fill(6),
        ...Array<number>(5).fill(8),
        ...Array<number>(5).fill(9),
        ...Array<number>(4).fill(10),
        11,
      ],
      rng,
    ),
  };
}
