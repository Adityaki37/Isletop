import { Board, Resource, TileLayout, assembleTiles } from "./board";

// Fixed Lakes layout; lake tiles separate the surrounding land regions.
// Its twelve visible ports differ from the nine-port store description.
// This is a preview transcription, not a claim about private map generation.
export function makeLakesBoard(): Board {
  const W = "wood",
    B = "brick",
    S = "sheep",
    G = "wheat",
    O = "ore",
    D = "desert",
    E = "sea";
  const rows: [TileLayout["resource"], number][][] = [
    [
      [W, 10],
      [W, 11],
      [O, 4],
      [W, 9],
      [S, 5],
      [S, 10],
    ],
    [
      [B, 5],
      [O, 8],
      [E, 0],
      [B, 2],
      [E, 0],
      [W, 6],
      [G, 9],
    ],
    [
      [W, 6],
      [S, 11],
      [E, 0],
      [S, 5],
      [S, 11],
      [E, 0],
      [O, 3],
      [O, 8],
    ],
    [
      [E, 0],
      [S, 4],
      [O, 10],
      [D, 0],
      [B, 4],
      [O, 10],
      [E, 0],
    ],
    [
      [G, 8],
      [G, 9],
      [E, 0],
      [O, 3],
      [O, 9],
      [E, 0],
      [G, 5],
      [S, 6],
    ],
    [
      [S, 3],
      [S, 6],
      [E, 0],
      [W, 12],
      [E, 0],
      [G, 8],
      [G, 11],
    ],
    [
      [S, 4],
      [S, 9],
      [W, 10],
      [W, 5],
      [S, 3],
      [B, 4],
    ],
  ];
  const starts = [-1, -2, -3, -3, -4, -4, -4];
  const layout = rows.flatMap((row, i) =>
    row.map(([resource, number], j) => ({
      q: starts[i] + j,
      r: i - 3,
      resource,
      number,
    })),
  );
  const { tiles, vertices, edges } = assembleTiles(layout);
  const anchors: [number, number, number, Resource | "any"][] = [
    [1, -3, 5, "any"],
    [-1, -2, 0, O],
    [-2, -1, 0, W],
    [3, -2, 3, "any"],
    [3, -1, 3, S],
    [-2, 0, 3, "any"],
    [2, 0, 0, B],
    [-1, 1, 3, G],
    [-3, 2, 0, O],
    [0, 1, 0, B],
    [1, 2, 3, "any"],
    [-2, 3, 1, W],
  ];
  const ports = anchors.map(([q, r, side, resource]) => {
    const tile = tiles.find((t) => t.q === q && t.r === r)!;
    const a = tile.vertices[side],
      b = tile.vertices[(side + 1) % 6];
    return {
      resource,
      edge: edges.find((e) => [e.a, e.b].includes(a) && [e.a, e.b].includes(b))!
        .id,
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
