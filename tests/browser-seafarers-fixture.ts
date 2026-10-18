// Local browser fixtures only. This never runs in the app or against production.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Game, normalizeGame } from "../lib/game";
import { emptyHand, RESOURCES } from "../lib/board";
import { shipBlocked } from "../lib/seafarers";
import { makeSeafarersBoard } from "../lib/seafarers";
import { fogContents } from "../lib/fog";
const [code, kind] = process.argv.slice(2);
assert(
  /^[A-Z0-9]{6}$/.test(code) &&
    [
      "moveShip",
      "pirate",
      "gold",
      "foreign",
      "fogResource",
      "fogGold",
      "fogSea",
    ].includes(kind),
);
const directory = resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const file = readdirSync(directory).find((n) =>
  /^[a-f0-9]{64}\.sqlite$/.test(n),
);
assert(file);
const db = new DatabaseSync(join(directory, file));
const row = db
  .prepare("SELECT state,revision FROM rooms WHERE code=?")
  .get(code) as { state: string; revision: number };
assert(row, "Create the local QA room first.");
const g = normalizeGame(JSON.parse(row.state) as Game);
assert(
  g.mode === "seafarers" &&
    g.players[0].name === "Captain Preview" &&
    !g.public,
  "Only the named unlisted local QA room may be changed.",
);
if (kind.startsWith("fog")) {
  assert.equal(g.scenario, "fogIslands");
  g.board = makeSeafarersBoard(g.capacity, g.scenario);
  Object.assign(g, fogContents(g.capacity));
}
g.board.vertices.forEach((v) => {
  v.owner = null;
  v.city = false;
});
g.board.edges.forEach((e) => {
  e.owner = null;
  delete e.kind;
  delete e.built;
});
g.players.forEach((p) => {
  p.hand = emptyHand();
  p.dev = [];
  p.islands = [];
  p.islandBonus = 0;
  p.knights = 0;
});
g.bank = Object.fromEntries(
  RESOURCES.map((r) => [r, g.capacity > 4 ? 24 : 19]),
) as Game["bank"];
Object.assign(g, {
  active: 0,
  turn: 5,
  phase: "action",
  resume: "action",
  shipMoved: false,
  goldClaims: {},
  goldResume: "action",
  specialPlayer: null,
  discards: {},
  victims: [],
  offers: [],
  longest: null,
  army: null,
  winner: null,
  devPlayed: false,
  turnSeconds: 0,
  deadline: null,
});
const e = g.board.edges.find(
  (e) =>
    e.tiles.some((id) => g.board.tiles[id].home) &&
    e.tiles.some((id) => g.board.tiles[id].resource === "sea") &&
    !shipBlocked(g.board, e),
)!;
g.board.vertices[e.a].owner = 0;
e.owner = kind === "pirate" ? 1 : 0;
e.kind = "ship";
e.built = 1;
if (kind.startsWith("fog")) {
  g.board.vertices[e.a].owner = null;
  e.owner = null;
  delete e.kind;
  delete e.built;
  const edge = g.board.edges.find(
    (edge) =>
      !shipBlocked(g.board, edge) &&
      edge.tiles.some((t) => g.board.tiles[t].resource === "sea") &&
      [edge.a, edge.b].some((id) =>
        g.board.vertices[id].tiles.some((t) => g.board.tiles[t].home),
      ) &&
      new Set(
        [edge.a, edge.b]
          .flatMap((id) => g.board.vertices[id].tiles)
          .filter((t) => g.board.tiles[t].fog),
      ).size === 1,
  )!;
  assert(edge);
  const start = [edge.a, edge.b].find((id) =>
    g.board.vertices[id].tiles.some((t) => g.board.tiles[t].home),
  )!;
  g.board.vertices[start].owner = 0;
  const resource =
    kind === "fogGold" ? "gold" : kind === "fogSea" ? "sea" : "ore";
  const i = g.fogDeck.indexOf(resource);
  assert(i >= 0);
  g.fogDeck.splice(i, 1);
  g.fogDeck.unshift(resource);
  const number = g.fogNumbers.indexOf(8);
  g.fogNumbers.splice(number, 1);
  g.fogNumbers.unshift(8);
  g.players[0].hand.wood = g.players[0].hand.sheep = 1;
  g.bank.wood--;
  g.bank.sheep--;
  console.log(`Fog ship ${edge.id}, discovery ${resource}.`);
} else if (kind === "foreign") {
  const home = g.board.tiles.find((t) => t.home)!.island!;
  g.players[0].islands = [home];
  const tile = g.board.tiles.find(
    (t) =>
      t.island !== undefined && t.island !== home && t.resource !== "desert",
  )!;
  assert(tile, "Choose a scenario with a foreign region.");
  const v = g.board.vertices[tile.vertices[0]],
    edge = g.board.edges[v.edges[0]];
  edge.owner = 0;
  edge.kind = edge.tiles.some((t) => g.board.tiles[t].resource === "sea")
    ? "ship"
    : "road";
  edge.built = 1;
  for (const r of ["wood", "brick", "sheep", "wheat"] as const) {
    g.players[0].hand[r] = 1;
    g.bank[r]--;
  }
  console.log(`Foreign settlement ${v.id}.`);
} else if (kind === "pirate") {
  g.phase = "robber";
  g.players[1].hand.wood = 2;
  g.bank.wood -= 2;
} else if (kind === "gold") {
  const t = g.board.tiles.find((t) => t.resource === "gold")!;
  g.board.vertices[t.vertices[0]].owner = 0;
  const other = g.board.vertices[t.vertices[2]];
  other.owner = 1;
  other.city = true;
  g.phase = "gold";
  g.goldClaims = { 0: 1, 1: 2 };
}
g.revision = row.revision + 1;
g.updated = Date.now();
const result = db
  .prepare(
    "UPDATE rooms SET state=?,revision=?,updated=? WHERE code=? AND revision=?",
  )
  .run(JSON.stringify(g), g.revision, g.updated, code, row.revision);
assert.equal(result.changes, 1);
db.close();
console.log(`Local ${kind} fixture ready.`);
