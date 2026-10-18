// Guarded local-only states for verifying human expansion controls. No app import.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  Game,
  createGame,
  player,
  applyAction,
  legalSettlements,
  legalRoads,
  actor,
  points,
  total,
} from "../lib/game";
import {
  GOODS,
  TRACKS,
  ProgressKind,
  CitiesHand,
  citiesHand,
  legalKnightPlacements,
} from "../lib/cities-knights";
import { citiesTable, citiesTimeoutChoice } from "../lib/cities-room";
const code = process.argv[2],
  scenario = process.argv[3] ?? "controls";
assert(/^[A-Z2-9]{6}$/.test(code));
const directory = resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const file = readdirSync(directory).find((name) =>
  /^[a-f0-9]{64}\.sqlite$/.test(name),
);
assert(file);
const db = new DatabaseSync(join(directory, file));
db.exec("PRAGMA busy_timeout=5000");
const row = db
  .prepare("SELECT state,revision FROM rooms WHERE code=?")
  .get(code) as { state: string; revision: number };
assert(row);
const old = JSON.parse(row.state) as Game;
assert(
  old.players[0].name === "Cities Preview" &&
    !old.public &&
    old.players.length === 4,
  "Only the named four-seat unlisted local QA table can be changed.",
);
const g = createGame(
  code,
  player(old.players[0].id, old.players[0].name),
  4,
  false,
  scenario === "merchantGold" ? "seafarersCitiesKnights" : "citiesKnights",
);
g.players = old.players.map((p) => ({
  ...player(p.id, p.name),
  ready: true,
  color: p.color,
}));
g.turnSeconds = 0;
applyAction(g, 0, { type: "start" });
while (g.phase.startsWith("setup"))
  applyAction(
    g,
    actor(g),
    g.phase === "setupSettlement"
      ? { type: "settlement", id: legalSettlements(g, actor(g), true)[0] }
      : { type: "road", id: legalRoads(g, actor(g), true)[0] },
  );
for (const p of g.players)
  for (const r of GOODS) {
    g.bank[r] = (g.bank[r] ?? 0) + (p.hand[r] ?? 0);
    p.hand[r] = 0;
  }
for (const v of g.board.vertices) {
  v.owner = null;
  v.city = false;
}
for (const e of g.board.edges) {
  e.owner = null;
  delete e.kind;
}
const vertices: number[] = [],
  edges: number[] = [];
function walk(v: number): boolean {
  vertices.push(v);
  if (edges.length === 6) return true;
  for (const id of g.board.vertices[v].edges) {
    const e = g.board.edges[id],
      next = e.a === v ? e.b : e.a;
    if (vertices.includes(next)) continue;
    edges.push(id);
    if (walk(next)) return true;
    edges.pop();
  }
  vertices.pop();
  return false;
}
assert(walk(0));
for (const id of edges)
  Object.assign(g.board.edges[id], { owner: 0, kind: "road" });
Object.assign(g.board.vertices[vertices[0]], { owner: 0, city: true });
g.board.vertices[vertices[5]].owner = 0;
for (let p = 1; p < 4; p++) {
  const id = legalSettlements(g, p, true).find((id) => !vertices.includes(id));
  assert.notEqual(id, undefined);
  Object.assign(g.board.vertices[id!], { owner: p, city: true });
}
const touching = g.board.tiles.filter((t) =>
  t.vertices.some((id) => g.board.vertices[id].owner === 0),
);
touching[0].resource = "wheat";
touching[1].resource = "ore";
g.cities!.players[0].improvements = { science: 2, trade: 2, politics: 3 };
g.cities!.knights = [
  {
    owner: 0,
    vertex: vertices[1],
    level: 1,
    active: false,
    activatedAt: -1,
    upgradedAt: -1,
  },
  {
    owner: 0,
    vertex: vertices[3],
    level: 2,
    active: true,
    activatedAt: 9,
    upgradedAt: -1,
  },
  {
    owner: 1,
    vertex: vertices[4],
    level: 1,
    active: true,
    activatedAt: 9,
    upgradedAt: -1,
  },
];
g.cities!.attacks = 1;
function fund(p: number, h: Partial<CitiesHand>) {
  for (const r of GOODS) {
    const n = h[r] ?? 0;
    g.bank[r] = (g.bank[r] ?? 0) - n;
    g.players[p].hand[r] = (g.players[p].hand[r] ?? 0) + n;
    assert((g.bank[r] ?? 0) >= 0);
  }
}
fund(0, {
  wood: 4,
  brick: 4,
  sheep: 4,
  wheat: 4,
  ore: 5,
  paper: 5,
  cloth: 5,
  coin: 5,
});
for (let p = 1; p < 4; p++) fund(p, { wood: 2, cloth: 2, coin: 1 });
g.phase = "action";
g.active = 0;
g.turn = 10;
g.deadline = null;
g.clockKey = null;
g.clockResume = null;
g.longest = null;
function grant(p: number, kind: ProgressKind) {
  const track = TRACKS.find((track) =>
    g.cities!.decks[track].some((c) => c.kind === kind),
  );
  assert(track);
  const deck = g.cities!.decks[track],
    at = deck.findIndex((c) => c.kind === kind),
    card = deck.splice(at, 1)[0];
  g.cities!.players[p].progress.push(card);
  return card.id;
}
if (scenario === "merchantGold") {
  grant(0, "merchant");
  touching[0].resource = "gold";
  const prior = g.board.vertices
    .find((v) => v.owner === 1)!
    .tiles.find((id) => !["sea", "gold"].includes(g.board.tiles[id].resource));
  assert.notEqual(prior, undefined);
  g.cities!.merchant = { owner: 1, tile: prior! };
} else if (scenario === "controls") {
  grant(0, "alchemist");
  grant(0, "merchant");
  grant(0, "engineer");
} else if (scenario.startsWith("choice-")) {
  const kind = scenario.slice(7);
  if (["wedding", "saboteur", "deserter", "commercialHarbor"].includes(kind)) {
    g.active = 1;
    const id = grant(1, kind as ProgressKind);
    if (kind === "wedding" || kind === "saboteur")
      g.cities!.players[0].defenders = 2;
    applyAction(g, 1, {
      type: "progress",
      cardId: id,
      ...(kind === "deserter" ? { target: 0 } : {}),
    });
    if (kind === "commercialHarbor")
      applyAction(g, 1, {
        type: "harborExchange",
        cardId: id,
        to: 0,
        resource: "wood",
      });
    while (g.cities!.choices.length && actor(g) !== 0)
      applyAction(
        g,
        actor(g),
        citiesTimeoutChoice(g, () => 0.42),
      );
  } else {
    if (kind === "pillage")
      g.cities!.choices = [
        { kind: "pillage", player: 0, vertices: [vertices[0]] },
      ];
    else if (kind === "aqueduct")
      g.cities!.choices = [{ kind: "aqueduct", player: 0 }];
    else if (kind === "metropolis")
      g.cities!.choices = [
        {
          kind: "metropolis",
          player: 0,
          track: "science",
          vertices: [vertices[0]],
        },
      ];
    else if (kind === "defenderProgress")
      g.cities!.choices = [{ kind: "defenderProgress", player: 0 }];
    else if (kind === "discardProgress") {
      for (const k of [
        "alchemist",
        "crane",
        "engineer",
        "medicine",
        "merchant",
      ] as ProgressKind[])
        grant(0, k);
      g.cities!.choices = [{ kind: "discardProgress", player: 0, limit: 4 }];
    } else if (kind === "relocateKnight" || kind === "deserterPlace")
      g.cities!.choices = [
        {
          kind: kind as "relocateKnight" | "deserterPlace",
          player: 0,
          knight: {
            owner: 0,
            vertex: -1,
            level: 3,
            active: true,
            activatedAt: 9,
            upgradedAt: -1,
          },
          vertices: legalKnightPlacements(citiesTable(g), 0, 3),
        },
      ];
    else if (kind === "relocateRoad") {
      const edge = edges.at(-1)!;
      g.board.edges[edge].owner = null;
      g.cities!.choices = [
        { kind: "relocateRoad", player: 0, edges: legalRoads(g, 0) },
      ];
    } else throw new Error("Unknown choice fixture");
    g.phase = "citiesChoice";
    g.citiesFlow = { kind: "resume", phase: "action" };
    g.citiesChoiceSeq = 1;
  }
} else {
  const kind = scenario as ProgressKind;
  grant(0, kind);
  if (kind === "alchemist") g.phase = "roll";
  if (kind === "spy") grant(1, "merchant");
  if (kind === "masterMerchant" || kind === "wedding" || kind === "saboteur")
    g.cities!.players[1].defenders = 3;
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
console.log(
  JSON.stringify({
    scenario,
    phase: g.phase,
    actor: actor(g),
    hostScore: points(g, 0),
    cards: total(g.players[0].hand),
    knights: g.cities!.knights.map((k) => ({
      vertex: k.vertex,
      owner: k.owner,
      level: k.level,
    })),
    openRoad: edges.at(-1),
    city: vertices[0],
    ...(scenario === "merchantGold"
      ? { gold: touching[0].id, land: touching[1].id }
      : {}),
  }),
);
