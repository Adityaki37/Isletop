// Local verification. Normal HTTP operations only; no game or lease SQL writes.
import assert from "node:assert/strict";
import type { View } from "../lib/game";
import { TABLE_CONNECTION_TTL } from "../lib/table-presence";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
assert(
  new URL(origin).protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
);
type Data = {
  game: View;
  error?: string;
  created: number;
  connected: boolean[];
};
class Session {
  jar = new Map<string, string>();
  async request(
    path: string,
    body?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    const r = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const pair = c.split(";")[0],
        i = pair.indexOf("=");
      if (/Max-Age=0(?:;|$)/.test(c)) this.jar.delete(pair.slice(0, i));
      else this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await r.text();
    assert.equal(
      r.headers.get("cache-control"),
      "no-store",
      `${path} returned ${r.status}: ${text.slice(0, 500)}`,
    );
    return { status: r.status, data: JSON.parse(text) as Data };
  }
  async ok(path: string, body?: Record<string, unknown>) {
    const r = await this.request(path, body);
    assert([200, 201].includes(r.status), `${r.status}: ${r.data.error}`);
    return r.data;
  }
  clone() {
    const s = new Session();
    s.jar = new Map(this.jar);
    return s;
  }
  beat(g: View, token = crypto.randomUUID()) {
    return this.ok("/api/presence", {
      op: "beat",
      code: g.code,
      created: g.created,
      token,
    });
  }
  release(g: View, token: string) {
    return this.ok("/api/presence", {
      op: "release",
      code: g.code,
      created: g.created,
      token,
    });
  }
  move(
    g: View,
    action: Record<string, unknown>,
    nonce = crypto.randomUUID(),
    expectedCreated = g.created,
  ) {
    return this.ok("/api/rooms", {
      op: "action",
      code: g.code,
      action,
      nonce,
      expectedCreated,
    }).then((d) => d.game);
  }
}
const seats = Array.from({ length: 8 }, () => new Session()),
  outsider = new Session();
let g = (
  await seats[0].ok("/api/rooms", {
    op: "create",
    mode: "base",
    capacity: 8,
    name: "Connection QA",
  })
).game;
for (let i = 1; i < 8; i++)
  await seats[i].ok("/api/rooms", {
    op: "join",
    code: g.code,
    name: `Connection ${i}`,
  });
g = (await seats[0].ok(`/api/rooms?code=${g.code}`)).game;
const read = () => outsider.ok(`/api/presence?code=${g.code}`);
assert.deepEqual((await read()).connected, Array(8).fill(false));
const revision = g.revision,
  tokens = seats.map(() => crypto.randomUUID());
await Promise.all(seats.map((s, i) => s.beat(g, tokens[i])));
let presence = await read();
assert.deepEqual(presence.connected, Array(8).fill(true));
assert.deepEqual(Object.keys(presence).sort(), ["connected", "created"]);
assert.equal(
  (await seats[0].ok(`/api/rooms?code=${g.code}`)).game.revision,
  revision,
);
const secondTab = seats[0].clone(),
  extraToken = crypto.randomUUID();
await secondTab.beat(g, extraToken);
await seats[0].release(g, tokens[0]);
assert.equal((await read()).connected[0], true);
await outsider.release(g, extraToken);
assert.equal((await read()).connected[0], true);
assert.equal(
  (
    await outsider.request("/api/presence", {
      op: "beat",
      code: g.code,
      created: g.created,
      token: crypto.randomUUID(),
    })
  ).status,
  403,
);
assert.equal(
  (
    await seats[1].request("/api/presence", {
      op: "beat",
      code: g.code,
      created: g.created,
      token: extraToken,
    })
  ).status,
  403,
);
assert.equal(
  (
    await seats[0].request("/api/presence", {
      op: "beat",
      code: g.code,
      created: g.created - 1,
      token: crypto.randomUUID(),
    })
  ).status,
  409,
);
assert.equal(
  (
    await seats[0].request("/api/presence", {
      op: "beat",
      code: g.code,
      created: g.created,
      token: "bad",
    })
  ).status,
  400,
);
assert.equal(
  (
    await seats[0].request(
      "/api/presence",
      {
        op: "beat",
        code: g.code,
        created: g.created,
        token: crypto.randomUUID(),
      },
      { Origin: "https://example.com" },
    )
  ).status,
  403,
);
const username = `connection_${crypto.randomUUID().slice(0, 8)}`,
  password = `Connection testing passphrase ${crypto.randomUUID()}`;
const oldGuest = seats[0].clone();
await seats[0].ok("/api/accounts", { op: "register", username, password });
assert.equal(
  (await read()).connected[0],
  false,
  "A claimed guest lease no longer announces an account",
);
await seats[0].beat(g, extraToken);
assert.equal((await read()).connected[0], true);
assert.equal(
  (
    await oldGuest.request("/api/presence", {
      op: "beat",
      code: g.code,
      created: g.created,
      token: crypto.randomUUID(),
    })
  ).status,
  403,
);
const accountBrowser = new Session();
await accountBrowser.ok("/api/accounts", { op: "login", username, password });
await accountBrowser.beat(g, crypto.randomUUID());
await seats[0].ok("/api/accounts", { op: "logout" });
assert.equal(
  (await read()).connected[0],
  true,
  "Another valid account session keeps the seat connected",
);
await accountBrowser.ok("/api/accounts", { op: "logoutAll" });
assert.equal((await read()).connected[0], false);
await accountBrowser.ok("/api/accounts", { op: "login", username, password });
seats[0] = accountBrowser;
// Import a separate guest seat to verify aliases use the saved seat identity.
const alias = new Session();
const aliasRoom = (
  await alias.ok("/api/rooms", {
    op: "create",
    capacity: 3,
    name: "Alias connection",
  })
).game;
await alias.ok("/api/accounts", { op: "login", username, password });
await alias.ok("/api/accounts", { op: "import" });
await alias.beat(aliasRoom);
assert.deepEqual(
  (await outsider.ok(`/api/presence?code=${aliasRoom.code}`)).connected,
  [true],
);
// A lobby removal changes seat indexes but cannot transfer another player's lease.
await seats[0].move(g, { type: "remove", id: 2 });
presence = await read();
assert.equal(presence.connected.length, 7);
assert.equal(presence.connected[1], true);
assert.equal(
  (
    await seats[2].request("/api/presence", {
      op: "beat",
      code: g.code,
      created: g.created,
      token: tokens[2],
    })
  ).status,
  403,
);
console.log(
  `Waiting for the actual ${TABLE_CONNECTION_TTL / 1000}-second connection leases to expire…`,
);
await new Promise((resolve) =>
  setTimeout(resolve, TABLE_CONNECTION_TTL + 1500),
);
assert.deepEqual((await read()).connected, Array(7).fill(false));
assert.equal(
  (await seats[0].ok(`/api/rooms?code=${g.code}`)).game.revision,
  revision + 1,
  "Connection expiry never advances a game revision",
);
await seats[1].beat(g, crypto.randomUUID());
assert.equal((await read()).connected[1], true);
// A legitimate finished game and rematch must reject old move retries and leases.
const duel = [new Session(), new Session()];
let d = (
  await duel[0].ok("/api/rooms", {
    op: "create",
    capacity: 2,
    name: "Retry generation",
  })
).game;
await duel[1].ok("/api/rooms", { op: "join", code: d.code, name: "Opponent" });
await duel[1].move(d, { type: "ready" });
d = await duel[0].move(d, { type: "start" });
const oldCreated = d.created,
  nonce = crypto.randomUUID(),
  duelToken = crypto.randomUUID();
await duel[0].beat(d, duelToken);
d = await duel[1].move(d, { type: "resign" }, nonce);
assert.equal(d.phase, "finished");
d = (await duel[0].ok("/api/rooms", { op: "rematch", code: d.code })).game;
assert.notEqual(d.created, oldCreated);
assert.deepEqual(
  (await outsider.ok(`/api/presence?code=${d.code}`)).connected,
  [false, false],
);
assert.equal(
  (
    await duel[0].request("/api/presence", {
      op: "beat",
      code: d.code,
      created: oldCreated,
      token: duelToken,
    })
  ).status,
  409,
);
assert.equal(
  (
    await duel[1].request("/api/rooms", {
      op: "action",
      code: d.code,
      action: { type: "ready" },
      nonce,
      expectedCreated: oldCreated,
    })
  ).status,
  400,
);
assert.equal(
  (await duel[0].ok(`/api/rooms?code=${d.code}`)).game.revision,
  d.revision,
);
const retryNonce = crypto.randomUUID();
const ready = await duel[1].move(d, { type: "ready" }, retryNonce);
const again = await duel[1].move(d, { type: "ready" }, retryNonce);
assert.equal(again.revision, ready.revision);
assert.equal(again.players[1].ready, true);
console.log(
  "PASS: eight owned connections, read privacy, multiple tabs, foreign lease denial, adoption/alias ownership, session revocation, seat removal, actual expiry, rematch generations and idempotent move retries.",
);
