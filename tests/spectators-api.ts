import assert from "node:assert/strict";
import { accountRead } from "../lib/account-store";
import { api, storageClient } from "../lib/convex-client";

import type { SpectatorPage } from "../lib/spectator-types";
import type { View } from "../lib/game";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
assert(
  new URL(origin).protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
);
const suffix = crypto.randomUUID().slice(0, 8),
  password = `Spectator verification password ${suffix}`;
type Result = SpectatorPage & {
  game: View;
  name: string;
  viewerId: string;
  error?: string;
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
        "CF-Connecting-IP": "192.0.2.187",
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
    assert.equal(r.headers.get("cache-control"), "no-store");
    return { status: r.status, data: (await r.json()) as Result };
  }
  async ok(path: string, body?: Record<string, unknown>) {
    const r = await this.request(path, body);
    assert(
      r.status === 200 || r.status === 201,
      `${r.status}: ${r.data.error}`,
    );
    return r.data;
  }
  room(body: Record<string, unknown>) {
    return this.ok("/api/rooms", body).then((d) => d.game);
  }
  watch(g: View, token = crypto.randomUUID(), name?: string) {
    return this.ok("/api/spectators", {
      op: "watch",
      code: g.code,
      created: g.created,
      token,
      ...(name === undefined ? {} : { name }),
    });
  }
  unwatch(g: View, token: string) {
    return this.ok("/api/spectators", {
      op: "unwatch",
      code: g.code,
      created: g.created,
      token,
    });
  }
  roster(g: View, cursor = 0) {
    return this.ok(`/api/spectators?code=${g.code}&cursor=${cursor}`);
  }
  clone() {
    const s = new Session();
    s.jar = new Map(this.jar);
    return s;
  }
}
const host = new Session(),
  guest = new Session(),
  stranger = new Session();
const g = await host.room({
  op: "create",
  name: "Spectator QA",
  capacity: 8,
  public: false,
});
const revision = g.revision;
assert.equal((await stranger.roster(g)).count, 0);
await stranger.ok(`/api/rooms?code=${g.code}`);
assert.equal(
  (await stranger.roster(g)).count,
  0,
  "Reading rooms/history does not announce live viewing",
);
const t = crypto.randomUUID(),
  t2 = crypto.randomUUID();
const mine = await guest.watch(g, t, "Viewer 🐢 <script>");
const secondTab = guest.clone();
await secondTab.watch(g, t2);
let page = await stranger.roster(g);
assert.equal(page.count, 1);
assert.equal(page.spectators[0].name, "Viewer 🐢 <script>");
// New connections inherit the default name unless a guest explicitly renames
// all its connections; each canonical viewer still contributes exactly once.
await guest.watch(g, t, "Viewer 🐢 <script>");
page = await stranger.roster(g);
assert.equal(page.spectators[0].name, "Viewer 🐢 <script>");
assert.equal(page.spectators[0].username, null);
assert.equal(page.spectators[0].id, mine.viewerId);
await host.watch(g);
assert.equal((await stranger.roster(g)).count, 1, "Seated players never count");
await stranger.unwatch(g, t);
assert.equal(
  (await stranger.roster(g)).count,
  1,
  "Another browser cannot stop a viewer",
);
assert.equal(
  (
    await stranger.request("/api/spectators", {
      op: "watch",
      code: g.code,
      created: g.created,
      token: t,
    })
  ).status,
  403,
);
assert.equal(
  (
    await guest.request("/api/spectators", {
      op: "watch",
      code: g.code,
      created: g.created - 1,
      token: t,
    })
  ).status,
  409,
);
assert.equal(
  (
    await guest.request("/api/spectators", {
      op: "watch",
      code: g.code,
      created: g.created,
      token: t,
      name: "x".repeat(25),
    })
  ).status,
  400,
);
assert.equal(
  (
    await guest.request(
      "/api/spectators",
      { op: "watch", code: g.code, created: g.created, token: t },
      { Origin: "https://foreign.invalid" },
    )
  ).status,
  403,
);
assert.equal(
  (await stranger.request(`/api/spectators?code=${g.code}&cursor=NaN`)).status,
  400,
);
assert.equal(
  (await stranger.request(`/api/spectators?code=AAAAAA`)).status,
  404,
);
for (const [body, status] of [
  ["{", 400],
  ["[]", 400],
  ["null", 400],
  [JSON.stringify({ x: "x".repeat(2100) }), 413],
] as const) {
  const response = await fetch(origin + "/api/spectators", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body,
  });
  assert.equal(response.status, status, await response.text());
  assert.equal(response.headers.get("cache-control"), "no-store");
}
await guest.unwatch(g, t);
assert.equal(
  (await stranger.roster(g)).count,
  1,
  "Closing one of two tabs preserves the viewer",
);
await secondTab.unwatch(g, t2);
assert.equal((await stranger.roster(g)).count, 0);
await guest.watch(g, t, "Joinable guest");
await guest.room({ op: "join", code: g.code, name: "Joined seat" });
assert.equal(
  (await stranger.roster(g)).count,
  0,
  "Joining a seat immediately excludes old watcher leases",
);
await guest.room({ op: "leave", code: g.code });
await guest.unwatch(g, t);
assert.equal(
  (await host.ok(`/api/rooms?code=${g.code}`)).game.revision,
  revision + 2,
  "Only join/leave changed game revisions",
);

const account = new Session(),
  otherBrowser = new Session();
const username = `watch_${suffix}`;
await account.ok("/api/accounts", {
  op: "register",
  username,
  displayName: "Registered viewer",
  password,
});
await otherBrowser.ok("/api/accounts", { op: "login", username, password });
const a = crypto.randomUUID(),
  b = crypto.randomUUID();
await Promise.all([
  account.watch(g, a, "Forged display"),
  otherBrowser.watch(g, b),
]);
page = await stranger.roster(g);
assert.equal(page.count, 1);
assert.equal(page.spectators[0].name, "Registered viewer");
assert.equal(page.spectators[0].username, username);
await account.ok("/api/accounts", {
  op: "profile",
  displayName: "Updated viewer",
  bio: "",
  color: 5,
});
page = await stranger.roster(g);
assert.equal(page.spectators[0].name, "Updated viewer");
assert.equal(page.spectators[0].color, 5);
await account.ok("/api/social", { op: "preferences", showPresence: false });
assert.equal(
  (await stranger.roster(g)).count,
  1,
  "Friend presence privacy does not hide an explicitly announced table viewer",
);
const revoked = account.clone();
await account.ok("/api/accounts", { op: "logout" });
assert.equal(
  (await stranger.roster(g)).count,
  1,
  "The other valid account session remains watching",
);
await otherBrowser.unwatch(g, b);

const loginGuest = new Session(),
  loginToken = crypto.randomUUID();
await loginGuest.watch(g, loginToken, "Pre-login guest");
const loginCookie = loginGuest.jar.get("island_session");
await loginGuest.ok("/api/accounts", { op: "login", username, password });
assert.equal(loginGuest.jar.get("island_session"), loginCookie);
const loginWatch = await loginGuest.watch(g, loginToken);
assert.equal(loginWatch.name, "Updated viewer");
assert.equal(
  (await stranger.roster(g)).count,
  1,
  "An owned pre-login connection transfers to the canonical account without a duplicate guest",
);
await loginGuest.ok("/api/accounts", { op: "login", username, password });
await loginGuest.watch(g, loginToken);
await loginGuest.ok("/api/accounts", { op: "logout" });
assert.equal(
  (await stranger.roster(g)).count,
  0,
  "A renewed connection follows its latest session, even while the superseded session remains valid",
);
await loginGuest.unwatch(g, loginToken);
assert.equal(
  (await stranger.roster(g)).count,
  0,
  "A revoked session lease is excluded immediately",
);
const revokedWatch = await revoked.watch(g, a);
assert(revokedWatch.name.startsWith("Guest "));
assert.equal(
  (await stranger.roster(g)).spectators[0].username,
  null,
  "Revoked cookies cannot renew an account identity; viewing falls back to a fresh guest",
);
await revoked.unwatch(g, a);
await otherBrowser.watch(g, b);
await otherBrowser.room({ op: "join", code: g.code, name: "Account seat" });
assert.equal((await stranger.roster(g)).count, 0);
await otherBrowser.room({ op: "leave", code: g.code });
await otherBrowser.unwatch(g, b);

const adopted = new Session();
const adoptedRoom = await adopted.room({
  op: "create",
  name: "Guest seat adoption",
  capacity: 4,
  public: false,
});
await adopted.ok("/api/accounts", {
  op: "register",
  username: `linked_${suffix}`,
  displayName: "Linked owner",
  password,
});
await adopted.watch(adoptedRoom);
assert.equal(
  (await stranger.roster(adoptedRoom)).count,
  0,
  "Linked guest seats exclude the canonical account",
);
const claimedGuest = adopted.clone();
claimedGuest.jar.delete("island_account");
const rotated = await claimedGuest.watch(adoptedRoom);
assert.equal(
  (await stranger.roster(adoptedRoom)).count,
  1,
  "A claimed guest cookie rotates to a new independent guest",
);
assert.equal(
  (await claimedGuest.ok(`/api/rooms?code=${adoptedRoom.code}`)).game.me,
  -1,
);
assert(rotated.name.startsWith("Guest "));

const chatRoom = await host.room({
  op: "create",
  name: "Readonly chat QA",
  capacity: 4,
  public: false,
});
await host.room({
  op: "action",
  code: chatRoom.code,
  nonce: crypto.randomUUID(),
  action: { type: "chat", text: "Public table message 🐢 <script>" },
});
const chatView = (await stranger.ok(`/api/rooms?code=${chatRoom.code}`)).game;
assert.equal(chatView.me, -1);
assert.equal(chatView.chat.at(-1)?.text, "Public table message 🐢 <script>");
assert(chatView.players.every((p) => !p.hand && !p.dev));
assert.equal(
  (
    await stranger.request("/api/rooms", {
      op: "action",
      code: chatRoom.code,
      nonce: crypto.randomUUID(),
      action: { type: "chat", text: "Unauthorized reply" },
    })
  ).status,
  400,
);
assert.equal(
  (await host.ok(`/api/rooms?code=${chatRoom.code}`)).game.chat.length,
  chatView.chat.length,
);

// Page boundaries exercise the actual HTTP endpoint, not inserted fixtures.
const pagingRoom = await host.room({
  op: "create",
  name: "Roster pages",
  capacity: 4,
  public: false,
});
const visitors: Session[] = [];
for (let i = 0; i < 103; i++) {
  const v = new Session();
  await v.watch(pagingRoom, crypto.randomUUID(), `Page viewer ${i}`);
  visitors.push(v);
}
page = await stranger.roster(pagingRoom);
assert.equal(page.count, 103);
assert.equal(page.spectators.length, 100);
assert.equal(page.next, 100);
const last = await stranger.roster(pagingRoom, page.next!);
assert.equal(last.spectators.length, 3);
assert.equal(last.next, null);
assert.equal(
  new Set([...page.spectators, ...last.spectators].map((v) => v.id)).size,
  103,
);
const serialized = JSON.stringify(page);
for (const key of [
  "player_id",
  "account_id",
  "session_hash",
  "viewer_key",
  "token",
  "hand",
  "deck",
  "diceState",
  "receipts",
])
  assert(!serialized.includes(`"${key}"`), key);
const row = (await accountRead("byUsername", { username })) as {
  id: string;
  player_id: string;
};
const accountJson = JSON.stringify(await stranger.roster(g));
assert(!accountJson.includes(row.id));
assert(!accountJson.includes(row.player_id));
const expiryRoom = await host.room({
  op: "create",
  name: "Real expiry",
  capacity: 4,
  public: false,
});
const disconnected = new Session();
await disconnected.watch(expiryRoom);
assert.equal((await stranger.roster(expiryRoom)).count, 1);
const lease = (await storageClient().query(api.inspection.read, {
  op: "spectatorLease",
  key: expiryRoom.code,
})) as { joined_at: number; expires_at: number };
assert.equal(lease.expires_at - lease.joined_at, 90000);
console.log(
  "PASS: identity, multi-tab/session deduplication, revocation, seat/alias exclusion, chat ownership, no revision changes, roster pagination and private projection. Waiting 95 real seconds for abandoned-viewer expiry.",
);
await new Promise((resolve) => setTimeout(resolve, 95000));
assert.equal((await stranger.roster(expiryRoom)).count, 0);

console.log(
  "PASS: actual 90-second spectator lease expiry without clock edits or SQL writes.",
);
