import {
  Board,
  Edge,
  Resource,
  TileLayout,
  assembleTiles,
  secureRandom,
} from "./board";
import { randomizeScenarioBoard } from "./board-randomization";
import { SeafarersScenario } from "./scenarios";
import { makeScenarioBoard } from "./seafarers-maps";

const W = "wood",
  B = "brick",
  S = "sheep",
  G = "wheat",
  O = "ore",
  D = "desert",
  A = "gold";
type Cell = [TileLayout["resource"], number];

// Open Sea layouts for three, four, and six seats. The sea surrounds
// the main island and separates the outlying islands.
export function makeSeafarersBoard(
  players: number,
  scenario: SeafarersScenario = "newShores",
  rng = secureRandom,
): Board {
  if (scenario !== "newShores")
    return randomizeScenarioBoard(makeScenarioBoard(players, scenario), rng);
  const layout: TileLayout[] = [];
  const main: Cell[][] =
    players === 3
      ? [
          [
            [S, 5],
            [G, 6],
            [B, 4],
          ],
          [
            [S, 6],
            [O, 10],
            [W, 2],
            [G, 10],
          ],
          [
            [S, 11],
            [W, 5],
            [B, 3],
            [S, 8],
          ],
          [
            [O, 8],
            [G, 9],
            [W, 11],
          ],
        ]
      : players <= 4
        ? [
            [
              [S, 5],
              [B, 8],
              [W, 4],
            ],
            [
              [G, 2],
              [W, 10],
              [W, 3],
              [S, 11],
            ],
            [
              [D, 0],
              [B, 9],
              [S, 11],
              [B, 6],
              [O, 12],
            ],
            [
              [O, 6],
              [G, 4],
              [S, 5],
              [O, 9],
            ],
            [
              [G, 3],
              [G, 8],
              [W, 10],
            ],
          ]
        : [
            [
              [G, 4],
              [S, 5],
              [S, 2],
            ],
            [
              [G, 6],
              [W, 10],
              [B, 8],
              [D, 0],
            ],
            [
              [G, 3],
              [W, 11],
              [S, 12],
              [G, 9],
              [S, 4],
            ],
            [
              [W, 9],
              [G, 12],
              [B, 3],
              [O, 6],
              [O, 5],
              [W, 8],
            ],
            [
              [B, 8],
              [B, 10],
              [B, 2],
              [S, 9],
              [D, 0],
            ],
            [
              [G, 11],
              [O, 5],
              [W, 4],
              [S, 3],
            ],
            [
              [O, 11],
              [W, 10],
              [O, 6],
            ],
          ];
  const firstR = players <= 4 ? -2 : -3;
  const starts =
    players === 3
      ? [0, -1, -2, -2]
      : players <= 4
        ? [0, -1, -2, -2, -2]
        : [1, 0, -1, -2, -2, -2, -2];
  main.forEach((row, i) =>
    row.forEach(([resource, number], j) =>
      layout.push({
        q: starts[i] + j,
        r: firstR + i,
        resource,
        number,
        home: true,
      }),
    ),
  );
  const outlying: [number, number, Cell][] =
    players === 3
      ? [
          [4, -3, [A, 12]],
          [4, -2, [B, 10]],
          [3, 0, [A, 4]],
          [2, 1, [G, 3]],
          [3, 1, [S, 5]],
          [1, 2, [O, 8]],
          [-2, 3, [O, 9]],
          [-1, 3, [B, 4]],
        ]
      : players <= 4
        ? [
            [4, -3, [A, 11]],
            [4, -2, [O, 6]],
            [4, 0, [G, 10]],
            [3, 1, [S, 2]],
            [2, 2, [O, 8]],
            [3, 2, [A, 5]],
            [1, 3, [B, 3]],
            [-2, 4, [B, 9]],
            [-1, 4, [W, 4]],
          ]
        : [
            [-1, -3, [G, 10]],
            [-2, -2, [B, 3]],
            [-3, -1, [O, 8]],
            [-4, 1, [B, 5]],
            [-4, 2, [A, 4]],
            [-4, 3, [A, 12]],
            [5, -3, [O, 9]],
            [5, -1, [W, 2]],
            [4, 1, [A, 6]],
            [2, 3, [S, 11]],
          ];
  outlying.forEach(([q, r, [resource, number]]) =>
    layout.push({ q, r, resource, number, home: false }),
  );
  const rows: [number, number, number][] =
    players === 3
      ? [
          [-3, 1, 4],
          [-2, 0, 4],
          [-1, -1, 4],
          [0, -2, 4],
          [1, -2, 3],
          [2, -2, 2],
          [3, -2, 1],
        ]
      : players <= 4
        ? [
            [-3, 1, 4],
            [-2, 0, 4],
            [-1, -1, 4],
            [0, -2, 4],
            [1, -2, 4],
            [2, -2, 3],
            [3, -2, 2],
            [4, -2, 1],
          ]
        : [
            [-3, -1, 5],
            [-2, -2, 4],
            [-1, -3, 5],
            [0, -4, 5],
            [1, -4, 4],
            [2, -4, 3],
            [3, -4, 2],
          ];
  for (const [r, min, max] of rows)
    for (let q = min; q <= max; q++)
      if (!layout.some((t) => t.q === q && t.r === r))
        layout.push({ q, r, resource: "sea", number: 0 });
  const { tiles, vertices, edges } = assembleTiles(layout);
  let island = 0;
  for (const tile of tiles) {
    if (tile.resource === "sea" || tile.island !== undefined) continue;
    const queue = [tile.id];
    tile.island = island;
    while (queue.length) {
      const id = queue.shift()!;
      for (const edge of edges.filter((e) => e.tiles.includes(id)))
        for (const neighbor of edge.tiles) {
          const t = tiles[neighbor];
          if (t.resource !== "sea" && t.island === undefined) {
            t.island = island;
            queue.push(neighbor);
          }
        }
    }
    island++;
  }
  const anchors: [number, number, number, Resource | "any"][] =
    players === 3
      ? [
          [0, -2, 3, "any"],
          [0, -2, 5, O],
          [1, -2, 5, G],
          [2, -1, 1, B],
          [1, 0, 1, "any"],
          [-1, 1, 2, "any"],
          [-2, 1, 3, W],
          [-2, 0, 4, S],
        ]
      : players <= 4
        ? [
            [0, -2, 4, O],
            [1, -2, 5, W],
            [2, -2, 0, "any"],
            [2, 0, 0, S],
            [0, 2, 0, B],
            [-1, 2, 1, "any"],
            [-2, 2, 2, "any"],
            [-2, 1, 3, G],
            [-1, -1, 4, "any"],
          ]
        : [
            [1, -3, 4, "any"],
            [2, -3, 5, "any"],
            [3, -3, 0, "any"],
            [3, -1, 0, S],
            [3, 0, 1, G],
            [1, 2, 1, S],
            [0, 3, 1, W],
            [-1, 3, 2, B],
            [-2, 3, 3, "any"],
            [-2, 1, 3, "any"],
            [-1, -1, 4, O],
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
  const minX = Math.min(...vertices.map((v) => v.x)) - 85,
    minY = Math.min(...vertices.map((v) => v.y)) - 85;
  [...vertices, ...tiles].forEach((v) => {
    v.x -= minX;
    v.y -= minY;
  });
  const pirate =
    players > 4
      ? tiles.find((t) => t.q === -4 && t.r === 0)!.id
      : tiles.find((t) => t.q === 1 && t.r === (players === 3 ? 3 : 4))!.id;
  return randomizeScenarioBoard(
    {
      tiles,
      vertices,
      edges,
      ports,
      robber:
        tiles.find((t) => t.resource === "desert")?.id ??
        tiles.find((t) => t.resource === "gold" && t.number === 12)!.id,
      pirate,
      width: Math.max(...vertices.map((v) => v.x)) + 85,
      height: Math.max(...vertices.map((v) => v.y)) + 85,
    },
    rng,
  );
}

export function routeKind(edge: Edge) {
  return edge.kind ?? "road";
}
export function hasLand(board: Board, vertex: number) {
  return board.vertices[vertex].tiles.some(
    (id) => board.tiles[id].resource !== "sea",
  );
}
export function shipBlocked(board: Board, edge: Edge) {
  return board.pirate != null && edge.tiles.includes(board.pirate);
}
export function legalRoutes(
  board: Board,
  p: number,
  kind: "road" | "ship",
  setupVertex: number | null,
  ignore?: number,
  blocked: (vertex: number) => boolean = () => false,
) {
  return board.edges
    .filter(
      (e) =>
        e.id !== ignore &&
        (e.owner === null || e.id === ignore) &&
        (kind === "road"
          ? e.tiles.some((id) => board.tiles[id].resource !== "sea")
          : !shipBlocked(board, e) &&
            (e.tiles.length === 1 ||
              e.tiles.some((id) => board.tiles[id].resource === "sea"))) &&
        (setupVertex !== null
          ? [e.a, e.b].includes(setupVertex)
          : [e.a, e.b].some((id) => {
              if (blocked(id)) return false;
              const v = board.vertices[id];
              return (
                v.owner === p ||
                (v.owner === null &&
                  v.edges.some(
                    (eid) =>
                      eid !== ignore &&
                      board.edges[eid].owner === p &&
                      routeKind(board.edges[eid]) === kind,
                  ))
              );
            })),
    )
    .map((e) => e.id);
}
export function movableShips(
  board: Board,
  p: number,
  turn: number,
  knights: number[] = [],
  ignoreRestrictions = false,
) {
  const ships = board.edges.filter(
    (e) => e.owner === p && routeKind(e) === "ship",
  );
  const incident = (id: number) =>
    board.vertices[id].edges.filter((eid) => ships.some((e) => e.id === eid));
  const closed = new Set<number>();
  const anchors = new Set([
    ...board.vertices.filter((v) => v.owner === p).map((v) => v.id),
    ...knights,
  ]);
  // Opposing buildings cut the scoring route but do not reopen an established
  // shipping connection between two of this player's settlements.
  for (const anchor of board.vertices.filter((v) => anchors.has(v.id))) {
    const visit = (id: number, seen: Set<number>, path: number[]) => {
      if (id !== anchor.id && anchors.has(id)) {
        path.forEach((e) => closed.add(e));
        return;
      }
      for (const eid of incident(id)) {
        const e = board.edges[eid],
          next = e.a === id ? e.b : e.a;
        if (!seen.has(next))
          visit(next, new Set([...seen, next]), [...path, eid]);
      }
    };
    visit(anchor.id, new Set([anchor.id]), []);
  }
  return ships
    .filter(
      (e) =>
        (ignoreRestrictions || (e.built !== turn && !shipBlocked(board, e))) &&
        keepsKnightConnections(board, p, knights, e.id) &&
        !closed.has(e.id) &&
        ([e.a, e.b].some(
          (id) => !anchors.has(id) && incident(id).length === 1,
        ) ||
          // The official loop exceptions: a loop without buildings has movable
          // ships; a loop returning to one settlement may move either bordering ship.
          (() => {
            const seen = new Set<number>();
            const reaches = (id: number): boolean => {
              if (id === e.b) return true;
              if (seen.has(id) || (id !== e.a && anchors.has(id))) return false;
              seen.add(id);
              return incident(id).some(
                (eid) =>
                  eid !== e.id &&
                  reaches(
                    board.edges[eid].a === id
                      ? board.edges[eid].b
                      : board.edges[eid].a,
                  ),
              );
            };
            return reaches(e.a);
          })()),
    )
    .map((e) => e.id);
}

// Protect a knight on another island even when its connection includes roads
// between the coast and the knight. Removing a redundant branch remains legal.
export function keepsKnightConnections(
  board: Board,
  p: number,
  knights: number[],
  ignore: number,
) {
  const connected = (source: number, omit: number | null) => {
    const queue = [source],
      seen = new Set<number>();
    while (queue.length) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const v = board.vertices[id];
      if (v.owner === p) return true;
      for (const eid of v.edges) {
        const e = board.edges[eid];
        if (eid !== omit && e.owner === p) queue.push(e.a === id ? e.b : e.a);
      }
    }
    return false;
  };
  return knights.every((id) => !connected(id, null) || connected(id, ignore));
}
