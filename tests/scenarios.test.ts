import { assertStatistics } from "./statistics-assertions";
import test from "node:test";
import assert from "node:assert/strict";
import { RESOURCES } from "../lib/board";
import { makeSeafarersBoard } from "../lib/seafarers";
import { SeafarersScenario, scenarioTarget } from "../lib/scenarios";
import {
  createGame,
  player,
  addPlayer,
  applyAction,
  legalSettlements,
  legalRoads,
  actor,
  points,
  normalizeGame,
  Game,
} from "../lib/game";
import { chooseMove } from "./autoplay";
import { seededStart, seededRandom } from "./seeded-game";
import { botMove, botPendingSeats } from "../lib/disconnect-bots";

function game(n: number, scenario: SeafarersScenario) {
  const g = createGame(
    "SCEN22",
    player("host", "Captain"),
    n,
    false,
    "seafarers",
    scenario,
  );
  for (let i = 1; i < n; i++) addPlayer(g, player(`seat-${i}`, `Sailor ${i}`));
  g.players.forEach((p) => (p.ready = true));
  g.turnSeconds = 0;
  return g;
}
test("scenario layouts preserve land, regions, ports and setup restrictions", () => {
  for (const [scenario, n, land, home, regions, ports] of [
    ["fourIslands", 3, 20, 20, 4, 9],
    ["fourIslands", 4, 23, 23, 4, 9],
    ["fourIslands", 6, 32, 32, 6, 11],
    ["throughDesert", 3, 25, 14, 5, 9],
    ["throughDesert", 4, 30, 17, 5, 10],
    ["throughDesert", 6, 43, 21, 7, 11],
  ] as const) {
    const b = makeSeafarersBoard(n, scenario);
    assert.equal(
      b.tiles.filter((t) => t.resource !== "sea").length,
      land,
      `${scenario} ${n} land`,
    );
    assert.equal(
      b.tiles.filter((t) => t.home).length,
      home,
      `${scenario} ${n} home`,
    );
    assert.equal(
      new Set(
        b.tiles.filter((t) => t.island !== undefined).map((t) => t.island),
      ).size,
      regions,
    );
    assert.equal(b.ports.length, ports);
    const used = new Set<number>();
    for (const port of b.ports) {
      const e = b.edges[port.edge];
      assert(e.tiles.some((id) => b.tiles[id].resource !== "sea"));
      assert(
        e.tiles.length === 1 ||
          e.tiles.some((id) => b.tiles[id].resource === "sea"),
        `${scenario} ${n} inland port ${port.edge}`,
      );
      for (const v of [e.a, e.b]) {
        assert(!used.has(v), `${scenario} ${n} overlapping port ${v}`);
        used.add(v);
      }
    }
    assert.equal(b.tiles[b.pirate!].resource, "sea");
    if (scenario === "fourIslands")
      assert(
        RESOURCES.includes(
          b.tiles[b.robber].resource as (typeof RESOURCES)[number],
        ),
      );
    else assert.equal(b.tiles[b.robber].resource, "desert");
    const g = game(n, scenario);
    assert.equal(g.target, scenarioTarget(scenario));
    const legal = legalSettlements(g, 0, true);
    assert(
      legal.every((id) => b.vertices[id].tiles.some((t) => b.tiles[t].home)),
    );
    if (scenario === "fourIslands")
      assert.equal(
        new Set(
          legal.flatMap((id) =>
            b.vertices[id].tiles
              .map((t) => b.tiles[t].island)
              .filter((i) => i !== undefined),
          ),
        ).size,
        regions,
      );
    else
      assert(
        !legal.some((id) =>
          b.vertices[id].tiles.every((t) => !b.tiles[t].home),
        ),
      );
  }
  for (const scenario of ["fourIslands", "throughDesert"] as const)
    assert.deepEqual(
      makeSeafarersBoard(5, scenario, () => 0.42),
      makeSeafarersBoard(6, scenario, () => 0.42),
    );
});
test("scenario settings reset readiness and defaults, reject invalid changes atomically, and normalize legacy rooms", () => {
  const g = game(4, "newShores");
  assert.throws(
    () => applyAction(g, 1, { type: "settings", scenario: "fourIslands" }),
    /host/i,
  );
  let before = JSON.stringify(g);
  assert.throws(() =>
    applyAction(g, 0, {
      type: "settings",
      scenario: "fog" as SeafarersScenario,
    }),
  );
  assert.equal(JSON.stringify(g), before);
  applyAction(g, 0, { type: "settings", scenario: "fourIslands" });
  assert.equal(g.target, 13);
  assert(g.players.every((p) => !p.ready));
  assert.equal(g.board.tiles.filter((t) => t.resource !== "sea").length, 23);
  applyAction(g, 0, {
    type: "settings",
    scenario: "throughDesert",
    target: 16,
  });
  assert.equal(g.target, 16);
  applyAction(g, 0, { type: "settings", mode: "base" });
  assert.equal(g.scenario, "newShores");
  before = JSON.stringify(g);
  assert.throws(() =>
    applyAction(g, 0, { type: "settings", scenario: "fourIslands" }),
  );
  assert.equal(JSON.stringify(g), before);
  delete (g as Partial<Game>).scenario;
  normalizeGame(g);
  assert.equal(g.scenario, "newShores");
});

function buildOnRegion(g: Game, region: number, p = 0) {
  const v = g.board.vertices.find(
    (v) =>
      v.owner === null &&
      v.tiles.some((id) => g.board.tiles[id].island === region) &&
      v.edges.every((id) => {
        const e = g.board.edges[id];
        return g.board.vertices[e.a === v.id ? e.b : e.a].owner === null;
      }),
  )!;
  assert(v, `No free region ${region}`);
  const e = g.board.edges[v.edges[0]];
  e.owner = p;
  e.kind = e.tiles.some((id) => g.board.tiles[id].resource === "sea")
    ? "ship"
    : "road";
  for (const r of RESOURCES) {
    g.bank[r] += g.players[p].hand[r] - 1;
    g.players[p].hand[r] = 1;
  }
  g.active = p;
  g.phase = "action";
  applyAction(g, p, { type: "settlement", id: v.id });
  return v;
}
test("Four Islands records starting islands without bonuses and awards each foreign island once per player", () => {
  for (const different of [false, true]) {
    const g = game(3, "fourIslands");
    applyAction(g, 0, { type: "start" });
    while (g.phase.startsWith("setup")) {
      let move = chooseMove(g)!;
      if (g.active === 0 && g.phase === "setupSettlement") {
        const region = g.players[0].islands.length === 0 || !different ? 0 : 1;
        move = {
          type: "settlement",
          id: legalSettlements(g, 0, true).find((id) =>
            g.board.vertices[id].tiles.some(
              (t) => g.board.tiles[t].island === region,
            ),
          )!,
        };
      }
      applyAction(g, actor(g), move);
    }
    assert.deepEqual(
      [...g.players[0].islands].sort(),
      different ? [0, 1] : [0],
    );
    assert.equal(g.players[0].islandBonus, 0);
    buildOnRegion(g, 0);
    assert.equal(g.players[0].islandBonus, 0);
    buildOnRegion(g, 2);
    assert.equal(g.players[0].islandBonus, 2);
    buildOnRegion(g, 2);
    assert.equal(g.players[0].islandBonus, 2);
    const expected =
      g.players[1].islandBonus + (g.players[1].islands.includes(2) ? 0 : 2);
    buildOnRegion(g, 2, 1);
    assert.equal(g.players[1].islandBonus, expected);
  }
});
test("Through the Desert awards the strip beyond the belt and offshore regions, with no desert or home bonus", () => {
  const g = game(4, "throughDesert");
  g.turn = 3;
  const home = g.board.tiles.find((t) => t.home)!.island!;
  const strip = g.board.tiles.find(
    (t) => t.r === -3 && t.resource !== "sea",
  )!.island!;
  assert.notEqual(home, strip);
  buildOnRegion(g, home);
  assert.equal(g.players[0].islandBonus, 0);
  buildOnRegion(g, strip);
  assert.equal(g.players[0].islandBonus, 2);
  buildOnRegion(g, strip);
  assert.equal(g.players[0].islandBonus, 2);
  const offshore = g.board.tiles.find(
    (t) => t.island !== undefined && t.island !== strip && t.island !== home,
  )!.island!;
  buildOnRegion(g, offshore);
  assert.equal(g.players[0].islandBonus, 4);
  assert(
    g.board.tiles
      .filter((t) => t.resource === "desert")
      .every((t) => t.island === undefined && !t.home),
  );
});
test("a connected road can cross the desert belt and settle the foreign strip for two bonus points", () => {
  const g = game(4, "throughDesert");
  g.phase = "action";
  g.turn = 3;
  const main = g.board.tiles.find((t) => t.home)!.island!,
    strip = g.board.tiles.find(
      (t) => t.r === -3 && t.resource !== "sea",
    )!.island!;
  const start = g.board.vertices.find(
    (v) =>
      v.tiles.some((t) => g.board.tiles[t].island === main) &&
      v.tiles.some((t) => g.board.tiles[t].resource === "desert"),
  )!;
  g.board.vertices[start.id].owner = 0;
  g.players[0].islands = [main];
  const frontier = [{ id: start.id, path: [] as number[] }],
    visited = new Set([start.id]);
  let route: number[] | undefined;
  while (frontier.length) {
    const next = frontier.shift()!;
    if (
      next.path.length >= 2 &&
      g.board.vertices[next.id].tiles.some(
        (t) => g.board.tiles[t].island === strip,
      )
    ) {
      route = next.path;
      break;
    }
    for (const eid of g.board.vertices[next.id].edges) {
      const e = g.board.edges[eid],
        id = e.a === next.id ? e.b : e.a;
      if (
        !visited.has(id) &&
        e.tiles.some((t) => g.board.tiles[t].resource !== "sea")
      ) {
        visited.add(id);
        frontier.push({ id, path: [...next.path, eid] });
      }
    }
  }
  assert(route && route.length <= 15);
  assert(
    route.some((id) =>
      g.board.edges[id].tiles.some(
        (t) => g.board.tiles[t].resource === "desert",
      ),
    ),
  );
  for (const id of route) {
    for (const r of RESOURCES) {
      g.bank[r] += g.players[0].hand[r] - 2;
      g.players[0].hand[r] = 2;
    }
    assert(legalRoads(g, 0).includes(id));
    applyAction(g, 0, { type: "road", id });
  }
  const end = g.board.edges[route.at(-1)!],
    destination = [end.a, end.b].find((id) =>
      g.board.vertices[id].tiles.some((t) => g.board.tiles[t].island === strip),
    )!;
  assert(legalSettlements(g, 0).includes(destination));
  applyAction(g, 0, { type: "settlement", id: destination });
  assert.equal(g.players[0].islandBonus, 2);
});
for (const scenario of ["fourIslands", "throughDesert"] as const)
  for (const n of [3, 4, 6])
    test(`complete ${n}-seat ${scenario} game reaches its preset and conserves finite resources`, () => {
      const g = game(n, scenario),
        supply = g.bank.wood;
      const rng = seededRandom(
        12340 + n * 997 + (scenario === "throughDesert" ? 100 : 0),
      );
      seededStart(g, rng);
      g.botPlayers = g.players.map((_, p) => p);
      let steps = 0;
      while (g.phase !== "finished" && steps < 18000) {
        const p = botPendingSeats(g)[0];
        const now = g.created + steps * 1001;
        const move = botMove(g, p, now);
        assert(move, `No move at ${g.phase} for seat ${p}, turn ${g.turn}`);
        applyAction(g, p, move, rng, now);
        assertStatistics(g);
        steps++;
        for (const r of RESOURCES) {
          assert.equal(
            g.bank[r] + g.players.reduce((s, p) => s + p.hand[r], 0),
            supply,
          );
          assert(g.bank[r] >= 0);
        }
      }
      assert.equal(
        g.phase,
        "finished",
        `Stalled ${scenario} ${n} at turn ${g.turn}`,
      );
      assert(points(g, g.winner!) >= scenarioTarget(scenario));
      console.log(
        `${scenario} ${n}: ${steps} moves, winner ${g.winner}, island bonus ${g.players[g.winner!].islandBonus}.`,
      );
    });
