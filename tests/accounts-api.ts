import assert from "node:assert/strict";
import { accountRead } from "../lib/account-store";
import { api, storageClient } from "../lib/convex-client";

import type { Action, View } from "../lib/game";
import type { AccountProfile, ProfileStats } from "../lib/account-types";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173",
  endpoint = new URL(origin);
assert(
  endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(endpoint.hostname),
);
const suffix = crypto.randomUUID().slice(0, 8),
  username = `acct_${suffix}`,
  password = `Test passphrase 🐢 ${suffix}`,
  replacement = `New passphrase 🐢 ${suffix}`;
// The local Worker has no real edge IP. Isolate this suite's network bucket;
// per-username limits still exercise real persistent production logic.
const testNetwork = `192.0.2.${1 + Math.floor(Math.random() * 253)}`;
type Data = {
  error?: string;
  account: AccountProfile | null;
  stats: ProfileStats;
  recovery: string;
  game: View;
  matches: { id: string }[];
  sessions: number;
  guestGames: number;
  guestSeats: number;
  share: string;
};
class Session {
  jar = new Map<string, string>();
  async request(
    path: string,
    body?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        "CF-Connecting-IP": testNetwork,
        Cookie: [...this.jar]
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";"),
        i = pair.indexOf("=");
      this.jar.set(pair.slice(0, i), pair.slice(i + 1));
      if (/Max-Age=0(?:;|$)/.test(cookie)) this.jar.delete(pair.slice(0, i));
    }
    if (response.headers.get("cache-control") !== "no-store")
      throw new Error(
        `Unexpected HTTP ${response.status}: ${await response.text()}`,
      );
    return {
      status: response.status,
      data: (await response.json()) as Data,
      headers: response.headers,
    };
  }
  async ok(path: string, body?: Record<string, unknown>) {
    const r = await this.request(path, body);
    assert(r.status === 200 || r.status === 201, r.data.error);
    return r.data;
  }
  async room(body: Record<string, unknown>) {
    return (await this.ok("/api/rooms", body)).game;
  }
  move(code: string, action: Action, nonce = crypto.randomUUID()) {
    return this.room({ op: "action", code, action, nonce });
  }
  snapshot() {
    const s = new Session();
    s.jar = new Map(this.jar);
    return s;
  }
}
const owner = new Session(),
  opponent = new Session(),
  otherBrowser = new Session(),
  outsider = new Session();
let game = await owner.room({
  op: "create",
  name: "Pre-account Host",
  capacity: 2,
  mode: "duel",
  public: false,
});
const code = game.code;
await opponent.room({ op: "join", code, name: "Other human" });
const preAccount = owner.snapshot();
const registration = await owner.request("/api/accounts", {
  op: "register",
  username: username.toUpperCase(),
  displayName: "Account Host",
  password,
});
assert.equal(registration.status, 201, registration.data.error);
assert.equal(registration.data.account!.username, username);
assert.match(registration.data.recovery, /^[a-f0-9]{64}$/);
let recovery = registration.data.recovery;
assert(
  registration.headers
    .getSetCookie()
    .some((c) => /island_account=.*HttpOnly; SameSite=Lax; Path=\//.test(c)),
);
assert.equal((await owner.ok(`/api/rooms?code=${code}`)).game.me, 0);
assert.equal(
  (await preAccount.ok(`/api/rooms?code=${code}`)).game.me,
  -1,
  "Claimed guest cookie cannot bypass account sign-in",
);
assert.equal(
  (
    await outsider.request("/api/accounts", {
      op: "register",
      username,
      password,
    })
  ).status,
  409,
);
assert.equal(
  (
    await outsider.request("/api/accounts", {
      op: "login",
      username,
      password: "wrong password",
    })
  ).status,
  401,
);
assert.equal(
  (
    await outsider.request("/api/accounts", {
      op: "login",
      username: `absent_${suffix}`,
      password: "wrong password",
    })
  ).status,
  401,
);
assert.equal(
  (
    await outsider.request("/api/accounts", {
      op: "register",
      username: `short_${suffix}`,
      password: "short",
    })
  ).status,
  400,
);
assert.equal(
  (
    await owner.request("/api/accounts", {
      op: "profile",
      displayName: "Bad",
      bio: "",
      color: 99,
    })
  ).status,
  400,
);
assert.equal(
  (
    await owner.request(
      "/api/accounts",
      { op: "profile", displayName: "Bad", bio: "", color: 0 },
      { Origin: "https://foreign.example" },
    )
  ).status,
  403,
);
await otherBrowser.ok("/api/accounts", { op: "login", username, password });
assert.equal((await otherBrowser.ok(`/api/rooms?code=${code}`)).game.me, 0);
await opponent.move(code, { type: "ready" });
game = await otherBrowser.move(code, { type: "start" });
const nonce = crypto.randomUUID();
game = await owner.move(code, { type: "resign" }, nonce);
assert.equal(game.winner, 1);
assert(game.statistics);
const match = game.statistics.id;
assert.equal((await otherBrowser.ok("/api/matches")).matches[0].id, match);
assert.equal(
  (await otherBrowser.request(`/api/replays?match=${match}`)).status,
  200,
);
assert.equal(
  (await preAccount.request(`/api/replays?match=${match}`)).status,
  404,
);
assert.equal(
  (await owner.move(code, { type: "resign" }, nonce)).statistics!.id,
  match,
);
let overview = await owner.ok("/api/accounts");
assert.equal(overview.stats.games, 1);
assert.equal(overview.stats.wins, 0);
assert.equal(overview.stats.trackedGames, 1);
assert.equal(overview.sessions, 2);
await owner.ok("/api/accounts", {
  op: "profile",
  displayName: "Renamed Host",
  bio: "<script> stays plain text",
  color: 3,
});
const profile = await outsider.ok(
  `/api/accounts?username=${username.toUpperCase()}`,
);
assert.equal(profile.account!.displayName, "Renamed Host");
assert.equal(profile.account!.bio, "<script> stays plain text");
assert.equal(profile.account!.color, 3);
assert.deepEqual(profile.stats, overview.stats);
for (const forbidden of [
  "id",
  "password_hash",
  "recovery_hash",
  "player_id",
  "tokenHash",
  "aliases",
])
  assert(!(forbidden in profile.account!));
assert.equal(
  (
    await outsider.request("/api/accounts", {
      op: "profile",
      displayName: "Attacker",
      bio: "",
      color: 0,
    })
  ).status,
  401,
);
assert.equal(
  (await owner.ok(`/api/matches?match=${match}`)).game.players[0].name,
  "Pre-account Host",
  "Archived names remain immutable",
);
const colorRoom = await owner.room({
  op: "create",
  name: "Preferred Color",
  capacity: 3,
  mode: "base",
});
assert.equal(colorRoom.players[0].color, 3);
const colorGuest = new Session();
await colorGuest.ok("/api/accounts", {
  op: "register",
  username: `color_${suffix}`,
  password,
});
await colorGuest.ok("/api/accounts", {
  op: "profile",
  displayName: "Color Guest",
  bio: "",
  color: 3,
});
const colorJoined = await colorGuest.room({
  op: "join",
  code: colorRoom.code,
  name: "Color Guest",
});
assert.notEqual(colorJoined.players[1].color, 3);
assert.equal(
  new Set(colorJoined.players.map((p) => p.color)).size,
  2,
  "Preferred colors never duplicate an occupied color",
);
const overlappingGuest = new Session();
const overlapJoined = await overlappingGuest.room({
  op: "join",
  code: colorRoom.code,
  name: "Unimported Guest",
});
assert.equal(overlapJoined.me, 2);
await overlappingGuest.ok("/api/accounts", { op: "login", username, password });
assert.equal(
  (await overlappingGuest.request("/api/accounts", { op: "import" })).status,
  409,
);
await overlappingGuest.ok("/api/accounts", { op: "logout" });
assert.equal(
  (await overlappingGuest.ok(`/api/rooms?code=${colorRoom.code}`)).game.me,
  2,
  "Sign-out preserves an unclaimed guest cookie and its seat",
);
await overlappingGuest.room({ op: "leave", code: colorRoom.code });
await owner.room({ op: "rematch", code });
const roomAfterRematch = await otherBrowser.ok(`/api/rooms?code=${code}`);
assert.equal(roomAfterRematch.game.me, 0);
assert.equal(
  (await otherBrowser.request(`/api/replays?match=${match}`)).status,
  200,
);
const beforeLogout = owner.snapshot();
await owner.ok("/api/accounts", { op: "logout" });
assert.equal((await beforeLogout.ok("/api/accounts")).account, null);
assert.equal((await owner.ok(`/api/rooms?code=${code}`)).game.me, -1);
assert((await owner.ok("/api/matches")).matches.every((m) => m.id !== match));
assert.equal(
  (await otherBrowser.ok("/api/accounts")).account!.username,
  username,
);
await owner.ok("/api/accounts", { op: "login", username, password });
// This browser's pre-existing guest match can be imported without rewriting
// completed results or active room IDs. Other accounts cannot steal it.
const importBrowser = new Session(),
  importOpponent = new Session();
let imported = await importBrowser.room({
  op: "create",
  name: "Import Host",
  capacity: 2,
  mode: "duel",
});
const importCode = imported.code;
await importOpponent.room({
  op: "join",
  code: importCode,
  name: "Import Opponent",
});
await importOpponent.move(importCode, { type: "ready" });
await importBrowser.move(importCode, { type: "start" });
imported = await importOpponent.move(importCode, { type: "resign" });
const importMatch = imported.statistics!.id;
const oldImportGuest = importBrowser.snapshot();
await importBrowser.ok("/api/accounts", { op: "login", username, password });
assert.equal((await importBrowser.ok("/api/accounts")).guestGames, 1);
assert.equal(
  (await importBrowser.request(`/api/replays?match=${importMatch}`)).status,
  404,
);
await importBrowser.ok("/api/accounts", { op: "import" });
assert.equal((await owner.ok(`/api/rooms?code=${importCode}`)).game.me, 0);
assert.equal(
  (await otherBrowser.request(`/api/replays?match=${importMatch}`)).status,
  200,
);
assert.equal(
  (await oldImportGuest.request(`/api/replays?match=${importMatch}`)).status,
  404,
);
overview = await owner.ok("/api/accounts");
assert.equal(overview.stats.games, 2);
assert.equal(overview.stats.wins, 1);
assert.equal(overview.stats.trackedGames, 2);
const share = await otherBrowser.ok("/api/replays", { match: importMatch });
assert.equal(
  (await outsider.request(`/api/replays?share=${share.share}`)).status,
  200,
);
const liveImportBrowser = new Session();
const liveImportRoom = await liveImportBrowser.room({
  op: "create",
  name: "Live guest seat",
  capacity: 3,
  mode: "base",
});
await liveImportBrowser.ok("/api/accounts", {
  op: "login",
  username,
  password,
});
const liveOverview = await liveImportBrowser.ok("/api/accounts");
assert.equal(liveOverview.guestGames, 0);
assert.equal(liveOverview.guestSeats, 1);
await liveImportBrowser.ok("/api/accounts", { op: "import" });
assert.equal(
  (await owner.ok(`/api/rooms?code=${liveImportRoom.code}`)).game.me,
  0,
);
// Changed passwords and one-time recovery codes revoke existing sessions.
const priorOwner = owner.snapshot(),
  priorOther = otherBrowser.snapshot();
const changed = await owner.ok("/api/accounts", {
  op: "password",
  currentPassword: password,
  password: replacement,
});
assert.notEqual(changed.recovery, recovery);
recovery = changed.recovery;
assert.equal((await priorOwner.ok("/api/accounts")).account, null);
assert.equal((await priorOther.ok("/api/accounts")).account, null);
assert.equal((await importBrowser.ok("/api/accounts")).account, null);
assert.equal(
  (
    await otherBrowser.request("/api/accounts", {
      op: "login",
      username,
      password,
    })
  ).status,
  401,
);
await otherBrowser.ok("/api/accounts", {
  op: "login",
  username,
  password: replacement,
});
assert.equal(
  (
    await outsider.request("/api/accounts", {
      op: "reset",
      username,
      recovery: registration.data.recovery,
      password,
    })
  ).status,
  401,
);
const priorChanged = owner.snapshot();
const recovered = await outsider.ok("/api/accounts", {
  op: "reset",
  username,
  recovery,
  password,
});
assert.notEqual(recovered.recovery, recovery);
assert.equal((await priorChanged.ok("/api/accounts")).account, null);
assert.equal((await otherBrowser.ok("/api/accounts")).account, null);
assert.equal((await outsider.ok(`/api/rooms?code=${code}`)).game.me, 0);
assert.equal(
  (
    await owner.request("/api/accounts", {
      op: "reset",
      username,
      recovery,
      password,
    })
  ).status,
  401,
);
const rotated = await outsider.ok("/api/accounts", {
  op: "recovery",
  currentPassword: password,
});
assert.notEqual(rotated.recovery, recovered.recovery);
const racer1 = new Session(),
  racer2 = new Session();
const resets = await Promise.all([
  racer1.request("/api/accounts", {
    op: "reset",
    username,
    recovery: rotated.recovery,
    password: replacement,
  }),
  racer2.request("/api/accounts", {
    op: "reset",
    username,
    recovery: rotated.recovery,
    password: replacement,
  }),
]);
assert.deepEqual(resets.map((r) => r.status).sort(), [200, 401]);
const winner = resets[0].status === 200 ? racer1 : racer2;
assert.equal((await winner.ok("/api/accounts")).sessions, 1);
await owner.ok("/api/accounts", {
  op: "login",
  username,
  password: replacement,
});
await winner.ok("/api/accounts", { op: "logoutAll" });
assert.equal((await owner.ok("/api/accounts")).account, null);
// Read-only inspection confirms secrets are hashed and revocation persists.
const stored = (await accountRead("byUsername", { username })) as {
  id: string;
  password_hash: string;
  recovery_hash: string;
  player_id: string;
};
assert.match(stored.password_hash, /^scrypt\$16384\$8\$5\$/);
assert(!stored.password_hash.includes(replacement));
assert.notEqual(stored.recovery_hash, rotated.recovery);
assert.equal(await accountRead("sessionCount", { id: stored.id }), 0);
// Rate limiting is durable and malformed requests never become server errors.
for (let i = 0; i < 21; i++) {
  const r = await owner.request("/api/accounts", {
    op: "login",
    username: `limit_${suffix}`,
    password: "invalid",
  });
  assert.equal(r.status, i < 20 ? 401 : 429);
}
assert.equal(
  (
    await owner.request(
      `/api/accounts?username=${encodeURIComponent("<script>")}`,
    )
  ).status,
  400,
);
const malformed = await fetch(origin + "/api/accounts", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: "{",
});
assert.equal(malformed.status, 400);
console.log(
  "PASS: account adoption, cross-browser seats/history/private replays, immutable profiles/results, explicit guest imports, original-cookie denial, logout, password/recovery rotation, competing resets, session revocation, hashed storage, origin/input validation and durable rate limits.",
);
