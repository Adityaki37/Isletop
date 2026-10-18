export const RESOURCES = ["wood", "brick", "sheep", "wheat", "ore"] as const;
export type Resource = (typeof RESOURCES)[number];
export type Hand = Record<Resource, number>;
export const emptyHand = (): Hand => ({
  wood: 0,
  brick: 0,
  sheep: 0,
  wheat: 0,
  ore: 0,
});
export { COLORS } from "./player-colors";
export type Tile = {
  id: number;
  q: number;
  r: number;
  x: number;
  y: number;
  resource: Resource | "desert" | "sea" | "gold";
  number: number;
  vertices: number[];
  island?: number;
  home?: boolean;
  fog?: boolean;
};
export type Vertex = {
  id: number;
  x: number;
  y: number;
  tiles: number[];
  edges: number[];
  owner: number | null;
  city: boolean;
};
export type Edge = {
  id: number;
  a: number;
  b: number;
  tiles: number[];
  owner: number | null;
  kind?: "road" | "ship";
  built?: number;
};
export type Port = { edge: number; resource: Resource | "any" };
export type Board = {
  tiles: Tile[];
  vertices: Vertex[];
  edges: Edge[];
  ports: Port[];
  robber: number;
  pirate?: number | null;
  width: number;
  height: number;
};
export function secureRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}
export function shuffle<T>(a: T[], rng = secureRandom): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

// Harbor groups on the six sea-frame pieces.
// Offsets follow each five-edge piece clockwise.
// Keep these groups intact: the variable setup shuffles frames, not tokens.
const SEA_FRAMES: (Port["resource"] | null)[][] = [
  [null, null, "any", null, null],
  [null, null, "wood", null, null],
  [null, "sheep", null, null, "any"],
  [null, "brick", null, null, "any"],
  [null, null, "ore", null, null],
  [null, "wheat", null, null, "any"],
];

function seaFramePorts(
  coast: Edge[],
  landTiles: number,
  rng: () => number,
): Port[] {
  const frames = shuffle(SEA_FRAMES, rng);
  // The 5–6 extension shuffles four two-edge inserts between the large
  // frames: two empty, one generic and one wool harbor (2025, page 4).
  // Our larger islands extend this same scheme using their existing inventory.
  const insertTypes: (Port["resource"] | null)[] =
    landTiles === 19
      ? []
      : landTiles === 30
        ? [null, null, "any", "sheep"]
        : landTiles === 37
          ? [null, null, null, "any", "any", "sheep"]
          : [null, null, null, null, null, ...RESOURCES, "any", "any"];
  const inserts = shuffle(insertTypes, rng);
  const insertsPerSide =
    landTiles === 19
      ? [0, 0, 0, 0, 0, 0]
      : landTiles === 30
        ? [0, 1, 1, 0, 1, 1]
        : landTiles === 37
          ? [1, 1, 1, 1, 1, 1]
          : [2, 2, 2, 2, 2, 2];
  const slots: (Port["resource"] | null)[] = [];
  for (let side = 0; side < frames.length; side++) {
    slots.push(...frames[side]);
    for (let i = 0; i < insertsPerSide[side]; i++)
      slots.push(null, inserts.shift()!);
  }
  if (slots.length !== coast.length)
    throw new Error("Sea frame does not fit the island coast.");
  return slots.flatMap((resource, i) =>
    resource === null ? [] : [{ resource, edge: coast[i].id }],
  );
}

// Walk the actual coastal cycle. Sorting endpoint angles can misorder edges
// at the zigzags and attach a printed frame harbor to the wrong dock.
function orderedCoast(edges: Edge[], vertices: Vertex[]): Edge[] {
  const coast = edges.filter((e) => e.tiles.length === 1);
  const start = [...new Set(coast.flatMap((e) => [e.a, e.b]))].sort(
    (a, b) => vertices[a].y - vertices[b].y || vertices[a].x - vertices[b].x,
  )[0];
  const incident = new Map<number, Edge[]>();
  for (const e of coast)
    for (const v of [e.a, e.b])
      incident.set(v, [...(incident.get(v) ?? []), e]);
  const first = incident.get(start)!.sort((a, b) => {
    const av = vertices[a.a === start ? a.b : a.a],
      bv = vertices[b.a === start ? b.b : b.a];
    return bv.x - av.x;
  })[0];
  const ordered: Edge[] = [];
  let vertex = start,
    edge = first;
  do {
    ordered.push(edge);
    vertex = edge.a === vertex ? edge.b : edge.a;
    edge = incident.get(vertex)!.find((next) => next.id !== edge.id)!;
  } while (vertex !== start);
  if (ordered.length !== coast.length)
    throw new Error("Island coast must form one cycle.");
  return ordered;
}
export function makeBoard(players = 4, rng = secureRandom): Board {
  const coords: [number, number][] = [];
  const radius = players <= 4 ? 2 : players <= 8 ? 3 : 4;
  for (let r = -radius; r <= radius; r++)
    for (let q = -radius; q <= radius; q++)
      if (Math.abs(q + r) <= radius) coords.push([q, r]);
  // The five/six player island has 30 land tiles; seven/eight uses 37, and nine through twelve use 61.
  if (players > 4 && players <= 6)
    for (let r = -3; r <= 3; r++) {
      const last = coords
        .map((c, i) => (c[1] === r ? i : -1))
        .filter((i) => i >= 0)
        .pop()!;
      coords.splice(last, 1);
    }
  const n = coords.length;
  const counts =
    n === 19
      ? [4, 3, 4, 4, 3, 1]
      : n === 30
        ? [6, 5, 6, 6, 5, 2]
        : n === 37 ? [8, 6, 8, 7, 6, 2] : [13, 10, 13, 12, 10, 3];
  const types = shuffle(
    counts.flatMap((c, i) => Array(c).fill([...RESOURCES, "desert"][i])),
    rng,
  );
  const numbers =
    n === 19
      ? [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]
      : n === 30
        ? [
            2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10,
            10, 11, 11, 11, 12, 12,
          ]
        : [
            2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 8, 8, 8, 8, 9, 9,
            9, 9, 10, 10, 10, 10, 11, 11, 11, 12, 12, 12,
          ];
  if (n === 61) numbers.push(2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12, 4, 5, 6, 8, 9);
  const { tiles, vertices, edges } = assembleTiles(
    coords.map(([q, r], id) => ({ q, r, resource: types[id] })),
  );
  const red = shuffle(
    numbers.filter((n) => n === 6 || n === 8),
    rng,
  );
  const others = shuffle(
    numbers.filter((n) => n !== 6 && n !== 8),
    rng,
  );
  const neighbors = new Map<number, Set<number>>(
    tiles.map((t) => [t.id, new Set<number>()]),
  );
  edges
    .filter((e) => e.tiles.length === 2)
    .forEach((e) => {
      neighbors.get(e.tiles[0])!.add(e.tiles[1]);
      neighbors.get(e.tiles[1])!.add(e.tiles[0]);
    });
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
  const redTiles = new Set(
    spaced(
      shuffle(
        tiles.filter((t) => t.resource !== "desert").map((t) => t.id),
        rng,
      ),
      [],
    )!,
  );
  tiles.forEach(
    (t) =>
      (t.number =
        t.resource === "desert"
          ? 0
          : redTiles.has(t.id)
            ? red.pop()!
            : others.pop()!),
  );
  const minX = Math.min(...vertices.map((v) => v.x)) - 100,
    minY = Math.min(...vertices.map((v) => v.y)) - 100;
  [...vertices, ...tiles].forEach((v) => {
    v.x -= minX;
    v.y -= minY;
  });
  const ports = seaFramePorts(orderedCoast(edges, vertices), n, rng);
  return {
    tiles,
    vertices,
    edges,
    ports,
    robber: tiles.find((t) => t.resource === "desert")!.id,
    width: Math.max(...vertices.map((v) => v.x)) + 100,
    height: Math.max(...vertices.map((v) => v.y)) + 100,
  };
}

export type TileLayout = {
  q: number;
  r: number;
  resource: Tile["resource"];
  number?: number;
  island?: number;
  home?: boolean;
  fog?: boolean;
};
export function assembleTiles(layout: TileLayout[]) {
  const size = 48,
    vertices: Vertex[] = [],
    edges: Edge[] = [],
    tiles: Tile[] = [];
  const vm = new Map<string, number>(),
    em = new Map<string, number>();
  layout.forEach(({ q, r }, id) => {
    const x = Math.sqrt(3) * size * (q + r / 2),
      y = 1.5 * size * r;
    const ids = Array.from({ length: 6 }, (_, i) => {
      const angle = ((60 * i - 30) * Math.PI) / 180,
        vx = x + size * Math.cos(angle),
        vy = y + size * Math.sin(angle),
        key = `${Math.round(vx * 1000)},${Math.round(vy * 1000)}`;
      let v = vm.get(key);
      if (v === undefined) {
        v = vertices.length;
        vm.set(key, v);
        vertices.push({
          id: v,
          x: vx,
          y: vy,
          tiles: [],
          edges: [],
          owner: null,
          city: false,
        });
      }
      vertices[v].tiles.push(id);
      return v;
    });
    ids.forEach((a, i) => {
      const b = ids[(i + 1) % 6],
        key = [a, b].sort((a, b) => a - b).join(",");
      let e = em.get(key);
      if (e === undefined) {
        e = edges.length;
        em.set(key, e);
        edges.push({ id: e, a, b, tiles: [], owner: null });
        vertices[a].edges.push(e);
        vertices[b].edges.push(e);
      }
      edges[e].tiles.push(id);
    });
    tiles.push({
      id,
      q,
      r,
      x,
      y,
      resource: layout[id].resource,
      number: layout[id].number ?? 0,
      island: layout[id].island,
      home: layout[id].home,
      ...(layout[id].fog ? { fog: true } : {}),
      vertices: ids,
    });
  });
  return { tiles, vertices, edges };
}
