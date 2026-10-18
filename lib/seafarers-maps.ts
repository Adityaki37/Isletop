import { Board, Resource, TileLayout, assembleTiles } from "./board";
import { SeafarersScenario } from "./scenarios";

type Preset = {
  rows: [number, number, string][];
  ports: [number, number, number, Resource | "any"][];
  robber: [number, number];
  pirate: [number, number];
};
const W = "wood",
  B = "brick",
  S = "sheep",
  G = "wheat",
  O = "ore",
  ANY = "any";
// Fog preview images depict some exploratory pieces; the already-discovered
// central brick hex in the four-player preview starts under fog in a new game.
const FOG: Preset[] = [
  {
    rows: [
      [-3, 0, ". . ? ?"],
      [-2, -1, ". S6 . ? ?"],
      [-1, -2, ". B5 W6 . ? ."],
      [0, -3, ". B3 S8 . ? . W8"],
      [1, -3, "O5 O9 . ? . G12 W10"],
      [2, -3, ". . ? . G9 S11"],
      [3, -3, "? ? . S4 W11"],
      [4, -3, "? ? . ."],
    ],
    ports: [
      [0, -2, 4, S],
      [-1, -1, 4, W],
      [-2, 0, 3, ANY],
      [-2, 1, 2, O],
      [3, 0, 0, ANY],
      [3, 1, 0, B],
      [1, 3, 0, G],
      [1, 3, 2, ANY],
    ],
    robber: [2, 1],
    pirate: [0, -3],
  },
  {
    rows: [
      [-3, 0, ". . ? ?"],
      [-2, -1, "W3 S8 . ? ."],
      [-1, -2, "B12 B11 . ? . B6"],
      [0, -3, "G5 O2 . ? . G6 W3"],
      [1, -3, "S9 . ? ? . S5 S8"],
      [2, -3, ". ? ? . W4 O4"],
      [3, -3, "? ? . W10 G9"],
      [4, -3, "? . O10 ."],
    ],
    ports: [
      [-1, -2, 4, S],
      [0, -2, 4, W],
      [-2, -1, 3, ANY],
      [-3, 0, 3, ANY],
      [-3, 1, 3, ANY],
      [3, -1, 0, O],
      [3, 0, 0, G],
      [3, 1, 1, ANY],
      [1, 3, 0, B],
      [-1, 4, 0, ANY],
    ],
    robber: [-2, -1],
    pirate: [0, -3],
  },
  {
    rows: [
      [-3, -2, "O4 O12 G9 B6 O11 S10 W5 B3"],
      [-2, -3, ". G10 B3 D G9 B10 S4 G2 ."],
      [-1, -4, "? . W8 W4 W12 S5 S11 O8 . ?"],
      [0, -5, ". ? . . B6 G3 O8 . . ? ."],
      [1, -5, "? ? ? . . . . ? ? ?"],
      [2, -5, "? ? ? ? ? ? ? ? ?"],
      [3, -5, "A6 ? ? ? ? ? ? A11"],
    ],
    ports: [
      [-2, -3, 5, ANY],
      [-1, -3, 5, W],
      [2, -3, 5, G],
      [4, -3, 5, S],
      [-2, -2, 3, ANY],
      [4, -2, 0, ANY],
      [-2, -1, 1, B],
      [2, -1, 1, O],
      [0, 0, 1, ANY],
    ],
    robber: [0, -2],
    pirate: [3, 0],
  },
];
// Fixed scenario positions and number tokens. A dot is sea;
// each row is [axial r, first axial q, cells].
const FOUR: Preset[] = [
  {
    rows: [
      [-3, 0, ". B4 G5 ."],
      [-2, -1, "B12 . S3 O8 ."],
      [-1, -2, "O6 S9 . . . O11"],
      [0, -3, "W9 O5 B10 . B6 S11 G8"],
      [1, -3, ". . . . W2 G10"],
      [2, -3, ". G4 S9 . ."],
      [3, -3, ". W5 W3 ."],
    ],
    ports: [
      [1, -3, 5, ANY],
      [-1, -2, 3, ANY],
      [-1, -2, 0, W],
      [2, -2, 2, S],
      [-2, 0, 2, G],
      [-2, 2, 5, ANY],
      [1, 1, 3, B],
      [3, 0, 1, ANY],
      [-2, 3, 1, O],
    ],
    robber: [-1, -2],
    pirate: [0, 0],
  },
  {
    rows: [
      [-3, 0, ". B11 W10 S8"],
      [-2, -1, "G9 . G4 . ."],
      [-1, -2, "B9 O3 . . B5 O6"],
      [0, -3, "O8 B12 . W5 W10 S11 O5"],
      [1, -3, "S4 S9 . . G2 S11"],
      [2, -3, ". . G3 . ."],
      [3, -3, "W10 G6 W4 ."],
    ],
    ports: [
      [2, -3, 4, G],
      [-1, -2, 3, B],
      [1, -2, 3, ANY],
      [-2, -1, 3, S],
      [0, 0, 5, ANY],
      [-2, 0, 0, ANY],
      [2, 1, 2, W],
      [-1, 3, 5, O],
      [-1, 3, 2, ANY],
    ],
    robber: [-2, 0],
    pirate: [0, 3],
  },
  {
    rows: [
      [-3, -2, "G11 S8 . O2 . G6 W3"],
      [-2, -3, "G9 O11 . B2 B5 . S10 B8"],
      [-1, -4, "G5 O10 . O12 S5 . . W12 ."],
      [0, -5, ". . . . . . . . . ."],
      [1, -5, ". W4 . . S10 B4 . G6 B4"],
      [2, -5, "G5 O9 . S9 O6 . W3 W3"],
      [3, -5, "S6 S9 . B10 . W4 W8"],
    ],
    ports: [
      [-2, -3, 5, O],
      [1, -3, 5, W],
      [4, -3, 5, ANY],
      [-3, -1, 0, G],
      [-4, -1, 1, ANY],
      [3, -1, 3, ANY],
      [-5, 2, 3, B],
      [-4, 2, 0, ANY],
      [-2, 3, 3, S],
      [3, 1, 1, B],
      [0, 3, 2, ANY],
    ],
    robber: [-1, 2],
    pirate: [-5, 0],
  },
];
const DESERT: Preset[] = [
  {
    rows: [
      [-3, 0, ". A9 S5 G5"],
      [-2, -1, "S9 . D D D"],
      [-1, -2, "O11 W10 W8 S5 G10 ."],
      [0, -3, "W9 O6 B2 B4 S8 . O6"],
      [1, -3, "B3 W4 G6 . . G4"],
      [2, -3, ". . . O8 ."],
      [3, -3, "A3 W11 . ."],
    ],
    ports: [
      [-1, -2, 3, O],
      [-1, -2, 0, G],
      [-2, -1, 3, S],
      [2, -1, 0, W],
      [-3, 0, 2, B],
      [-3, 1, 1, ANY],
      [-2, 1, 1, ANY],
      [-1, 1, 1, ANY],
      [1, 0, 2, ANY],
    ],
    robber: [2, -2],
    pirate: [0, 3],
  },
  {
    rows: [
      [-3, 0, ". G12 B10 G8"],
      [-2, -1, "B9 . D D D"],
      [-1, -2, "S10 W6 S4 O11 B10 O8"],
      [0, -3, ". G3 W11 W4 W5 B12 ."],
      [1, -3, "W6 S3 G8 S9 B5 . S5"],
      [2, -3, ". . . . . A11"],
      [3, -3, "G6 . O9 . O4"],
      [4, -3, "A3 . O2 ."],
    ],
    ports: [
      [-1, -2, 3, G],
      [-1, -1, 5, O],
      [-2, -1, 2, S],
      [3, -1, 1, B],
      [-3, 1, 3, ANY],
      [2, 0, 1, ANY],
      [-3, 1, 1, W],
      [-2, 1, 1, ANY],
      [0, 1, 1, ANY],
      [1, 1, 1, ANY],
    ],
    robber: [2, -2],
    pirate: [0, 4],
  },
  {
    rows: [
      [-3, -2, "A9 G8 S12 . S5 A4 O4 W11"],
      [-2, -3, "W8 W2 D D D D D . ."],
      [-1, -4, ". . . S4 B9 W9 O8 . . G3"],
      [0, -5, ". S6 B12 B8 W3 S12 S11 O10 . . ."],
      [1, -5, "G3 G10 O2 B5 B9 W5 O11 . . O2"],
      [2, -5, "G4 W10 . . . . . B6 S10"],
      [3, -5, "G6 . G11 A3 . O6 . B5"],
    ],
    ports: [
      [-3, -2, 2, ANY],
      [-1, -1, 3, B],
      [2, -1, 0, S],
      [-4, 0, 3, ANY],
      [1, 1, 0, ANY],
      [-5, 1, 2, G],
      [-2, 1, 2, ANY],
      [-1, 1, 2, ANY],
      [0, 1, 1, W],
      [-4, 2, 1, O],
      [-5, 3, 2, ANY],
    ],
    robber: [1, -2],
    pirate: [1, 3],
  },
];

export function makeScenarioBoard(
  players: number,
  scenario: Exclude<SeafarersScenario, "newShores">,
): Board {
  const preset = (
    scenario === "fogIslands" ? FOG : scenario === "fourIslands" ? FOUR : DESERT
  )[players === 3 ? 0 : players > 4 ? 2 : 1];
  const resources: Record<string, TileLayout["resource"]> = {
    W,
    B,
    S,
    G,
    O,
    D: "desert",
    A: "gold",
    ".": "sea",
    "?": "sea",
  };
  const layout: TileLayout[] = preset.rows.flatMap(([r, start, row]) =>
    row.split(" ").map((cell, i) => ({
      q: start + i,
      r,
      resource: resources[cell[0]],
      number: Number(cell.slice(1)) || 0,
      ...(cell === "?" ? { fog: true } : {}),
    })),
  );
  const { tiles, edges, vertices } = assembleTiles(layout);
  const qualifies = (id: number) =>
    tiles[id].resource !== "sea" &&
    (scenario !== "throughDesert" || tiles[id].resource !== "desert");
  let region = 0;
  for (const tile of tiles) {
    if (!qualifies(tile.id) || tile.island !== undefined) continue;
    tile.island = region;
    const pending = [tile.id];
    while (pending.length) {
      const id = pending.pop()!;
      for (const edge of edges.filter((e) => e.tiles.includes(id)))
        for (const neighbor of edge.tiles) {
          if (qualifies(neighbor) && tiles[neighbor].island === undefined) {
            tiles[neighbor].island = region;
            pending.push(neighbor);
          }
        }
    }
    region++;
  }
  const mainRegion = [...Array(region).keys()].sort(
    (a, b) =>
      tiles.filter((t) => t.island === b).length -
      tiles.filter((t) => t.island === a).length,
  )[0];
  tiles.forEach((t) => {
    if (t.resource !== "sea")
      t.home =
        scenario === "fogIslands"
          ? players <= 4 || t.resource !== "gold"
          : scenario === "fourIslands" || t.island === mainRegion;
  });
  const ports = preset.ports.map(([q, r, side, resource]) => {
    const t = tiles.find((t) => t.q === q && t.r === r)!;
    const a = t.vertices[side],
      b = t.vertices[(side + 1) % 6];
    return {
      resource,
      edge: edges.find((e) => [e.a, e.b].includes(a) && [e.a, e.b].includes(b))!
        .id,
    };
  });
  const minX = Math.min(...vertices.map((v) => v.x)) - 85,
    minY = Math.min(...vertices.map((v) => v.y)) - 85;
  [...vertices, ...tiles].forEach((v) => {
    v.x -= minX;
    v.y -= minY;
  });
  const at = ([q, r]: [number, number]) =>
    tiles.find((t) => t.q === q && t.r === r)!.id;
  return {
    tiles,
    vertices,
    edges,
    ports,
    robber: at(preset.robber),
    pirate: at(preset.pirate),
    width: Math.max(...vertices.map((v) => v.x)) + 85,
    height: Math.max(...vertices.map((v) => v.y)) + 85,
  };
}
