import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { View } from "../lib/game";
import { publicLeader } from "../lib/game-display";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
assert(
  new URL(origin).protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
);
let cookie = "";
async function request(body?: Record<string, unknown>, code?: string) {
  const response = await fetch(
    origin + "/api/rooms" + (code ? "?code=" + code : ""),
    {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const set = response.headers.getSetCookie();
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return {
    status: response.status,
    ...((await response.json()) as { game: View; error?: string }),
  };
}
async function move(code: string, action: Record<string, unknown>) {
  const r = await request({
    op: "action",
    code,
    action,
    nonce: crypto.randomUUID(),
  });
  assert.equal(r.status, 200, r.error);
  return r.game;
}
const made = await request({
  op: "create",
  name: "Real 15-second timer QA",
  capacity: 1,
  mode: "solo",
  public: false,
});
assert.equal(made.status, 200);
const code = made.game.code;
let g = await move(code, { type: "settings", turnSeconds: 15 });
assert.equal(g.turnSeconds, 15);
const denied = await request({
  op: "action",
  code,
  action: { type: "settings", turnSeconds: 301 },
  nonce: crypto.randomUUID(),
});
assert.equal(denied.status, 400);
g = await move(code, { type: "start" });
assert.equal(g.phase, "setupSettlement");
assert(
  g.deadline !== null &&
    g.deadline - g.serverTime > 28000 &&
    g.deadline - g.serverTime <= 30000,
);
while (g.phase.startsWith("setup")) {
  const settlement = g.phase === "setupSettlement";
  g = await move(code, {
    type: settlement ? "settlement" : "road",
    id: settlement ? g.legal.settlement[0] : g.legal.road[0],
  });
}
assert.equal(g.phase, "roll");
assert(
  g.deadline !== null &&
    g.deadline - g.serverTime > 3500 &&
    g.deadline - g.serverTime <= 5000,
);
const initialRolls = Object.values(g.rollCounts).reduce((s, n) => s + n, 0);
console.log(
  "Waiting for actual five-second dice deadline in the new 15-second room.",
);
await new Promise((resolve) =>
  setTimeout(resolve, Math.max(0, g.deadline! - Date.now()) + 1000),
);
g = (await request(undefined, code)).game;
assert.equal(
  Object.values(g.rollCounts).reduce((s, n) => s + n, 0),
  initialRolls + 1,
);
assert(["action", "robber"].includes(g.phase));
const late = await request({
  op: "action",
  code,
  nonce: crypto.randomUUID(),
  action: { type: "roll" },
});
assert.equal(late.status, 400);
if (g.phase === "robber")
  g = await move(code, { type: "robber", id: g.legal.robber[0] });
assert.equal(g.phase, "action");
assert(g.deadline !== null && Number.isFinite(g.deadline));
assert.equal(publicLeader(g), 0);
const spectatorResponse = await fetch(origin + "/api/rooms?code=" + code),
  spectator = ((await spectatorResponse.json()) as { game: View }).game;
assert.equal(spectator.me, -1);
assert.equal(publicLeader(spectator), 0);
assert(spectator.players.every((p) => !p.hand && !p.dev));
const actionRemaining = g.deadline! - g.serverTime;
assert(actionRemaining > 13500 && actionRemaining <= 15000);
console.log(
  "Waiting for the actual 15-second action deadline; spectator reads must not add a second roll or extend it.",
);
await new Promise((resolve) =>
  setTimeout(resolve, Math.max(0, g.deadline! - Date.now()) + 1000),
);
const ended = (await request(undefined, code)).game;
assert.equal(ended.phase, "roll");
assert.equal(ended.turn, g.turn + 1);
assert.equal(
  Object.values(ended.rollCounts).reduce((s, n) => s + n, 0),
  initialRolls + 1,
);
const slow = await request({
  op: "create",
  name: "200-second option QA",
  capacity: 1,
  mode: "solo",
  public: false,
});
assert.equal(
  (await move(slow.game.code, { type: "settings", turnSeconds: 200 }))
    .turnSeconds,
  200,
);
writeFileSync(
  ".sites-runtime/base-updates-api-results.json",
  JSON.stringify(
    {
      code,
      passed: true,
      setupSeconds: 30,
      rollSeconds: 5,
      turnSeconds: 15,
      rollCount: initialRolls + 1,
      slowTimer: 200,
    },
    null,
    2,
  ),
);
console.log(
  "PASS: normal HTTP settings, real finite setup/dice/action deadlines, single automatic roll, late-click rejection, public-only crowns and 200-second selection.",
);
