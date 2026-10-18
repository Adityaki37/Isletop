import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import { assertStatistics } from "./statistics-assertions";
import { assertRecordedTransition } from "./replay-assertions";
import test from "node:test";
import assert from "node:assert/strict";
import { RESOURCES, emptyHand, Hand } from "../lib/board";
import {
  makeSeafarersBoard,
  movableShips,
  routeKind,
  shipBlocked,
} from "../lib/seafarers";
import {
  Game,
  createGame,
  player,
  addPlayer,
  legalRoads,
  legalShips,
  legalSettlements,
  legalMoveShips,
  shipDestinations,
  legalPirateTiles,
  legalRobberTiles,
  points,
  roadLength,
  view,
  actor,
  total,
  advanceClock,
} from "../lib/game";
import { chooseMove } from "./autoplay";

function game(n = 4) {
  const g = createGame(
    "SEA234",
    player("secret-0", "Captain"),
    n,
    false,
    "seafarers",
  );
  for (let i = 1; i < n; i++)
    addPlayer(g, player(`secret-${i}`, `Sailor ${i}`));
  g.players.forEach((p) => (p.ready = true));
  g.turnSeconds = 0;
  return g;
}
function fixture() {
  const g = game();
  g.phase = "action";
  g.turn = 5;
  const edge = g.board.edges.find(
    (e) =>
      e.tiles.some((id) => g.board.tiles[id].home) &&
      e.tiles.some((id) => g.board.tiles[id].resource === "sea") &&
      !shipBlocked(g.board, e),
  )!;
  g.board.vertices[edge.a].owner = 0;
  return { g, edge };
}
function resources(g: Game, p: number, h: Partial<Hand>) {
  for (const r of RESOURCES) {
    g.bank[r] += g.players[p].hand[r] - (h[r] ?? 0);
    g.players[p].hand[r] = h[r] ?? 0;
  }
}
function roll(g: Game, sum: number) {
  g.phase = "roll";
  const dice = sum <= 7 ? [1, sum - 1] : [sum - 6, 6];
  let i = 0;
  applyAction(g, g.active, { type: "roll" }, () => (dice[i++] - 0.5) / 6);
}

test("New Shores maps have separated home/islands, expected land, gold, ports and legal setup", () => {
  for (const [n, land, home, gold, ports] of [
    [3, 22, 14, 2, 8],
    [4, 28, 19, 2, 9],
    [6, 40, 30, 3, 11],
  ]) {
    const b = makeSeafarersBoard(n);
    assert.equal(b.tiles.filter((t) => t.resource !== "sea").length, land);
    assert.equal(b.tiles.filter((t) => t.home).length, home);
    assert.equal(b.tiles.filter((t) => t.resource === "gold").length, gold);
    assert.equal(b.ports.length, ports);
    assert.equal(b.tiles.length, n === 3 ? 37 : n === 4 ? 44 : 57);
    const portVertices = new Set<number>();
    for (const port of b.ports) {
      const e = b.edges[port.edge];
      assert(e.tiles.some((id) => b.tiles[id].home));
      assert(
        e.tiles.length === 1 ||
          e.tiles.some((id) => b.tiles[id].resource === "sea"),
      );
      for (const id of [e.a, e.b]) {
        assert(!portVertices.has(id), `${n}: ports overlap at ${id}`);
        portVertices.add(id);
      }
    }
    assert.equal(
      b.ports.filter((p) => p.resource === "sheep").length,
      n > 4 ? 2 : 1,
    );
    assert.equal(b.tiles[b.pirate!].resource, "sea");
    assert(b.tiles.filter((t) => t.home).every((t) => t.island === 0));
    assert(
      b.tiles
        .filter((t) => t.resource !== "sea" && !t.home)
        .every((t) => t.island! > 0),
    );
    const g = game(n);
    assert.equal(g.target, 14);
    assert(
      legalSettlements(g, 0, true).every((id) =>
        b.vertices[id].tiles.some((tid) => b.tiles[tid].home),
      ),
    );
    assert.throws(() =>
      createGame("bad", player("a", "A"), 8, false, "seafarers"),
    );
    const before = JSON.stringify(g);
    assert.throws(() => applyAction(g, 0, { type: "settings", capacity: 8 }));
    assert.equal(JSON.stringify(g), before);
    applyAction(g, 0, { type: "start" });
    while (g.phase.startsWith("setup"))
      applyAction(g, g.active, chooseMove(g)!);
    assert.equal(g.phase, "roll");
    for (let p = 0; p < n; p++)
      assert.equal(g.board.vertices.filter((v) => v.owner === p).length, 2);
  }
});
test("ships pay lumber/wool, coastal setup can use a ship, and route types need a settlement to connect", () => {
  const { g, edge } = fixture();
  resources(g, 0, { wood: 2, sheep: 2 });
  assert(legalShips(g, 0).includes(edge.id));
  applyAction(g, 0, { type: "ship", id: edge.id });
  assert.deepEqual([g.players[0].hand.wood, g.players[0].hand.sheep], [1, 1]);
  assert.equal(g.board.edges[edge.id].kind, "ship");
  const end = edge.b;
  const sea = g.board.vertices[end].edges.find(
    (id) => g.board.edges[id].owner === null && legalShips(g, 0).includes(id),
  );
  assert(sea !== undefined);
  const coastalRoad = g.board.vertices[end].edges.find(
    (id) =>
      g.board.edges[id].owner === null &&
      g.board.edges[id].tiles.some((t) => g.board.tiles[t].resource !== "sea"),
  );
  if (coastalRoad !== undefined)
    assert(!legalRoads(g, 0).includes(coastalRoad));
  const roadFixture = fixture();
  const r = roadFixture;
  resources(r.g, 0, { wood: 1, brick: 1 });
  applyAction(r.g, 0, { type: "road", id: r.edge.id });
  const nextSea = r.g.board.vertices[r.edge.b].edges.find(
    (id) =>
      r.g.board.edges[id].owner === null &&
      r.g.board.edges[id].tiles.some(
        (t) => r.g.board.tiles[t].resource === "sea",
      ),
  )!;
  assert(!legalShips(r.g, 0).includes(nextSea));
  r.g.board.vertices[r.edge.b].owner = 0;
  assert(legalShips(r.g, 0).includes(nextSea));
  const setup = game();
  applyAction(setup, 0, { type: "start" });
  const vertex = legalSettlements(setup, 0, true).find((id) =>
    setup.board.vertices[id].tiles.some(
      (t) => setup.board.tiles[t].resource === "sea",
    ),
  )!;
  applyAction(setup, 0, { type: "settlement", id: vertex });
  applyAction(setup, 0, { type: "ship", id: legalShips(setup, 0, true)[0] });
  assert.equal(setup.setupStep, 1);
  assert.equal(view(setup, "secret-0").players[0].pieces.ship, 1);
});
test("open ships move once, from a prior turn, without changing supply or allowing a disconnected destination", () => {
  const { g, edge } = fixture();
  resources(g, 0, { wood: 1, sheep: 1 });
  applyAction(g, 0, { type: "ship", id: edge.id });
  assert(!legalMoveShips(g, 0).includes(edge.id));
  edge.built = 4;
  assert(legalMoveShips(g, 0).includes(edge.id));
  const destination = shipDestinations(g, 0, edge.id)[0];
  assert(destination !== undefined);
  const isolated = g.board.edges.find(
    (e) => e.owner === null && !shipDestinations(g, 0, edge.id).includes(e.id),
  )!.id;
  const before = JSON.stringify(g);
  assert.throws(() =>
    applyAction(g, 0, { type: "moveShip", id: edge.id, to: isolated }),
  );
  assert.equal(JSON.stringify(g), before);
  const bank = { ...g.bank };
  applyAction(g, 0, { type: "moveShip", id: edge.id, to: destination });
  assert.equal(edge.owner, null);
  assert.equal(g.board.edges[destination].owner, 0);
  assert.deepEqual(g.bank, bank);
  assert.equal(view(g, "secret-0").players[0].pieces.ship, 1);
  assert.equal(g.shipMoved, true);
  assert.equal(legalMoveShips(g, 0).length, 0);
  assert.throws(() =>
    applyAction(g, 0, { type: "moveShip", id: destination, to: edge.id }),
  );
  applyAction(g, 0, { type: "end" });
  assert.equal(g.shipMoved, false);
  assert.equal(
    legalMoveShips(g, 0).length,
    0,
    "Other seats cannot move the active player's ships.",
  );
});
test("closed shipping connections cannot move and 15 ships are separate from 15 roads", () => {
  const { g, edge } = fixture();
  edge.owner = 0;
  edge.kind = "ship";
  edge.built = 1;
  g.board.vertices[edge.b].owner = 0;
  assert(!legalMoveShips(g, 0).includes(edge.id));
  const sea = g.board.edges.filter((e) =>
    e.tiles.some((id) => g.board.tiles[id].resource === "sea"),
  );
  for (const e of sea.slice(0, 15)) {
    e.owner = 0;
    e.kind = "ship";
  }
  assert.equal(legalShips(g, 0).length, 0);
  assert(legalRoads(g, 0).length > 0, "Ships do not consume road pieces.");
});
test("Longest Trade Route switches between roads and ships only at an owned settlement", () => {
  const { g, edge } = fixture();
  edge.owner = 0;
  edge.kind = "road";
  const second =
    g.board.edges[g.board.vertices[edge.b].edges.find((id) => id !== edge.id)!];
  second.owner = 0;
  second.kind = "ship";
  const end = second.a === edge.b ? second.b : second.a;
  const third =
    g.board.edges[g.board.vertices[end].edges.find((id) => id !== second.id)!];
  third.owner = 0;
  third.kind = "ship";
  assert.equal(roadLength(g, 0), 2);
  g.board.vertices[edge.b].owner = 0;
  assert.equal(roadLength(g, 0), 3);
  g.board.vertices[edge.b].owner = 1;
  assert.equal(roadLength(g, 0), 2);
});
test("shipping loops follow the open-ship exceptions and opposing buildings do not reopen closed routes", () => {
  const g = game();
  const sea = g.board.tiles.find(
    (t) => t.resource === "sea" && t.id !== g.board.pirate,
  )!;
  const loop = g.board.edges.filter((e) => e.tiles.includes(sea.id));
  loop.forEach((e) => {
    e.owner = 0;
    e.kind = "ship";
    e.built = 1;
  });
  assert.deepEqual(
    movableShips(g.board, 0, 2).sort(),
    loop.map((e) => e.id).sort(),
  );
  const anchor = g.board.vertices[sea.vertices[0]];
  anchor.owner = 0;
  assert.deepEqual(
    movableShips(g.board, 0, 2).sort(),
    loop
      .filter((e) => [e.a, e.b].includes(anchor.id))
      .map((e) => e.id)
      .sort(),
  );
  g.board.vertices[sea.vertices[3]].owner = 0;
  assert.equal(movableShips(g.board, 0, 2).length, 0);
  g.board.vertices[sea.vertices[1]].owner = 1;
  assert.equal(movableShips(g.board, 0, 2).length, 0);
});
test("pirates steal from ship owners and block ships while allowing roads and coastal buildings", () => {
  const { g, edge } = fixture();
  edge.owner = 1;
  edge.kind = "ship";
  edge.built = 1;
  resources(g, 1, { wood: 2 });
  const sea = edge.tiles.find((id) => g.board.tiles[id].resource === "sea")!;
  g.phase = "robber";
  g.resume = "action";
  assert(!legalRobberTiles(g).includes(sea));
  assert(
    !legalPirateTiles(g).includes(
      g.board.tiles.find((t) => t.resource === "gold")!.id,
    ),
  );
  applyAction(g, 0, { type: "pirate", id: sea });
  assert.equal(g.phase, "action");
  assert.deepEqual(g.victims, []);
  assert.equal(g.players[0].hand.wood, 1);
  assert.equal(g.players[1].hand.wood, 1);
  assert(shipBlocked(g.board, edge));
  assert(!legalMoveShips(g, 1).includes(edge.id));
  const other = g.board.edges.find(
    (e) =>
      e.owner === null &&
      e.tiles.includes(sea) &&
      e.tiles.some((id) => g.board.tiles[id].home),
  )!;
  g.board.vertices[other.a].owner = 0;
  assert(!legalShips(g, 0).includes(other.id));
  assert(legalRoads(g, 0).includes(other.id));
});
test("friendly pirate protects low visible scores and spectator projections expose no private moves", () => {
  const { g, edge } = fixture();
  edge.owner = 1;
  edge.kind = "ship";
  edge.built = 1;
  const sea = edge.tiles.find((id) => g.board.tiles[id].resource === "sea")!;
  g.phase = "robber";
  g.friendlyRobber = true;
  g.players[1].dev = [
    { kind: "victory", bought: 1 },
    { kind: "victory", bought: 1 },
    { kind: "victory", bought: 1 },
  ];
  assert(
    !legalPirateTiles(g).includes(sea),
    "Hidden victory cards do not remove friendly protection.",
  );
  g.players[1].islandBonus = 3;
  assert(legalPirateTiles(g).includes(sea));
  const spectator = view(g, null);
  assert.deepEqual(spectator.legal.pirate, []);
  assert.deepEqual(spectator.legal.moveShips, []);
  assert.deepEqual(spectator.legal.shipDestinations, {});
  assert(spectator.players.every((p) => !p.hand && !p.dev));
  assert.equal(spectator.goldAmount, 0);
  assert(!("diceState" in spectator));
});
test("gold waits for every claimant, pays one per settlement/two per city and rejects invalid choices", () => {
  const { g } = fixture();
  const gold = g.board.tiles.find((t) => t.resource === "gold")!;
  for (const t of g.board.tiles) t.number = 0;
  gold.number = 5;
  g.board.vertices[gold.vertices[0]].owner = 0;
  g.board.vertices[gold.vertices[2]].owner = 1;
  g.board.vertices[gold.vertices[2]].city = true;
  roll(g, 5);
  assert.equal(g.phase, "gold");
  assert.deepEqual(g.goldClaims, { 0: 1, 1: 2 });
  assert.throws(() => applyAction(g, 0, { type: "end" }));
  assert.throws(() =>
    applyAction(g, 1, { type: "gold", resources: { ...emptyHand(), wood: 1 } }),
  );
  const bankBefore = total(g.bank);
  applyAction(g, 1, {
    type: "gold",
    resources: { ...emptyHand(), ore: 1, sheep: 1 },
  });
  assert.equal(g.phase, "gold");
  assert.equal(g.players[1].hand.ore, 1);
  applyAction(g, 0, { type: "gold", resources: { ...emptyHand(), wood: 1 } });
  assert.equal(g.phase, "action");
  assert.equal(total(g.bank), bankBefore - 3);
  assert.deepEqual(g.goldClaims, {});
  g.board.robber = gold.id;
  roll(g, 5);
  assert.equal(g.phase, "action");
});
test("gold shortages and timeout selections cannot create cards or stall the game", () => {
  const { g } = fixture();
  const gold = g.board.tiles.find((t) => t.resource === "gold")!;
  for (const t of g.board.tiles) t.number = 0;
  gold.number = 5;
  g.board.vertices[gold.vertices[0]].owner = 0;
  g.board.vertices[gold.vertices[0]].city = true;
  g.bank = { ...emptyHand(), wood: 1 };
  g.turnSeconds = 60;
  roll(g, 5);
  assert.equal(view(g, "secret-0").goldAmount, 1);
  const before = total(g.bank) + total(g.players[0].hand);
  advanceClock(g, g.deadline!, () => 0);
  assert.equal(g.phase, "action");
  assert.equal(g.players[0].hand.wood, 1);
  assert.equal(total(g.bank) + total(g.players[0].hand), before);
  roll(g, 5);
  assert.equal(g.phase, "action");
});
test("new island bonuses are per player and awarded once, including after an upgrade", () => {
  const { g } = fixture();
  const island = g.board.tiles.find(
    (t) =>
      t.resource !== "sea" &&
      !t.home &&
      g.board.tiles.filter((other) => other.island === t.island).length >= 5,
  )!.island!;
  const candidates = g.board.vertices.filter((v) =>
    v.tiles.some((id) => g.board.tiles[id].island === island),
  );
  const vertex = candidates[0];
  const connection = g.board.edges[vertex.edges[0]];
  connection.owner = 0;
  connection.kind = "ship";
  resources(g, 0, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
  applyAction(g, 0, { type: "settlement", id: vertex.id });
  assert.equal(g.players[0].islandBonus, 2);
  assert.equal(points(g, 0, false), 4);
  resources(g, 0, { wheat: 2, ore: 3 });
  applyAction(g, 0, { type: "city", id: vertex.id });
  assert.equal(g.players[0].islandBonus, 2);
  const vacant = (v: typeof vertex) =>
    v.owner === null &&
    v.edges.every((id) => {
      const e = g.board.edges[id];
      return g.board.vertices[e.a === v.id ? e.b : e.a].owner === null;
    });
  const second = candidates.find(vacant)!;
  g.board.edges[second.edges[0]].owner = 0;
  g.board.edges[second.edges[0]].kind = "ship";
  resources(g, 0, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
  applyAction(g, 0, { type: "settlement", id: second.id });
  assert.equal(g.players[0].islandBonus, 2);
  const other = candidates.find(vacant)!;
  g.active = 1;
  g.board.edges[other.edges[0]].owner = 1;
  g.board.edges[other.edges[0]].kind = "ship";
  resources(g, 1, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
  applyAction(g, 1, { type: "settlement", id: other.id });
  assert.equal(g.players[1].islandBonus, 2);
});
test("island bonus victories wait until the player's normal turn after special building", () => {
  const g = game(6);
  g.phase = "action";
  g.turn = 1;
  g.target = 3;
  const tile = g.board.tiles.find((t) => t.resource !== "sea" && !t.home)!;
  const v = g.board.vertices[tile.vertices[0]];
  const edge = g.board.edges[v.edges[0]];
  edge.owner = 1;
  edge.kind = "ship";
  resources(g, 1, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
  applyAction(g, 1, { type: "specialBuild", requested: true });
  applyAction(g, 0, { type: "end" });
  assert.equal(g.specialPlayer, 1);
  applyAction(g, 1, { type: "settlement", id: v.id });
  assert.equal(points(g, 1), 3);
  assert.equal(g.winner, null);
  while ((g.phase as string) === "special")
    applyAction(g, actor(g), { type: "pass" });
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 1);
});
test("Road Building can mix a road and ship, preserving normal dev timing and resource totals", () => {
  const { g } = fixture();
  g.players[0].dev = [{ kind: "roadBuilding", bought: 1 }];
  const bank = { ...g.bank };
  applyAction(g, 0, { type: "roadBuilding" });
  applyAction(g, 0, { type: "ship", id: legalShips(g, 0)[0] });
  assert.equal(g.freeRoads, 1);
  applyAction(g, 0, { type: "road", id: legalRoads(g, 0)[0] });
  assert.equal(g.phase, "action");
  assert.deepEqual(g.bank, bank);
  assert.equal(view(g, "secret-0").players[0].pieces.ship, 1);
  assert.throws(() => applyAction(g, 0, { type: "roadBuilding" }));
});

for (const n of [3, 4, 6])
  test(`complete ${n}-seat New Shores game conserves resources and reaches 14 points`, () => {
    const g = game(n);
    applyAction(g, 0, { type: "start" });
    const counts: Record<string, number> = {};
    let steps = 0;
    const supply = g.bank.wood;
    while (g.phase !== "finished" && steps < 16000) {
      const p =
        g.phase === "discard"
          ? Number(Object.keys(g.discards)[0])
          : g.phase === "gold"
            ? Number(Object.keys(g.goldClaims)[0])
            : actor(g);
      const move = chooseMove(g, p);
      assert(move, `No move at ${g.phase}`);
      assertRecordedTransition(g, () => applyAction(g, p, move));
      assertStatistics(g);
      counts[move.type] = (counts[move.type] ?? 0) + 1;
      for (const r of RESOURCES) {
        assert.equal(
          g.bank[r] + g.players.reduce((s, pl) => s + pl.hand[r], 0),
          supply,
          `${r} after ${move.type}`,
        );
        assert(g.bank[r] >= 0 && g.players.every((pl) => pl.hand[r] >= 0));
      }
      steps++;
    }
    assert.equal(
      g.phase,
      "finished",
      `Stalled after ${steps} moves, turn ${g.turn}`,
    );
    assert(points(g, g.winner!) >= 14);
    assert(counts.ship > 0);
    console.log(
      `New Shores ${n}: ${steps} moves, ${counts.ship} ships, ${counts.pirate} pirates, ${counts.gold ?? 0} gold selections.`,
    );
  });
