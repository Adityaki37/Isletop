import test from "node:test";
import assert from "node:assert/strict";
import { candidates, roadTrails, score } from "./cities-browser-helpers";
import {
  createGame,
  player,
  addPlayer,
  applyAction,
  view,
  View,
} from "../lib/game";
function graph(kinds: ("road" | "ship")[]) {
  const g = createGame(
    "GUIAUD",
    player("p0", "P0"),
    3,
    false,
    "seafarersCitiesKnights",
  );
  addPlayer(g, player("p1", "P1"));
  addPlayer(g, player("p2", "P2"));
  applyAction(g, 1, { type: "ready" });
  applyAction(g, 2, { type: "ready" });
  applyAction(g, 0, { type: "start" });
  const result = view(g, "p0");
  result.board.vertices = Array.from({ length: kinds.length + 1 }, (_, id) => ({
    id,
    x: 0,
    y: 0,
    tiles: [],
    edges: [],
    owner: null,
    city: false,
  }));
  result.board.edges = kinds.map((kind, id) => ({
    id,
    a: id,
    b: id + 1,
    kind,
    owner: 0,
    tiles: [],
  }));
  result.cities!.knights = [];
  return result;
}
test("Browser recording audit separates road and ship trails at an empty junction", () => {
  const g = graph(["road", "road", "ship", "ship"]);
  assert.equal(roadTrails(g, 0), 2);
  g.board.vertices[2].owner = 0;
  assert.equal(roadTrails(g, 0), 4);
});
test("Browser route audit stops at opponents' buildings and knights", () => {
  const g = graph(["road", "road", "road", "road", "road"]);
  assert.equal(roadTrails(g, 0), 5);
  g.board.vertices[2].owner = 1;
  assert.equal(roadTrails(g, 0), 3);
  g.board.vertices[2].owner = null;
  g.cities!.knights.push({
    owner: 1,
    vertex: 2,
    level: 1,
    active: false,
    activatedAt: -1,
    upgradedAt: -1,
  } as NonNullable<View["cities"]>["knights"][number]);
  assert.equal(roadTrails(g, 0), 3);
});
test("Browser route audit never treats an owned knight as a road-to-ship building", () => {
  const g = graph(["road", "road", "ship", "ship"]);
  g.cities!.knights.push({
    owner: 0,
    vertex: 2,
    level: 1,
    active: false,
    activatedAt: -1,
    upgradedAt: -1,
  } as NonNullable<View["cities"]>["knights"][number]);
  assert.equal(roadTrails(g, 0), 2);
});
test("Browser route audit counts a cycle once without reusing any edge", () => {
  const g = graph(["ship", "ship", "ship", "ship", "ship"]);
  g.board.edges.push({ id: 5, a: 5, b: 0, kind: "ship", owner: 0, tiles: [] });
  assert.equal(roadTrails(g, 0), 6);
});
test("Browser score audit includes island bonuses and both expansion point sources", () => {
  const g = graph(["road"]);
  g.board.vertices[0].owner = 0;
  g.board.vertices[0].city = true;
  g.players[0].islandBonus = 4;
  g.longest = 0;
  g.cities!.players[0].defenders = 1;
  g.cities!.merchant = { owner: 0, tile: 0 };
  g.cities!.players[0].revealed = [
    { kind: "printer" } as NonNullable<
      View["cities"]
    >["players"][number]["revealed"][number],
  ];
  g.cities!.metropolises.science = { owner: 0, vertex: 0 };
  assert.equal(score(g, 0), 13);
});
test("Standalone Seafarers audit counts mixed routes, island points, army and private victory cards", () => {
  const g = graph(["road", "road", "ship", "ship"]);
  g.mode = "seafarers";
  g.cities = null;
  assert.equal(roadTrails(g, 0), 2);
  g.board.vertices[2].owner = 0;
  assert.equal(roadTrails(g, 0), 4);
  g.board.vertices[2].city = true;
  g.players[0].islandBonus = 2;
  g.longest = 0;
  g.army = 0;
  g.players[0].dev = [{ kind: "victory", bought: 1 }];
  assert.equal(score(g, 0), 9);
  delete g.players[0].dev;
  assert.equal(score(g, 0), 8);
});
test("Combined browser decisions never target sea or fog with the Merchant", () => {
  const g = createGame(
    "MERGUI",
    player("p0", "P0"),
    3,
    false,
    "seafarersCitiesKnights",
    "fogIslands",
  );
  addPlayer(g, player("p1", "P1"));
  addPlayer(g, player("p2", "P2"));
  applyAction(g, 1, { type: "ready" });
  applyAction(g, 2, { type: "ready" });
  applyAction(g, 0, { type: "start" });
  g.phase = "action";
  const vertex = g.board.vertices.find(
    (v) =>
      v.tiles.some(
        (id) => !g.board.tiles[id].fog && g.board.tiles[id].resource !== "sea",
      ) && v.tiles.some((id) => g.board.tiles[id].resource === "sea"),
  );
  assert(vertex);
  vertex.owner = 0;
  g.cities!.players[0].progress = [
    { id: -1, kind: "merchant", track: "trade" },
  ];
  const own = view(g, "p0"),
    moves = candidates(own).filter(
      (a) => a.type === "progress" && a.cardId === -1,
    );
  assert(moves.length > 0);
  assert(
    moves.every((a) => {
      const tile = own.board.tiles[a.tile!];
      return (
        !tile.fog &&
        tile.resource !== "sea" &&
        tile.vertices.includes(vertex.id)
      );
    }),
  );
  const gold = own.board.tiles[moves[0].tile!];
  gold.resource = "gold";
  assert(
    !candidates(own).some(
      (a) => a.type === "progress" && a.cardId === -1 && a.tile === gold.id,
    ),
  );
});
test("Browser Bishop decisions use land before the ordinary robber phase, respecting first-attack and friendly locks", () => {
  const g = createGame(
    "BISGUI",
    player("p0", "P0"),
    3,
    false,
    "seafarersCitiesKnights",
    "fogIslands",
  );
  addPlayer(g, player("p1", "P1"));
  addPlayer(g, player("p2", "P2"));
  applyAction(g, 1, { type: "ready" });
  applyAction(g, 2, { type: "ready" });
  applyAction(g, 0, { type: "start" });
  g.phase = "action";
  g.cities!.players[0].progress = [
    { id: -1, kind: "bishop", track: "politics" },
  ];
  const bishops = () =>
    candidates(view(g, "p0")).filter(
      (a) => a.type === "progress" && a.cardId === -1,
    );
  assert.equal(bishops().length, 0);
  g.cities!.attacks = 1;
  assert.equal(view(g, "p0").legal.robber.length, 0);
  const moves = bishops();
  assert(moves.length > 0);
  assert(
    moves.every(
      (a) =>
        !g.board.tiles[a.tile!].fog &&
        g.board.tiles[a.tile!].resource !== "sea" &&
        a.tile !== g.board.robber,
    ),
  );
  const tile = g.board.tiles[moves[0].tile!];
  g.board.vertices[tile.vertices[0]].owner = 1;
  g.friendlyRobber = true;
  assert(!bishops().some((a) => a.tile === tile.id));
});
