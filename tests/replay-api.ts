import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { actor, type Game, type View } from "../lib/game";
import { assertFinishedReplay } from "./replay-assertions";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const directory = resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject"),
  file = readdirSync(directory).find((file) =>
    /^[a-f0-9]{64}\.sqlite$/.test(file),
  )!;
const db = new DatabaseSync(join(directory, file));
function raw(code: string): Game {
  return JSON.parse(
    (
      db.prepare("SELECT state FROM rooms WHERE code = ?").get(code) as {
        state: string;
      }
    ).state,
  );
}
class Session {
  cookie = "";
  async request(path: string, body?: unknown, originHeader = origin) {
    const r = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body
          ? { "Content-Type": "application/json", Origin: originHeader }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const cookie = r.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    return {
      status: r.status,
      data: (await r.json()) as { game: View; share: string; error?: string },
      headers: r.headers,
    };
  }
  async room(body: unknown) {
    const r = await this.request("/api/rooms", body);
    assert.equal(r.status, 200, r.data.error);
    return r.data.game;
  }
  move(code: string, action: unknown, nonce = crypto.randomUUID()) {
    return this.room({ op: "action", code, action, nonce });
  }
}
const host = new Session(),
  guest = new Session(),
  outsider = new Session();
let game = await host.room({
  op: "create",
  name: "Replay Host",
  capacity: 2,
  mode: "duel",
  public: false,
});
const code = game.code;
await guest.room({ op: "join", code, name: "Replay Guest" });
await guest.move(code, { type: "ready" });
game = await host.move(code, { type: "start" });
const id = raw(code).statistics!.id;
assert.equal((await host.request(`/api/replays?match=${id}`)).status, 404);
assert.equal((await host.request("/api/replays", { match: id })).status, 404);
assert.equal(game.statistics, null);
while (game.phase.startsWith("setup")) {
  const p = actor(raw(code)),
    type = game.phase === "setupSettlement" ? "settlement" : "road";
  game = (await [host, guest][p].request(`/api/rooms?code=${code}`)).data.game;
  game = await [host, guest][p].move(code, {
    type,
    id: type === "settlement" ? game.legal.settlement[0] : game.legal.road[0],
  });
}
const nonce = crypto.randomUUID();
game = await host.move(code, { type: "resign" }, nonce);
const final = raw(code);
await assertFinishedReplay(origin, host.cookie, final);
const owner = await host.request(`/api/replays?match=${id}`),
  participant = await guest.request(`/api/replays?match=${id}`);
assert.equal(owner.status, 200);
assert.equal(participant.status, 200);
assert.deepEqual(participant.data, owner.data);
assert.equal(owner.headers.get("cache-control"), "no-store");
assert.equal((await outsider.request(`/api/replays?match=${id}`)).status, 404);
assert.equal(
  (await outsider.request("/api/replays", { match: id })).status,
  404,
);
assert.equal(
  (await host.request("/api/replays", { match: id }, "https://wrong.example"))
    .status,
  403,
);
for (const query of [
  "match=bad",
  `match=${id}&share=${id}`,
  `match=${id}&after=-1`,
  `match=${id}&after=x`,
  `match=${id}&after=${final.replaySequence + 1}`,
])
  assert.equal((await host.request(`/api/replays?${query}`)).status, 400);
assert.equal(
  (
    await fetch(`${origin}/api/replays`, {
      method: "POST",
      headers: { Cookie: host.cookie, Origin: origin },
      body: "{",
    })
  ).status,
  400,
);
const shared = await Promise.all([
  host.request("/api/replays", { match: id }),
  guest.request("/api/replays", { match: id }),
]);
assert(shared.every((r) => r.status === 200));
assert.equal(shared[0].data.share, shared[1].data.share);
const token = shared[0].data.share;
assert.notEqual(token, id);
const publicReplay = await outsider.request(`/api/replays?share=${token}`);
assert.equal(publicReplay.status, 200);
assert.deepEqual(publicReplay.data, owner.data);
await host.move(code, { type: "resign" }, nonce);
assert.deepEqual(
  (await host.request(`/api/replays?match=${id}`)).data,
  owner.data,
);
await host.room({ op: "rematch", code });
assert.deepEqual(
  (await outsider.request(`/api/replays?share=${token}`)).data,
  owner.data,
);
assert.equal(raw(code).statistics, null);
assert.equal(raw(code).replaySequence, 0);
assert.equal(raw(code).replayComplete, false);
console.log(
  JSON.stringify({
    proof: "replay permissions and sharing",
    code,
    match: id,
    share: token,
    frames: final.replaySequence,
    winner: final.winner,
  }),
);
db.close();
console.log(
  "PASS: private completed replay, live denial, outsider denial, participant reads, share race, independent share token, invalid queries, origin checks, duplicate receipt and immutable rematch.",
);
