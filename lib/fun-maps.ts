import { assembleTiles } from "./board";
import type { Board, Resource, TileLayout } from "./board";

export type FixedFunMap = "diamond" | "pond" | "gear" | "twirl";
export const FIXED_FUN_MAPS = {
  diamond: {
    name: "Harbor Meadow",
    land: 24,
    // The current preview shows ten; the store description says nine.
    ports: 10,
    lakes: 1,
    maxPlayers: 4,
    preview: "/art/map_diamond_preview.svg",
  },
  pond: {
    name: "Inland Basin",
    land: 24,
    ports: 8,
    lakes: 1,
    maxPlayers: 4,
    preview: "/art/map_pond_preview.svg",
  },
  gear: {
    name: "Lake District",
    land: 43,
    ports: 14,
    lakes: 4,
    maxPlayers: 8,
    preview: "/art/map_gear_preview.svg",
  },
  twirl: {
    name: "Wide Basin",
    land: 42,
    ports: 12,
    lakes: 1,
    maxPlayers: 8,
    preview: "/art/map_twirl_preview.svg",
  },
} as const;
export function isFixedFunMap(map: unknown): map is FixedFunMap {
  return typeof map === "string" && Object.hasOwn(FIXED_FUN_MAPS, map);
}
const W = "wood",
  B = "brick",
  S = "sheep",
  G = "wheat",
  O = "ore",
  D = "desert",
  E = "sea";
type Cell = [TileLayout["resource"], number];
export type MapPortAnchor = [number, number, number, Resource | "any"];
type Anchor = MapPortAnchor;
type Plan = { layout: TileLayout[]; anchors: Anchor[] };
const rowsLayout = (
  rows: Cell[][],
  starts: number[],
  firstRow: number,
): TileLayout[] =>
  rows.flatMap((row, i) =>
    row.map(([resource, number], j) => ({
      q: starts[i] + j,
      r: firstRow + i,
      resource,
      number,
    })),
  );

// Fixed map plans contain terrain and tokens; player pieces are placed during play.
function diamond(): Plan {
  return {
    layout: rowsLayout(
      [
        [
          [B, 8],
          [W, 3],
          [O, 11],
          [W, 5],
          [W, 6],
        ],
        [
          [G, 8],
          [O, 4],
          [B, 3],
          [S, 8],
          [W, 10],
        ],
        [
          [S, 10],
          [G, 6],
          [E, 0],
          [D, 0],
          [W, 9],
        ],
        [
          [S, 9],
          [O, 2],
          [G, 5],
          [B, 11],
          [W, 12],
        ],
        [
          [G, 2],
          [S, 4],
          [W, 5],
          [G, 6],
          [B, 3],
        ],
      ],
      [-2, -2, -2, -2, -2],
      -2,
    ),
    anchors: [
      [0, -2, 4, "any"],
      [1, -2, 5, "any"],
      [2, -1, 5, S],
      [-2, -1, 3, B],
      [1, 0, 3, W],
      [2, 0, 0, "any"],
      [-2, 0, 2, G],
      [-2, 2, 2, B],
      [-1, 2, 1, "any"],
      [1, 2, 1, "any"],
    ],
  };
}
function pond(): Plan {
  return {
    layout: rowsLayout(
      [
        [
          [B, 3],
          [D, 0],
          [B, 5],
          [O, 5],
          [B, 2],
          [W, 6],
        ],
        [
          [W, 11],
          [S, 8],
          [E, 0],
          [W, 10],
          [G, 9],
        ],
        [
          [W, 3],
          [W, 4],
          [E, 0],
          [E, 0],
          [G, 8],
          [B, 4],
        ],
        [
          [S, 11],
          [B, 3],
          [E, 0],
          [O, 5],
          [W, 10],
        ],
        [
          [G, 6],
          [S, 12],
          [S, 6],
          [B, 2],
          [O, 9],
          [B, 5],
        ],
      ],
      [0, 0, -1, -1, -2],
      0,
    ),
    anchors: [
      [0, 0, 2, S],
      [3, 0, 2, W],
      [5, 0, 1, O],
      [0, 2, 0, W],
      [3, 2, 3, G],
      [-1, 2, 2, O],
      [4, 2, 1, W],
      [1, 4, 4, B],
    ],
  };
}
function gear(): Plan {
  const rows: [number, TileLayout["resource"], number][][] = [
    [
      [0, G, 2],
      [2, S, 6],
      [4, G, 3],
    ],
    [
      [-1, B, 5],
      [0, O, 10],
      [1, O, 9],
      [2, B, 12],
      [3, W, 11],
      [4, G, 4],
    ],
    [
      [-1, G, 8],
      [0, E, 0],
      [1, O, 4],
      [2, E, 0],
      [3, S, 8],
    ],
    [
      [-3, W, 4],
      [-2, B, 3],
      [-1, E, 0],
      [0, O, 8],
      [1, B, 10],
      [2, E, 0],
      [3, B, 10],
      [4, G, 8],
    ],
    [
      [-3, W, 6],
      [-2, G, 11],
      [-1, W, 3],
      [0, D, 0],
      [1, S, 5],
      [2, B, 9],
      [3, G, 9],
    ],
    [
      [-4, B, 11],
      [-3, W, 2],
      [-2, E, 0],
      [-1, B, 6],
      [0, G, 2],
      [1, E, 0],
      [2, S, 4],
      [3, G, 10],
    ],
    [
      [-3, G, 5],
      [-2, E, 0],
      [-1, S, 12],
      [0, E, 0],
      [1, S, 5],
    ],
    [
      [-4, S, 3],
      [-3, W, 5],
      [-2, S, 11],
      [-1, G, 3],
      [0, S, 6],
      [1, S, 9],
    ],
    [
      [-4, B, 6],
      [-2, O, 5],
      [0, W, 4],
    ],
  ];
  return {
    layout: rows.flatMap((row, r) =>
      row.map(([q, resource, number]) => ({ q, r, resource, number })),
    ),
    anchors: [
      [0, 0, 3, W],
      [4, 0, 0, B],
      [-3, 3, 4, S],
      [4, 3, 5, G],
      [0, 3, 3, O],
      [1, 3, 0, W],
      [-4, 5, 4, W],
      [3, 5, 5, S],
      [-1, 5, 3, "any"],
      [0, 5, 0, B],
      [-4, 5, 2, "any"],
      [3, 5, 1, G],
      [-4, 8, 3, W],
      [0, 8, 0, S],
    ],
  };
}
function twirl(): Plan {
  const rows: [number, TileLayout["resource"], number][][] = [
    [[0, G, 5]],
    [
      [-1, G, 2],
      [0, W, 6],
      [1, S, 3],
      [2, W, 9],
      [3, G, 10],
      [4, W, 9],
    ],
    [
      [-4, B, 12],
      [-2, G, 11],
      [-1, S, 4],
      [0, W, 5],
      [1, O, 2],
      [2, B, 6],
    ],
    [
      [-4, G, 3],
      [-3, O, 8],
      [-2, S, 10],
      [-1, D, 0],
      [0, E, 0],
      [1, W, 9],
      [2, S, 12],
    ],
    [
      [-4, W, 11],
      [-3, S, 4],
      [-2, E, 0],
      [-1, E, 0],
      [0, D, 0],
      [1, O, 5],
      [2, G, 2],
    ],
    [
      [-4, W, 6],
      [-3, B, 3],
      [-2, D, 0],
      [-1, E, 0],
      [0, G, 8],
      [1, O, 10],
      [2, O, 9],
    ],
    [
      [-4, O, 12],
      [-3, B, 11],
      [-2, G, 4],
      [-1, S, 5],
      [0, B, 2],
    ],
    [
      [-5, W, 6],
      [-4, O, 3],
      [-3, B, 8],
      [-2, S, 10],
      [-1, B, 8],
    ],
    [[-2, B, 11]],
    [[-3, S, 11]],
  ];
  return {
    layout: rows.flatMap((row, r) =>
      row.map(([q, resource, number]) => ({ q, r, resource, number })),
    ),
    anchors: [
      [0, 0, 5, W],
      [-4, 2, 5, B],
      [-4, 2, 2, G],
      [3, 1, 5, S],
      [4, 1, 1, S],
      [-1, 3, 2, "any"],
      [1, 3, 3, S],
      [-2, 5, 0, "any"],
      [-5, 7, 3, S],
      [2, 5, 1, B],
      [-3, 9, 3, B],
      [-3, 9, 0, B],
    ],
  };
}
export function makeFunBoard(map: FixedFunMap): Board {
  const { layout, anchors } = { diamond, pond, gear, twirl }[map]();
  return makeFixedMapBoard(layout, anchors);
}
export function makeFixedMapBoard(
  layout: TileLayout[],
  anchors: MapPortAnchor[],
): Board {
  const { tiles, vertices, edges } = assembleTiles(layout);
  const ports = anchors.map(([q, r, side, resource]) => {
    const tile = tiles.find((t) => t.q === q && t.r === r)!;
    const a = tile.vertices[side],
      b = tile.vertices[(side + 1) % 6];
    return {
      resource,
      edge: edges.find(
        (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a),
      )!.id,
    };
  });
  const minX = Math.min(...vertices.map((v) => v.x)) - 100;
  const minY = Math.min(...vertices.map((v) => v.y)) - 100;
  for (const point of [...vertices, ...tiles]) {
    point.x -= minX;
    point.y -= minY;
  }
  return {
    tiles,
    vertices,
    edges,
    ports,
    robber: tiles.find((t) => t.resource === D)!.id,
    width: Math.max(...vertices.map((v) => v.x)) + 100,
    height: Math.max(...vertices.map((v) => v.y)) + 100,
  };
}
