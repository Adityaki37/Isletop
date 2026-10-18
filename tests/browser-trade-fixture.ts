// Local UI verification only; never imported by the app or used against production.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Game, normalizeGame } from "../lib/game";
import { RESOURCES, emptyHand } from "../lib/board";
const code = process.argv[2];
assert(/^[A-Z0-9]{6}$/.test(code));
const directory = resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const file = readdirSync(directory).find((n) =>
  /^[a-f0-9]{64}\.sqlite$/.test(n),
);
assert(file);
const db = new DatabaseSync(join(directory, file));
const row = db
  .prepare("SELECT state,revision FROM rooms WHERE code=?")
  .get(code) as { state: string; revision: number };
assert(row);
const g = normalizeGame(JSON.parse(row.state) as Game);
assert(
  g.players[0].name === "Trade Preview" &&
    g.players.length === 8 &&
    !g.public &&
    g.phase !== "lobby",
  "Only a started eight-seat unlisted local QA room can be changed.",
);
g.bank = Object.fromEntries(RESOURCES.map((r) => [r, 29])) as Game["bank"];
g.players.forEach((p, i) => {
  p.embargoes = [];
  p.autoRejectTrades = true;
  p.hand =
    i === 0
      ? { ...emptyHand(), wood: 3, wheat: 2 }
      : { ...emptyHand(), brick: 2, ore: 1 };
  for (const r of RESOURCES) g.bank[r] -= p.hand[r];
});
Object.assign(g, {
  phase: "action",
  active: process.argv[3] === "recipient" ? 1 : 0,
  turn: 5,
  offers: [],
  turnSeconds: 0,
  deadline: null,
  clockKey: null,
  revision: row.revision + 1,
  updated: Date.now(),
});
const result = db
  .prepare(
    "UPDATE rooms SET state=?,revision=?,updated=? WHERE code=? AND revision=?",
  )
  .run(JSON.stringify(g), g.revision, g.updated, code, row.revision);
assert.equal(result.changes, 1);
db.close();
console.log(
  "Local trade UI fixture ready: host lumber/grain, seven partners brick/ore, finite bank.",
);
