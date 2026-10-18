import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { actor, type Action, type Game, type View } from "../lib/game";
import { emptyHand } from "../lib/board";
import { chooseMove } from "./autoplay";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
assert(
  new URL(origin).protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
);
class Session {
  cookie = "";
  async request(body: Record<string, unknown> | null, code = "") {
    const r = await fetch(`${origin}/api/rooms${body ? "" : `?code=${code}`}`, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: this.cookie,
        ...(body ? { Origin: origin, "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const cookie = r.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    return {
      status: r.status,
      ...((await r.json()) as { game: View; error?: string }),
    };
  }
  async move(code: string, action: Action, nonce = crypto.randomUUID()) {
    return this.request({ op: "action", code, action, nonce });
  }
}
function strategy(v: View): Game {
  return {
    ...v,
    players: v.players.map((p) => ({
      ...p,
      id: "QA",
      hand: p.hand ?? emptyHand(),
      dev: p.dev ?? [],
    })),
    deck: Array(v.deckCount).fill("knight"),
    receipts: [],
  } as unknown as Game;
}
const seats = Array.from({ length: 8 }, () => new Session()),
  observer = new Session();
const made = await seats[0].request({
  op: "create",
  name: "Special building QA",
  capacity: 8,
  mode: "base",
  public: false,
});
assert.equal(made.status, 200, made.error);
const code = made.game.code;
const success = async (seat: number, action: Action) => {
  const r = await seats[seat].move(code, action);
  assert.equal(r.status, 200, r.error);
  return r.game;
};
assert.equal(
  (await seats[0].move(code, { type: "specialBuild", requested: true })).status,
  400,
);
for (let seat = 1; seat < 8; seat++) {
  assert.equal(
    (await seats[seat].request({ op: "join", code, name: `Flag seat ${seat}` }))
      .status,
    200,
  );
  await success(seat, { type: "ready" });
}
await success(0, { type: "settings", turnSeconds: 15 });
for (let seat = 1; seat < 8; seat++) await success(seat, { type: "ready" });
let g = await success(0, { type: "start" });
assert.equal(
  (await seats[2].move(code, { type: "specialBuild", requested: true })).status,
  400,
);
while (g.phase.startsWith("setup")) {
  const seat = actor(strategy(g));
  const own = (await seats[seat].request(null, code)).game;
  g = await success(seat, chooseMove(strategy(own), seat)!);
}
g = await success(0, { type: "roll" });
while (g.phase !== "action") {
  const seat =
    g.phase === "discard"
      ? Number(Object.keys(g.discards)[0])
      : actor(strategy(g));
  const own = (await seats[seat].request(null, code)).game;
  g = await success(seat, chooseMove(strategy(own), seat)!);
}
const deadline = g.deadline;
await Promise.all(
  [2, 4, 6].map((seat) =>
    success(seat, { type: "specialBuild", requested: true }),
  ),
);
g = (await seats[0].request(null, code)).game;
assert.equal(g.deadline, deadline);
for (let seat = 0; seat < 8; seat++) {
  const v = (await seats[seat].request(null, code)).game;
  assert.equal(v.specialRequested, [2, 4, 6].includes(seat));
  assert(!("specialRequests" in v) && !("specialQueue" in v));
}
const watch = (await observer.request(null, code)).game;
assert.equal(watch.specialRequested, false);
assert(!("specialRequests" in watch) && !("specialQueue" in watch));
assert.equal(
  (await observer.move(code, { type: "specialBuild", requested: true })).status,
  400,
);
assert.equal(
  (
    await seats[2].move(code, {
      type: "specialBuild",
      requested: "yes" as unknown as boolean,
    })
  ).status,
  400,
);
await success(4, { type: "specialBuild", requested: false });
const nonce = crypto.randomUUID();
const once = await seats[6].move(
  code,
  { type: "specialBuild", requested: true },
  nonce,
);
const twice = await seats[6].move(
  code,
  { type: "specialBuild", requested: true },
  nonce,
);
assert.equal(once.status, 200);
assert.equal(twice.game.revision, once.game.revision);
g = await success(0, { type: "end" });
assert.equal(g.phase, "special");
assert.equal(g.specialPlayer, 2);
assert.equal((await seats[2].request(null, code)).game.specialRequested, false);
assert.equal((await seats[2].move(code, { type: "knight" })).status, 400);
await success(3, { type: "specialBuild", requested: true });
g = await success(2, { type: "pass" });
assert.equal(g.specialPlayer, 3);
g = await success(3, { type: "pass" });
assert.equal(g.specialPlayer, 6);
assert(g.deadline !== null);
console.log("Waiting for the actual 15-second requested building deadline.");
await new Promise((resolve) =>
  setTimeout(resolve, Math.max(0, g.deadline! - Date.now()) + 150),
);
g = (await seats[0].request(null, code)).game;
assert.equal(g.phase, "roll");
assert.equal(g.active, 1);
assert.equal(g.specialPlayer, null);
for (const seat of [2, 3, 4, 6])
  assert.equal(
    (await seats[seat].request(null, code)).game.specialRequested,
    false,
  );
writeFileSync(
  ".sites-runtime/special-building-api-results.json",
  JSON.stringify(
    {
      code,
      passed: true,
      seats: 8,
      concurrency: 3,
      specialOrder: [2, 3, 6],
      cancelled: 4,
      turnSeconds: 15,
      actualExpiry: true,
      nextActive: g.active,
    },
    null,
    2,
  ),
);
console.log(
  "PASS: concurrent private requests, withdrawal, cyclic late joining, duplicate receipts, ownership, preserved clocks and actual requested-phase expiry.",
);
