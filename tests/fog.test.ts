import { assertStatistics } from "./statistics-assertions";
import test from "node:test";
import assert from "node:assert/strict";
import { RESOURCES, emptyHand, Tile, assembleTiles } from "../lib/board";
import { fogContents } from "../lib/fog";
import {
  Game,
  createGame,
  player,
  addPlayer,
  applyAction,
  actor,
  legalSettlements,
  legalShips,
  legalRoads,
  legalMoveShips,
  shipDestinations,
  legalPirateTiles,
  legalRobberTiles,
  distribute,
  advanceClock,
  points,
  view,
} from "../lib/game";
import { chooseMove } from "./autoplay";
import { seededRandom, seededStart } from "./seeded-game";
function game(n = 4) {
  const g = createGame(
    "FOG222",
    player("captain", "Captain"),
    n,
    false,
    "seafarers",
    "fogIslands",
  );
  for (let i = 1; i < n; i++) addPlayer(g, player(`seat${i}`, `Sailor${i}`));
  g.players.forEach((p) => (p.ready = true));
  g.turnSeconds = 0;
  return g;
}
function setHand(g: Game, p: number, h: Partial<Game["bank"]>) {
  for (const r of RESOURCES) {
    g.bank[r] += g.players[p].hand[r] - (h[r] ?? 0);
    g.players[p].hand[r] = h[r] ?? 0;
  }
}
function frontier(g = game(), road = false) {
  g.phase = "action";
  g.turn = 5;
  const e = g.board.edges.find(
    (e) =>
      (!road || e.tiles.some((t) => g.board.tiles[t].home)) &&
      !e.tiles.includes(g.board.pirate!) &&
      e.tiles.some((t) => g.board.tiles[t].resource === "sea") &&
      [e.a, e.b].some((id) =>
        g.board.vertices[id].tiles.some((t) => g.board.tiles[t].home),
      ) &&
      [e.a, e.b]
        .flatMap((id) => g.board.vertices[id].tiles)
        .some((t) => g.board.tiles[t].fog),
  )!;
  assert(e, "Need a coast touching fog");
  const start = [e.a, e.b].find((id) =>
    g.board.vertices[id].tiles.some((t) => g.board.tiles[t].home),
  )!;
  g.board.vertices[start].owner = 0;
  assert(legalShips(g, 0).includes(e.id));
  const fog = [
    ...new Set([e.a, e.b].flatMap((id) => g.board.vertices[id].tiles)),
  ].filter((id) => g.board.tiles[id].fog);
  return { g, e, fog, start };
}
function stack(g: Game, resource: Tile["resource"]) {
  g.fogDeck = g.fogDeck.map(() => resource);
  g.fogNumbers = g.fogNumbers.map(() => 8);
}
function conservation(g: Game) {
  for (const r of RESOURCES)
    assert.equal(
      g.bank[r] + g.players.reduce((sum, p) => sum + p.hand[r], 0),
      g.capacity > 4 ? 24 : 19,
    );
}
test("Fog layouts, hidden pools, original harbor positions and setup are consistent at 3/4/6 seats", () => {
  for (const [n, home, fog, land, ports] of [
    [3, 14, 12, 24, 8],
    [4, 17, 12, 27, 10],
    [6, 24, 25, 39, 9],
  ]) {
    const g = game(n),
      b = g.board;
    assert.equal(g.target, 12);
    assert.equal(b.tiles.length, n > 4 ? 65 : 44);
    assert.equal(b.tiles.filter((t) => t.home).length, home);
    assert.equal(b.tiles.filter((t) => t.fog).length, fog);
    assert.equal(g.fogDeck.length, fog);
    assert.equal(
      b.tiles.filter((t) => t.resource !== "sea").length +
        g.fogDeck.filter((r) => r !== "sea").length,
      land,
    );
    assert.equal(
      g.fogNumbers.length,
      g.fogDeck.filter((r) => r !== "sea" && r !== "desert").length,
    );
    assert.equal(b.ports.length, ports);
    const used = new Set<number>();
    for (const port of b.ports) {
      const e = b.edges[port.edge];
      assert(e.tiles.some((t) => b.tiles[t].home));
      assert(
        e.tiles.length === 1 ||
          e.tiles.some((t) => b.tiles[t].resource === "sea"),
      );
      for (const id of [e.a, e.b]) {
        assert(!used.has(id), `${n} overlapping ports at ${id}`);
        used.add(id);
      }
    }
    assert(
      b.tiles
        .filter((t) => t.fog)
        .every((t) => t.resource === "sea" && t.number === 0 && !t.home),
    );
    assert(
      legalSettlements(g, 0, true).every((id) =>
        b.vertices[id].tiles.some((t) => b.tiles[t].home),
      ),
    );
    assert.equal(b.tiles[b.pirate!].resource, "sea");
    assert(!b.tiles[b.pirate!].fog);
    assert(legalPirateTiles(g).every((id) => !b.tiles[id].fog));
    assert(legalRobberTiles(g).every((id) => !b.tiles[id].fog));
    for (const id of ["captain", "seat1", null]) {
      const v = view(g, id);
      assert(!("fogDeck" in v) && !("fogNumbers" in v));
    }
  }
  assert.deepEqual(
    fogContents(5, () => 0.3),
    fogContents(6, () => 0.3),
  );
});
test("ship exploration reveals terrain and tokens once, pays finite resource rewards and rejects illegal moves before revelation", () => {
  const { g, e, fog } = frontier();
  stack(g, "wheat");
  setHand(g, 0, { wood: 1, sheep: 1 });
  const before = JSON.stringify(g);
  assert.throws(() => applyAction(g, 1, { type: "ship", id: e.id }));
  assert.equal(JSON.stringify(g), before);
  applyAction(g, 0, { type: "ship", id: e.id });
  assert.equal(g.players[0].hand.wheat, fog.length);
  assert(
    fog.every(
      (id) =>
        !g.board.tiles[id].fog &&
        g.board.tiles[id].resource === "wheat" &&
        g.board.tiles[id].number === 8,
    ),
  );
  const remaining = g.fogDeck.length;
  assert.equal(remaining, 12 - fog.length);
  assert.equal(g.fogNumbers.length, 10 - fog.length);
  conservation(g);
  assert.equal(g.players[0].islandBonus, 0);
  assert(!("fogDeck" in view(g, null)));
  const saved = JSON.parse(JSON.stringify(g)) as Game;
  assert.deepEqual(saved.fogDeck, g.fogDeck);
  assert.deepEqual(saved.board, JSON.parse(JSON.stringify(g.board)));
  assert.throws(() => applyAction(g, 0, { type: "ship", id: e.id }));
  assert.equal(g.fogDeck.length, remaining);
});
test("sea discoveries give no reward or number and a resource shortage cannot create a card", () => {
  const { g, e, fog } = frontier();
  stack(g, "sea");
  setHand(g, 0, { wood: 1, sheep: 1 });
  const numbers = g.fogNumbers.length;
  applyAction(g, 0, { type: "ship", id: e.id });
  assert(
    fog.every((id) => !g.board.tiles[id].fog && g.board.tiles[id].number === 0),
  );
  assert.equal(g.fogNumbers.length, numbers);
  assert.deepEqual(g.players[0].hand, emptyHand());
  conservation(g);
  const f = frontier();
  stack(f.g, "ore");
  setHand(f.g, 1, { ore: 19 });
  setHand(f.g, 0, { wood: 1, sheep: 1 });
  applyAction(f.g, 0, { type: "ship", id: f.e.id });
  assert.equal(f.g.players[0].hand.ore, 0);
  conservation(f.g);
});
test("gold discovery interrupts a paid ship move and resumes the remaining normal-turn clock", () => {
  const { g, e, fog } = frontier();
  stack(g, "gold");
  setHand(g, 0, { wood: 1, sheep: 1 });
  g.turnSeconds = 60;
  advanceClock(g, 1000);
  const deadline = g.deadline!;
  applyAction(g, 0, { type: "ship", id: e.id }, () => 0.2, 5000);
  assert.equal(g.phase, "gold");
  assert.equal(g.goldClaims[0], fog.length);
  assert.equal(g.goldResume, "action");
  assert.equal(g.clockResume?.remaining, deadline - 5000);
  const amount = view(g, "captain").goldAmount;
  applyAction(
    g,
    0,
    { type: "gold", resources: { ...emptyHand(), ore: amount } },
    () => 0.2,
    8000,
  );
  assert.equal(g.phase, "action");
  assert.equal(g.deadline, 8000 + deadline - 5000);
  assert.equal(g.players[0].hand.ore, amount);
  conservation(g);
});
test("a setup ship discovers gold and returns to the next player's placement after the former player chooses", () => {
  const { g, e, fog, start } = frontier();
  stack(g, "gold");
  g.phase = "setupRoad";
  g.setupVertex = start;
  g.setupStep = 0;
  applyAction(g, 0, { type: "ship", id: e.id });
  assert.equal(g.phase, "gold");
  assert.equal(g.active, 1);
  assert.equal(g.setupStep, 1);
  assert.equal(g.goldResume, "setupSettlement");
  assert.throws(() =>
    applyAction(g, 1, {
      type: "settlement",
      id: legalSettlements(g, 1, true)[0],
    }),
  );
  applyAction(g, 0, {
    type: "gold",
    resources: { ...emptyHand(), wheat: fog.length },
  });
  assert.equal(g.phase, "setupSettlement");
  assert.equal(g.active, 1);
  conservation(g);
});
test("special building exploration pauses its timer and gold choices do not end another player's game", () => {
  const { g, e, fog } = frontier(game(6));
  stack(g, "gold");
  setHand(g, 0, { wood: 1, sheep: 1 });
  g.phase = "special";
  g.specialPlayer = 0;
  g.active = 1;
  g.players[1].dev = Array.from({ length: 12 }, () => ({
    kind: "victory" as const,
    bought: 1,
  }));
  g.turnSeconds = 60;
  advanceClock(g, 1000);
  const deadline = g.deadline!;
  applyAction(g, 0, { type: "ship", id: e.id }, () => 0.2, 5000);
  assert.equal(g.phase, "gold");
  assert.equal(g.winner, null);
  assert.equal(g.goldResume, "special");
  applyAction(
    g,
    0,
    { type: "gold", resources: { ...emptyHand(), ore: fog.length } },
    () => 0.2,
    8000,
  );
  assert.equal(g.phase, "special");
  assert.equal(g.winner, null);
  assert.equal(g.deadline, 8000 + deadline - 5000);
  conservation(g);
});
test("a normal-turn gold reward is completed before declaring a pending victory", () => {
  const { g, e, fog } = frontier();
  stack(g, "gold");
  setHand(g, 0, { wood: 1, sheep: 1 });
  g.players[0].dev = Array.from({ length: 11 }, () => ({
    kind: "victory" as const,
    bought: 1,
  }));
  applyAction(g, 0, { type: "ship", id: e.id });
  assert.equal(g.phase, "gold");
  assert.equal(g.winner, null);
  applyAction(g, 0, {
    type: "gold",
    resources: { ...emptyHand(), ore: fog.length },
  });
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 0);
  conservation(g);
});
test("land discovered by a road enables settlement and production without giving island points", () => {
  // A shore beside remaining fog models a later discovered region; the initial
  // fixed maps approach their fog corridor through sea first.
  const base = game();
  base.board = {
    ...assembleTiles([
      { q: 0, r: 0, resource: "wood", number: 5, home: true },
      { q: 1, r: 0, resource: "sea", fog: true },
      { q: 0, r: 1, resource: "sea" },
    ]),
    ports: [],
    robber: 0,
    pirate: 2,
    width: 500,
    height: 500,
  };
  const { g, e, fog, start } = frontier(base, true);
  g.fogDeck = ["wood"];
  g.fogNumbers = [8];
  setHand(g, 0, { wood: 2, brick: 2, sheep: 1, wheat: 1 });
  assert(legalRoads(g, 0).includes(e.id));
  applyAction(g, 0, { type: "road", id: e.id });
  const end = e.a === start ? e.b : e.a;
  // Reach a distance-legal intersection on the newly revealed shore.
  const next = g.board.vertices[end].edges.find(
    (id) =>
      legalRoads(g, 0).includes(id) &&
      g.board.vertices[
        g.board.edges[id].a === end ? g.board.edges[id].b : g.board.edges[id].a
      ].tiles.some((t) => fog.includes(t)),
  )!;
  assert(next !== undefined);
  applyAction(g, 0, { type: "road", id: next });
  const destination = legalSettlements(g, 0).find((id) =>
    g.board.vertices[id].tiles.some((t) => fog.includes(t)),
  )!;
  assert(destination !== undefined);
  setHand(g, 0, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
  applyAction(g, 0, { type: "settlement", id: destination });
  assert.equal(g.players[0].islandBonus, 0);
  const amount = g.board.vertices
    .filter((v) => v.owner === 0)
    .reduce(
      (s, v) =>
        s +
        v.tiles.filter(
          (t) =>
            g.board.tiles[t].number === 8 &&
            g.board.tiles[t].resource === "wood" &&
            g.board.robber !== t,
        ).length,
      0,
    );
  const before = g.players[0].hand.wood;
  distribute(g, 8);
  assert.equal(g.players[0].hand.wood, before + amount);
  assert(amount > 0);
  conservation(g);
});
test("Road Building resumes its second free route after a gold exploration choice", () => {
  const { g, e } = frontier();
  stack(g, "gold");
  g.players[0].dev = [{ kind: "roadBuilding", bought: 1 }];
  applyAction(g, 0, { type: "roadBuilding" });
  applyAction(g, 0, { type: "ship", id: e.id });
  assert.equal(g.phase, "gold");
  assert.equal(g.freeRoads, 1);
  assert.equal(g.goldResume, "roadBuilding");
  applyAction(g, 0, {
    type: "gold",
    resources: { ...emptyHand(), brick: g.goldClaims[0] },
  });
  assert.equal(g.phase, "roadBuilding");
  applyAction(g, 0, { type: "road", id: legalRoads(g, 0)[0] });
  assert.equal(g.phase, "action");
  conservation(g);
});
test("a relocated older open ship can explore, while hidden hexes remain unavailable to robber and pirate", () => {
  const { g, e, start, fog } = frontier();
  stack(g, "brick");
  const source = g.board.vertices[start].edges
    .map((id) => g.board.edges[id])
    .find(
      (s) =>
        s.id !== e.id &&
        legalShips(g, 0).includes(s.id) &&
        ![s.a, s.b]
          .flatMap((v) => g.board.vertices[v].tiles)
          .some((t) => g.board.tiles[t].fog),
    )!;
  assert(source);
  source.owner = 0;
  source.kind = "ship";
  source.built = 1;
  assert(legalMoveShips(g, 0).includes(source.id));
  assert(shipDestinations(g, 0, source.id).includes(e.id));
  applyAction(g, 0, { type: "moveShip", id: source.id, to: e.id });
  assert.equal(g.players[0].hand.brick, fog.length);
  assert.equal(g.shipMoved, true);
  assert.equal(g.board.edges[source.id].owner, null);
  conservation(g);
});
for (const n of [3, 4, 6])
  test(`complete ${n}-seat Fog Islands game explores and reaches 12 points`, () => {
    const g = game(n);
    // Keep the exploration fixture repeatable; a random legal win can occur
    // entirely on the home island without testing fog discoveries at all.
    const random = seededRandom(n);
    seededStart(g, random);
    Object.assign(g, fogContents(n, random));
    const initial = g.fogDeck.length;
    let steps = 0;
    while (g.phase !== "finished" && steps < 18000) {
      const p =
        g.phase === "gold"
          ? Number(Object.keys(g.goldClaims)[0])
          : g.phase === "discard"
            ? Number(Object.keys(g.discards)[0])
            : actor(g);
      const move = chooseMove(g, p);
      assert(move);
      applyAction(g, p, move, random);
      assertStatistics(g);
      conservation(g);
      steps++;
    }
    assert.equal(g.phase, "finished", `${n} Fog stalled at ${g.turn}`);
    assert(points(g, g.winner!) >= 12);
    assert(g.fogDeck.length < initial);
    assert(g.players.every((p) => p.islandBonus === 0));
    console.log(
      `Fog ${n}: ${steps} actions, ${initial - g.fogDeck.length} discoveries, winner ${g.winner}.`,
    );
  });
