import assert from "node:assert/strict";
import { accountRead } from "../lib/account-store";
import { api, storageClient } from "../lib/convex-client";

import type {
  SocialOverview,
  SocialLookup,
  SocialRoom,
} from "../lib/social-types";
import type { View } from "../lib/game";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
assert(
  new URL(origin).protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
);
const suffix = crypto.randomUUID().slice(0, 8),
  password = `Social verification password ${suffix}`,
  network = `192.0.2.${1 + Math.floor(Math.random() * 253)}`;
type Data = SocialOverview &
  SocialLookup & {
    game: View;
    room: SocialRoom;
    error?: string;
    account: { username: string } | null;
  };
class Session {
  jar = new Map<string, string>();
  username = "";
  async request(
    path: string,
    body?: Record<string, unknown>,
    extra: Record<string, string> = {},
  ) {
    const response = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        "CF-Connecting-IP": network,
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of response.headers.getSetCookie()) {
      const [pair] = c.split(";"),
        i = pair.indexOf("=");
      if (/Max-Age=0(?:;|$)/.test(c)) this.jar.delete(pair.slice(0, i));
      else this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    assert.equal(
      response.headers.get("cache-control"),
      "no-store",
      `HTTP ${response.status}: ${await response.clone().text()}`,
    );
    return { status: response.status, data: (await response.json()) as Data };
  }
  async ok(path: string, body?: Record<string, unknown>) {
    const r = await this.request(path, body);
    assert(
      r.status === 200 || r.status === 201,
      `${r.status}: ${r.data.error}`,
    );
    return r.data;
  }
  async create(label: string) {
    this.username = `soc_${label}_${suffix}`;
    await this.ok("/api/accounts", {
      op: "register",
      username: this.username,
      displayName: `Social ${label}`,
      password,
    });
  }
  social(body?: Record<string, unknown>) {
    return this.ok("/api/social", body);
  }
  async room(body: Record<string, unknown>) {
    return (await this.ok("/api/rooms", body)).game;
  }
  move(code: string, action: Record<string, unknown>) {
    return this.room({
      op: "action",
      code,
      action,
      nonce: crypto.randomUUID(),
    });
  }
  clone() {
    const s = new Session();
    s.jar = new Map(this.jar);
    s.username = this.username;
    return s;
  }
}
const a = new Session(),
  b = new Session(),
  c = new Session(),
  outsider = new Session();
await a.create("a");
await b.create("b");
await c.create("c");
const a2 = new Session();
a2.username = a.username;
await a2.ok("/api/accounts", { op: "login", username: a.username, password });
assert.equal((await outsider.request("/api/social")).status, 401);
assert.equal(
  (
    await outsider.request("/api/social", {
      op: "request",
      username: a.username,
    })
  ).status,
  401,
);
assert.equal(
  (await a.request("/api/social", { op: "request", username: a.username }))
    .status,
  400,
);
assert.equal(
  (
    await a.request("/api/social", {
      op: "request",
      username: `missing_${suffix}`,
    })
  ).status,
  404,
);
assert.equal(
  (
    await a.request(
      "/api/social",
      { op: "request", username: b.username },
      { Origin: "https://foreign.example" },
    )
  ).status,
  403,
);
assert.equal(
  (await a.request("/api/social?username=%3Cscript%3E")).status,
  400,
);
assert.equal((await a.request("/api/social", { op: "unknown" })).status, 400);
assert.equal((await a.social()).friends.length, 0);
const requests = await Promise.all([
  a.social({ op: "request", username: b.username.toUpperCase() }),
  a2.social({ op: "request", username: b.username }),
]);
assert.equal(requests.length, 2);
let overview = await b.social(),
  request = overview.incoming[0];
assert.equal(overview.incoming.length, 1);
assert.equal(overview.unread, 1);
assert.equal(request.player.profile.username, a.username);
await b.social({ op: "request", username: a.username });
assert.equal(
  (await b.social()).incoming.length,
  1,
  "Crossed requests require explicit consent",
);
assert.equal(
  (await a.request("/api/social", { op: "accept", id: request.id })).status,
  403,
);
assert.equal(
  (await c.request("/api/social", { op: "accept", id: request.id })).status,
  404,
);
assert.equal(
  (await b.request("/api/social", { op: "cancel", id: request.id })).status,
  403,
);
await b.social({ op: "accept", id: request.id });
await b.social({ op: "accept", id: request.id });
assert.equal((await a2.social()).friends.length, 1);
assert.equal((await b.social()).friends.length, 1);
assert.equal(
  (await a.social()).notifications.filter((n) => n.kind === "accepted").length,
  1,
);
assert.equal((await a.social()).unread, 1);
assert.equal((await a.social({ op: "presence" })).error, undefined);
await b.social({ op: "presence" });
assert.equal((await a.social()).friends[0].player.online, true);
assert.equal((await a.social()).friends[0].player.room, null);
await b.social({ op: "preferences", showPresence: false });
let hidden = (await a.social()).friends[0].player;
assert.equal(hidden.online, false);
assert.equal(hidden.lastSeen, null);
assert.equal(hidden.room, null);
await b.social({ op: "preferences", showPresence: true });
assert.equal((await a.social()).friends[0].player.online, true);
await a.social({ op: "request", username: c.username });
let pending = (await c.social()).incoming[0];
await a.social({ op: "presence" });
assert.equal(pending.player.online, false);
assert.equal(pending.player.lastSeen, null);
assert.equal(pending.player.room, null);
assert.equal(
  (await a.request("/api/social", { op: "decline", id: pending.id })).status,
  403,
);
await c.social({ op: "decline", id: pending.id });
assert.equal((await a.social()).outgoing.length, 0);
await a.social({ op: "request", username: c.username });
pending = (await a.social()).outgoing[0];
await a.social({ op: "cancel", id: pending.id });
assert.equal((await c.social()).incoming.length, 0);
await a.social({ op: "request", username: c.username });
pending = (await c.social()).incoming[0];
await c.social({ op: "accept", id: pending.id });
let game = await a.room({
    op: "create",
    name: "Social host",
    mode: "duel",
    capacity: 2,
    public: false,
  }),
  code = game.code,
  created = game.created;
await a.social({ op: "presence", code });
const friend = (await b.social()).friends[0].player;
assert.equal(friend.room!.code, code);
assert.equal(friend.room!.joinable, true);
assert.equal(
  (await c.ok(`/api/social?code=${code}`)).roomPlayers.length,
  0,
  "Spectators cannot enumerate account memberships",
);
assert.equal(
  (await b.request("/api/social", { op: "presence", code })).status,
  403,
);
assert.equal(
  (await b.request("/api/social", { op: "invite", code, username: a.username }))
    .status,
  403,
);
assert.equal((await a.ok(`/api/social?code=${code}`)).roomPlayers.length, 1);
await Promise.all([
  a.social({ op: "invite", code, username: b.username }),
  a2.social({ op: "invite", code, username: b.username }),
]);
overview = await b.social();
assert.equal(
  overview.notifications.filter((n) => n.kind === "invite").length,
  1,
);
const invite = overview.notifications.find((n) => n.kind === "invite")!;
assert.equal(invite.room!.created, created);
assert.equal(invite.read, false);
for (const op of ["read", "dismiss", "openInvite"])
  assert.equal(
    (await c.request("/api/social", { op, id: invite.id })).status,
    404,
  );
const opened = await b.social({ op: "openInvite", id: invite.id });
assert.equal(opened.room.code, code);
assert.equal(
  (await b.social()).notifications.find((n) => n.id === invite.id)!.read,
  true,
);
assert.equal(
  (
    await b.request("/api/rooms", {
      op: "join",
      code,
      name: "Invitee",
      expectedCreated: created - 1,
    })
  ).status,
  400,
);
game = await b.room({
  op: "join",
  code,
  name: "Invitee",
  expectedCreated: created,
});
assert.equal(game.me, 1);
assert.equal(
  (await a.request("/api/social", { op: "invite", code, username: c.username }))
    .status,
  409,
  "Full tables reject invitations",
);
assert.equal((await a.ok(`/api/social?code=${code}`)).roomPlayers.length, 2);
await b.social({ op: "presence", code });
hidden = (await a.social()).friends.find(
  (f) => f.player.profile.username === b.username,
)!.player;
assert.equal(hidden.room!.code, code);
await b.social({ op: "preferences", showPresence: false });
hidden = (await a.social()).friends.find(
  (f) => f.player.profile.username === b.username,
)!.player;
assert.equal(hidden.room, null);
assert.equal(hidden.lastSeen, null);
await b.social({ op: "preferences", showPresence: true });
await b.move(code, { type: "ready" });
await a.move(code, { type: "start" });
assert.equal(
  (await b.social({ op: "openInvite", id: invite.id })).room.phase,
  "playing",
);
assert.equal(
  (await a.request("/api/social", { op: "invite", code, username: c.username }))
    .status,
  409,
);
await a.move(code, { type: "resign" });
assert.equal(
  (await b.social()).notifications.find((n) => n.id === invite.id)!.room,
  null,
);
await a.room({ op: "rematch", code });
assert.equal(
  (await b.request("/api/social", { op: "openInvite", id: invite.id })).status,
  410,
);
assert.equal(
  (
    await b.request("/api/rooms", {
      op: "join",
      code,
      name: "Old invite",
      expectedCreated: created,
    })
  ).status,
  400,
  "Old invitations never join a rematch, even for an existing seat",
);
await b.social({ op: "dismiss", id: invite.id });
assert((await b.social()).notifications.every((n) => n.id !== invite.id));
const unseated = await a.room({
  op: "create",
  name: "Departing sender",
  mode: "base",
  capacity: 4,
});
await a.social({ op: "invite", code: unseated.code, username: c.username });
const departedInvite = (await c.social()).notifications.find(
  (n) => n.kind === "invite",
)!;
await a.room({ op: "leave", code: unseated.code });
assert.equal(
  (await c.social()).notifications.find((n) => n.id === departedInvite.id)!
    .room,
  null,
);
assert.equal(
  (await c.request("/api/social", { op: "openInvite", id: departedInvite.id }))
    .status,
  410,
);
await a.social({ op: "readAll" });
assert.equal((await a.social()).unread, 0);
const friendship = (await a.social()).friends.find(
  (f) => f.player.profile.username === b.username,
)!;
await a.social({ op: "remove", id: friendship.id });
assert.equal((await b.social()).friends.length, 0);
assert.equal(
  (await a.request("/api/social", { op: "invite", code, username: b.username }))
    .status,
  403,
);
await a.social({ op: "request", username: b.username });
request = (await b.social()).incoming[0];
const racing = await Promise.all([
  b.request("/api/social", { op: "accept", id: request.id }),
  a.request("/api/social", { op: "block", username: b.username }),
]);
assert(racing.every((r) => [200, 404].includes(r.status)));
assert.equal((await b.social()).friends.length, 0);
assert.equal((await b.social()).incoming.length, 0);
assert.equal((await a.social()).blocked[0].username, b.username);
assert.equal(
  (await a.ok(`/api/social?username=${b.username}`)).relationship,
  "blocked",
);
assert.equal(
  (await b.ok(`/api/social?username=${a.username}`)).relationship,
  "unavailable",
);
assert.equal(
  (await b.request("/api/social", { op: "request", username: a.username }))
    .status,
  409,
);
assert.equal(
  (await a.request("/api/social", { op: "request", username: b.username }))
    .status,
  409,
);
assert.equal(
  (await b.request("/api/social", { op: "invite", code, username: a.username }))
    .status,
  403,
);
assert(
  (await b.social()).notifications.every(
    (n) => n.sender.username !== a.username,
  ),
);
await b.social({ op: "unblock", username: a.username });
assert.equal(
  (await b.ok(`/api/social?username=${a.username}`)).relationship,
  "unavailable",
  "Cannot remove another player's block",
);
await a.social({ op: "unblock", username: b.username });
assert.equal(
  (await b.ok(`/api/social?username=${a.username}`)).relationship,
  "none",
);
await a.social({ op: "request", username: b.username });
request = (await b.social()).incoming[0];
await b.social({ op: "accept", id: request.id });
await b.social({ op: "presence", code });
const revoked = b.clone();
await b.ok("/api/accounts", { op: "logoutAll" });
assert.equal((await revoked.request("/api/social")).status, 401);
assert.equal(
  (await a.social()).friends.find(
    (f) => f.player.profile.username === b.username,
  )!.player.online,
  false,
);
assert.equal(
  (await a.social()).friends.find(
    (f) => f.player.profile.username === b.username,
  )!.player.room,
  null,
);
await b.ok("/api/accounts", { op: "login", username: b.username, password });
assert.equal(
  (await b.social()).friends.length,
  1,
  "Friendships persist across sessions",
);
// Private social projections expose profiles and owned social IDs only.
const serialized = JSON.stringify(await a.social());
for (const key of [
  "player_id",
  "password_hash",
  "recovery_hash",
  "token_hash",
  "aliases",
  "hand",
  "deck",
  "diceState",
])
  assert(!serialized.includes(`\"${key}\"`), key);
const stored = (await accountRead("byUsername", { username: a.username })) as {
  id: string;
  player_id: string;
};
assert(!serialized.includes(stored.id));
assert(!serialized.includes(stored.player_id));
const notification = (await storageClient().query(api.inspection.read, {
  op: "notice",
  key: departedInvite.id,
})) as { created_at: number; expires_at: number };
assert.equal(notification.expires_at - notification.created_at, 3600000);
const limiter = new Session();
await limiter.create("limit");
for (let i = 0; i < 31; i++)
  assert.equal(
    (
      await limiter.request("/api/social", {
        op: "request",
        username: c.username,
      })
    ).status,
    i < 30 ? 200 : 429,
  );
const malformed = await fetch(origin + "/api/social", {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: "{",
});
assert.equal(malformed.status, 400);
await a.social({ op: "presence" });
await c.social({ op: "presence" });
assert.equal(
  (await a.social()).friends.find(
    (f) => f.player.profile.username === c.username,
  )!.player.online,
  true,
);
console.log(
  "PASS: social consent, concurrent requests/blocks, cross-browser persistence, private presence, owned generation-bound invitations, room capacity/start/leave/rematch, notification ownership, revocation, redaction, origin/input validation and durable limits. Checking real presence expiry…",
);
const started = Date.now();
while (Date.now() - started < 76000) {
  await new Promise((r) => setTimeout(r, 20000));
  console.log(
    `Presence expiry wait: ${Math.floor((Date.now() - started) / 1000)} seconds`,
  );
}
const expired = (await a.social()).friends.find(
  (f) => f.player.profile.username === c.username,
)!.player;
assert.equal(expired.online, false);
assert.equal(expired.room, null);
console.log(
  "PASS: real 75-second presence expiry; no clock or stored-state edits.",
);
