import assert from "node:assert/strict";
import type { View } from "../lib/game";
import type { AccountProfile } from "../lib/account-types";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
class Session {
  cookies = new Map<string, string>();
  async call(path: string, body?: Record<string, unknown>, expected = 200) {
    const r = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: [...this.cookies.values()].join("; "),
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const cookie of r.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      this.cookies.set(pair.split("=")[0], pair);
    }
    const data = (await r.json()) as {
      game: View;
      account: AccountProfile;
      error?: string;
      spectators: { username: string; avatar: string }[];
    };
    assert.equal(r.status, expected, data.error);
    return data;
  }
  move(code: string, action: Record<string, unknown>) {
    return this.call("/api/rooms", {
      op: "action",
      code,
      action,
      nonce: crypto.randomUUID(),
    });
  }
}
const host = new Session(),
  guest = new Session(),
  otherBrowser = new Session(),
  outsider = new Session();
const username = "avatar_" + crypto.randomUUID().slice(0, 8),
  password = "Avatar test " + crypto.randomUUID();
assert.equal(
  (
    await host.call(
      "/api/accounts",
      { op: "register", username, password },
      201,
    )
  ).account.avatar,
  "player",
);
const profile = {
  op: "profile",
  displayName: "Avatar Host",
  bio: "Public preset only",
  color: 4,
};
await outsider.call("/api/accounts", { ...profile, avatar: "player" }, 401);
await host.call("/api/accounts", { ...profile, avatar: "player" });
for (const avatar of [
  "crown",
  "https://example.com/private.png",
  "../secret",
  42,
  null,
])
  await host.call("/api/accounts", { ...profile, avatar }, 400);
assert.equal((await host.call("/api/accounts")).account.avatar, "player");
const { game: room } = await host.call("/api/rooms", {
  op: "create",
  name: "Avatar Host",
  capacity: 2,
  mode: "duel",
  avatar: "player",
});
assert.equal(
  room.players[0].avatar,
  "player",
  "Signed-in rooms use the saved profile, not an unowned request override",
);
await outsider.call(
  "/api/rooms",
  { op: "create", name: "Invalid", capacity: 2, avatar: "crown" },
  400,
);
const joined = await guest.call("/api/rooms", {
  op: "join",
  code: room.code,
  name: "Avatar Guest",
  avatar: "player",
});
assert.equal(joined.game.players[1].avatar, "player");
await guest.move(room.code, { type: "ready" });
await host.move(room.code, { type: "start" });
await host.call("/api/accounts", { ...profile, avatar: "player" });
await host.call("/api/accounts", profile); // Older clients use the same default without a selection.
assert.equal(
  (
    await otherBrowser.call("/api/accounts", {
      op: "login",
      username,
      password,
    })
  ).account.avatar,
  "player",
);
assert.equal(
  (await otherBrowser.call("/api/rooms?code=" + room.code)).game.players[0]
    .avatar,
  "player",
);
const publicProfile = (
  await outsider.call("/api/accounts?username=" + username)
).account;
assert.equal(publicProfile.avatar, "player");
assert(!("id" in publicProfile) && !("player_id" in publicProfile));
const { game: finished } = await host.move(room.code, { type: "resign" });
const { game: result } = await outsider.call(
  "/api/matches?match=" + finished.statistics!.id,
);
assert.deepEqual(
  result.players.map((p) => p.avatar),
  ["player", "player"],
);
await host.call("/api/accounts", { ...profile, avatar: "player" });
assert.deepEqual(
  (
    await outsider.call("/api/matches?match=" + finished.statistics!.id)
  ).game.players.map((p) => p.avatar),
  ["player", "player"],
);
const { game: rematch } = await host.call("/api/rooms", {
  op: "rematch",
  code: room.code,
});
assert.deepEqual(
  rematch.players.map((p) => p.avatar),
  ["player", "player"],
);
await host.call("/api/accounts", { ...profile, avatar: "player" });
const { game: future } = await host.call("/api/rooms", {
  op: "create",
  name: "Future avatar",
  capacity: 3,
});
assert.equal(future.players[0].avatar, "player");
const { game: watchRoom } = await guest.call("/api/rooms", {
  op: "create",
  name: "Spectator avatar",
  capacity: 3,
});
await host.call("/api/spectators", {
  op: "watch",
  code: watchRoom.code,
  created: watchRoom.created,
  token: crypto.randomUUID(),
});
const roster = await outsider.call("/api/spectators?code=" + watchRoom.code);
assert.equal(
  roster.spectators.find((s) => s.username === username)?.avatar,
  "player",
);
const accountJoin = await host.call("/api/rooms", {
  op: "join",
  code: watchRoom.code,
  name: "Saved account avatar",
  avatar: "player",
});
assert.equal(accountJoin.game.players[1].avatar, "player");
console.log(
  "PASS: one avatar default, legacy-client compatibility, allowlisting, authenticated edits, cross-browser persistence, spectator profiles, frozen match results and rematches.",
);
