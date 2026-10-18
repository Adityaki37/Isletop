import test from "node:test";
import assert from "node:assert/strict";
import { baseMapAvailable, makeBaseBoard } from "../lib/base-maps";
import { makeBoard } from "../lib/board";
import {
  addPlayer,
  applyAction,
  createGame,
  Game,
  normalizeGame,
  legalSettlements,
  legalRoads,
  legalRobberTiles,
  player,
  view,
} from "../lib/game";

test("Lakes has four enclosed lakes, connected land and usable distinct coastal ports", () => {
  const b = makeBaseBoard(8, "lakes");
  assert.equal(b.tiles.length, 49);
  assert.equal(b.tiles.filter((t) => t.resource !== "sea").length, 39);
  assert.equal(b.tiles.filter((t) => t.resource === "sea").length, 10);
  assert.equal(b.ports.length, 12);
  assert.equal(new Set(b.ports.map((p) => p.edge)).size, 12);
  assert.equal(
    new Set(b.ports.flatMap((p) => [b.edges[p.edge].a, b.edges[p.edge].b]))
      .size,
    24,
  );
  assert.equal(b.tiles[b.robber].resource, "desert");
  const seen = new Set<number>();
  const inlandLakes: number[][] = [];
  for (const t of b.tiles.filter((t) => t.resource === "sea")) {
    if (seen.has(t.id)) continue;
    const component: number[] = [],
      queue = [t.id];
    let touchesOutside = false;
    while (queue.length) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      component.push(id);
      for (const e of b.edges.filter((e) => e.tiles.includes(id))) {
        if (e.tiles.length === 1) touchesOutside = true;
        queue.push(
          ...e.tiles.filter(
            (n) => !seen.has(n) && b.tiles[n].resource === "sea",
          ),
        );
      }
    }
    if (!touchesOutside) inlandLakes.push(component);
  }
  assert.deepEqual(
    inlandLakes.map((c) => c.length),
    [2, 2, 2, 2],
  );
  for (const p of b.ports) {
    const e = b.edges[p.edge];
    assert(e.tiles.some((id) => b.tiles[id].resource !== "sea"));
    assert(
      e.tiles.length === 1 ||
        e.tiles.some((id) => b.tiles[id].resource === "sea"),
    );
  }
  const landSeen = new Set<number>();
  const queue = [b.robber];
  while (queue.length) {
    const id = queue.pop()!;
    if (landSeen.has(id)) continue;
    landSeen.add(id);
    for (const e of b.edges.filter((e) => e.tiles.includes(id)))
      queue.push(
        ...e.tiles.filter(
          (n) => !landSeen.has(n) && b.tiles[n].resource !== "sea",
        ),
      );
  }
  assert.equal(landSeen.size, 39);
});

test("Lakes water rejects roads, settlements and robber moves in Base and Cities & Knights", () => {
  for (const mode of ["base", "citiesKnights"] as const) {
    const g = createGame(
      "LAKE22",
      player("a", "A"),
      4,
      false,
      mode,
      "newShores",
      "lakes",
    );
    const b = g.board;
    assert.equal(g.map, "lakes");
    assert(
      legalSettlements(g, 0, true).every((id) =>
        b.vertices[id].tiles.some((t) => b.tiles[t].resource !== "sea"),
      ),
    );
    for (const edge of b.edges.filter((e) =>
      e.tiles.every((id) => b.tiles[id].resource === "sea"),
    )) {
      g.setupVertex = edge.a;
      assert(!legalRoads(g, 0, true).includes(edge.id));
      const v = b.vertices[edge.a];
      v.owner = 0;
      assert(!legalRoads(g, 0).includes(edge.id));
      v.owner = null;
    }
    assert(legalRobberTiles(g).every((id) => b.tiles[id].resource !== "sea"));
    assert(
      legalRoads(g, 0, true).every((id) =>
        b.edges[id].tiles.some((t) => b.tiles[t].resource !== "sea"),
      ),
    );
  }
});

test("Lakes mode availability, ready reset and extension change preserve the map", () => {
  for (const capacity of [2, 3, 4, 5, 6, 7, 8])
    assert(baseMapAvailable("lakes", "base", capacity));
  for (const capacity of [3, 4, 5, 6])
    assert(baseMapAvailable("lakes", "citiesKnights", capacity));
  for (const mode of ["duel", "solo", "rush", "seafarers"])
    assert(!baseMapAvailable("lakes", mode, 4));
  const g = createGame("LAKE22", player("a", "A"), 4);
  addPlayer(g, player("b", "B"));
  applyAction(g, 1, { type: "ready" });
  applyAction(g, 0, { type: "settings", map: "lakes" });
  assert(g.players.every((p) => !p.ready));
  assert.equal(g.board.tiles.length, 49);
  applyAction(g, 0, { type: "settings", capacity: 8 });
  assert.equal(g.map, "lakes");
  assert.equal(g.board.tiles.length, 49);
  assert.deepEqual(
    g.board.tiles.map((t) => [t.q, t.r, t.resource === "sea"]),
    makeBaseBoard(8, "lakes").tiles.map((t) => [
      t.q,
      t.r,
      t.resource === "sea",
    ]),
  );
  applyAction(g, 0, { type: "settings", mode: "duel" });
  assert.equal(g.map, "baseRandom");
  assert.equal(g.board.tiles.length, 19);
});
function rng(seed: number) {
  seed = Math.imul(seed, 2654435761) >>> 0;
  return () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
test("classic and Base Random preserve inventory, geometry and separated red tokens", () => {
  const centers = new Set<number>();
  const deserts = new Set<number>();
  const layouts = new Set<string>();
  const numberLayouts = new Set<string>();
  for (let seed = 1; seed <= 1000; seed++) {
    const classic = makeBaseBoard(4, "base", rng(seed));
    const random = makeBaseBoard(4, "baseRandom", rng(seed));
    layouts.add(
      JSON.stringify([
        random.tiles.map((t) => [t.resource, t.number]),
        random.ports,
      ]),
    );
    numberLayouts.add(JSON.stringify(random.tiles.map((t) => t.number)));
    assert.deepEqual(random, makeBoard(4, rng(seed)));
    assert.deepEqual(
      classic.tiles.map((t) => t.resource),
      random.tiles.map((t) => t.resource),
    );
    assert.deepEqual(classic.ports, random.ports);
    assert.deepEqual(
      classic.tiles.map((t) => t.number).sort(),
      random.tiles.map((t) => t.number).sort(),
    );
    assert.equal(
      classic.tiles.find((t) => t.q === 0 && t.r === 0)!.number,
      classic.tiles.find((t) => t.q === 0 && t.r === 0)!.resource === "desert"
        ? 0
        : 11,
    );
    centers.add(random.tiles.find((t) => t.q === 0 && t.r === 0)!.number);
    deserts.add(classic.robber);
    for (const b of [classic, random]) {
      assert.equal(b.vertices.length, 54);
      assert.equal(b.edges.length, 72);
      assert.equal(b.tiles[b.robber].number, 0);
      assert(
        !b.edges.some(
          (e) =>
            e.tiles.length === 2 &&
            e.tiles.every((id) => [6, 8].includes(b.tiles[id].number)),
        ),
        `adjacent reds seed ${seed}`,
      );
    }
  }
  assert(centers.size >= 10);
  assert.equal(
    layouts.size,
    1000,
    "Random Base is generated, not selected from four presets",
  );
  assert(
    numberLayouts.size > 990,
    "Number positions independently vary across generated boards",
  );
  assert.equal(deserts.size, 19);
  for (const n of [5, 6, 7, 8])
    assert.deepEqual(makeBaseBoard(n, "base", rng(n)), makeBoard(n, rng(n)));
});
test("map changes are authoritative, atomic and invalidate ready checks", () => {
  const g = createGame("MAPS22", player("a", "A"), 4, false, "base", "newShores", "base");
  addPlayer(g, player("b", "B"));
  applyAction(g, 1, { type: "ready" });
  const before = JSON.stringify(g);
  assert.throws(
    () => applyAction(g, 1, { type: "settings", map: "baseRandom" }),
    /host/,
  );
  assert.equal(JSON.stringify(g), before);
  assert.throws(
    () =>
      applyAction(g, 0, {
        type: "settings",
        map: "diamond",
        capacity: 8,
        target: 12,
      }),
    /available map/,
  );
  assert.equal(JSON.stringify(g), before);
  assert.throws(
    () => applyAction(g, 0, { type: "settings", map: null as never }),
    /available map/,
  );
  assert.equal(JSON.stringify(g), before);
  applyAction(g, 0, { type: "settings", map: "baseRandom" });
  assert.equal(g.map, "baseRandom");
  assert(g.players.every((p) => !p.ready));
  assert.equal(view(g, "spectator").map, "baseRandom");
  applyAction(g, 0, { type: "settings", capacity: 8 });
  assert.equal(g.map, "baseRandom");
  assert.equal(g.board.tiles.length, 19);
  assert.throws(
    () =>
      createGame(
        "BADM22",
        player("a", "A"),
        4,
        false,
        "base",
        "newShores",
        "fake" as never,
      ),
    /available map/,
  );
  for (const [mode, capacity] of [
    ["seafarers", 4],
  ] as const)
    assert.throws(
      () =>
        createGame(
          "BADM22",
          player("a", "A"),
          capacity,
          false,
          mode,
          "newShores",
          "baseRandom",
        ),
      /available map/,
    );
});
test("selected map survives start and legacy normalization preserves an existing board", () => {
  for (const mode of ["base", "citiesKnights"] as const) {
    const g = createGame(
      "MAPS22",
      player("a", "A"),
      3,
      false,
      mode,
      "newShores",
      "baseRandom",
    );
    addPlayer(g, player("b", "B"));
    addPlayer(g, player("c", "C"));
    g.players.forEach((p) => (p.ready = true));
    applyAction(g, 0, { type: "start" });
    assert.equal(g.map, "baseRandom");
    assert.equal(g.phase, "setupSettlement");
    assert.equal(g.board.tiles.length, 19);
    assert.equal(!!g.cities, mode === "citiesKnights");
  }
  const legacy = createGame("OLDM22", player("a", "A"));
  const board = JSON.stringify(legacy.board);
  delete (legacy as Partial<Game>).map;
  normalizeGame(legacy);
  assert.equal(legacy.map, "base");
  assert.equal(JSON.stringify(legacy.board), board);
});
