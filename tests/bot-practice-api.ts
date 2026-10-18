import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { actor, type View } from "../lib/game";
import { BOT_MOVE_INTERVAL } from "../lib/disconnect-bots";

const origin = process.env.TEST_ORIGIN ?? "http://localhost:5174";
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Run practice tests locally.");
let cookie = "";
async function request(body?: Record<string, unknown>, code?: string) {
  const r = await fetch(`${origin}/api/rooms${code ? `?code=${code}` : ""}`, {
    method: body ? "POST" : "GET",
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json", Origin: origin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const next = r.headers.get("set-cookie");
  if (next) cookie = next.split(";")[0];
  return { status: r.status, ...await r.json() as { game: View; error?: string } };
}
async function ok(body?: Record<string, unknown>, code?: string) {
  const r = await request(body, code);
  assert.equal(r.status, 200, r.error);
  return r.game;
}
assert.equal((await request({ op: "create", practice: "unknown", name: "Practice QA" })).status, 400);
for (const botCount of [undefined, 0, -1, 12, 1.5, "2", null]) {
  cookie = "";
  assert.equal((await request({ op: "create", practice: "bots", botCount, name: "Practice QA" })).status, 400);
}
cookie = "";
let g = await ok({
  op: "create", practice: "botDuel", name: `Live QA ${Date.now()}/0`,
  // The preset must enforce a private two-player base duel.
  capacity: 8, public: true, mode: "seafarers",
});
const record = ".sites-runtime/bot-duel-local-room.json";
const prior = existsSync(record) ? JSON.parse(readFileSync(record, "utf8")) : [];
writeFileSync(record, JSON.stringify([...(Array.isArray(prior) ? prior : [prior]), { code: g.code, created: g.created }]));
assert.equal(g.players.length, 2);
assert.equal(g.capacity, 2);
assert.equal(g.public, false);
assert.equal(g.mode, "duel");
assert.equal(g.players[0].bot, undefined);
assert.equal(g.players[1].bot, true);
assert.notEqual(g.players[0].color, g.players[1].color);
assert.equal(g.me, 0);
assert.equal(g.target, 15);
assert.equal(g.turnSeconds, 60);
assert(g.deadline! - g.serverTime > 115000 && g.deadline! - g.serverTime <= 120000);
assert.equal(g.ranked, undefined);
assert.equal(g.matchmaking, undefined);
assert.equal(g.phase, "setupSettlement");
let playingCookie = "";
for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
  cookie = "";
  const created = await ok({ op: "create", practice: "bots", botCount: count, name: "Casual Bots QA", capacity: 8, public: true });
  const records = JSON.parse(readFileSync(record, "utf8"));
  writeFileSync(record, JSON.stringify([...records, { code: created.code, created: created.created }]));
  assert.equal(created.players.length, count + 1);
  assert.equal(created.capacity, count + 1);
  assert.equal(created.players.filter(p => p.bot).length, count);
  assert.equal(created.players[0].bot, undefined);
  assert.equal(new Set(created.players.map(p => p.color)).size, count + 1);
  assert.equal(created.public, false);
  assert.equal(created.mode, count === 1 ? "duel" : "base");
  assert.equal(created.turnSeconds, 60);
  assert(created.deadline! - created.serverTime > 115000 && created.deadline! - created.serverTime <= 120000);
  assert.equal(created.ranked, undefined);
  assert.equal(created.phase, "setupSettlement");
  if (count === 2) { g = created; playingCookie = cookie; }
}
cookie = playingCookie;
for (const seconds of [0, 30, 120]) {
  cookie = "";
  const created = await ok({ op: "create", practice: "bots", botCount: 1, turnSeconds: seconds, name: "Timer selection QA" });
  assert.equal(created.turnSeconds, seconds);
  assert.equal(created.deadline === null, seconds === 0);
}
for (const turnSeconds of [-1, 1, "60", null]) {
  cookie = "";
  const result = await request({ op: "create", practice: "bots", botCount: 1, turnSeconds, name: "Invalid timer QA" });
  assert.equal(result.status, turnSeconds === null ? 200 : 400);
}
cookie = playingCookie;
console.log("PASS bots 1–11 use normal timers by default; selected timers and untimed mode work; invalid counts/timers rejected");
async function move(action: Record<string, unknown>) {
  g = await ok({ op: "action", code: g.code, expectedCreated: g.created, nonce: crypto.randomUUID(), action });
}
const sleep = () => new Promise(r => setTimeout(r, BOT_MOVE_INTERVAL + 100));
for (let step = 0; g.phase.startsWith("setup") && step < 80; step++) {
  if (actor(g) !== 0) { await sleep(); g = await ok(undefined, g.code); continue; }
  await move(g.phase === "setupSettlement"
    ? { type: "settlement", id: g.legal.settlement[0] }
    : { type: "road", id: g.legal.road[0] });
}
assert.equal(g.phase, "roll");
assert.equal(g.board.vertices.filter(v => v.owner === 1).length, 2);
assert.equal(g.board.edges.filter(e => e.owner === 1).length, 2);
assert.equal(g.board.vertices.filter(v => v.owner === 2).length, 2);
assert.equal(g.board.edges.filter(e => e.owner === 2).length, 2);
await move({ type: "roll" });
g = await ok(undefined, g.code);
if (g.phase === "robber") await move({ type: "robber", id: g.legal.robber[0] });
if (g.phase === "steal") await move({ type: "steal", id: g.victims[0] });
assert.equal(g.phase, "action");
await move({ type: "end" });
for (let step = 0; (g.active !== 0 || g.phase !== "roll") && step < 90; step++) {
  for (const offer of g.offers) if (offer.from !== 0 && !offer.rejected.includes(0)) await move({ type: "reject", id: offer.id });
  await sleep(); g = await ok(undefined, g.code);
}
assert.equal(g.active, 0, "Both bots complete their turns and return control to the human.");
assert.equal(g.phase, "roll");
console.log(JSON.stringify({ code: g.code, created: g.created, result: "Two-bot setup placements and autonomous turns return control to the human." }));
