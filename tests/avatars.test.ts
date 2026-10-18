import test from "node:test";
import assert from "node:assert/strict";
import { avatarAsset, normalizeAvatar, selectAvatar } from "../lib/avatars";
import { createGame, player, addPlayer, view } from "../lib/game";
import { replayState } from "../lib/match-replay";

test("the default avatar rejects URLs and unavailable cosmetics", () => {
  for (const value of [
    "https://example.com/private.png",
    "/external-assets/icon_crown.svg",
    "crown",
    "../secret",
    null,
    0,
    {},
    "PLAYER",
    "retired-avatar",
  ]) {
    assert.throws(() => selectAvatar(value));
    assert.equal(normalizeAvatar(value), "player");
    assert.equal(avatarAsset(value), avatarAsset("player"));
  }
  assert.equal(selectAvatar("player"), "player");
});
test("avatar snapshots survive public projections and replay recording without revealing identities", () => {
  const g = createGame("AVATAR", player("private-host", "Host", "player"), 3);
  addPlayer(g, player("private-guest", "Guest", "player"));
  const snapshot = replayState(g);
  const publicView = view(g, null);
  assert.deepEqual(
    publicView.players.map((p) => p.avatar),
    ["player", "player"],
  );
  assert.deepEqual(
    snapshot.players.map((p) => p.avatar),
    ["player", "player"],
  );
  assert(!JSON.stringify(publicView.players).includes("private-host"));
  delete g.players[0].avatar;
  assert.equal(snapshot.players[0].avatar, "player");
  assert.equal(publicView.players[0].avatar, "player");
});
test("legacy rooms use the guest artwork and never expose arbitrary saved avatar paths", () => {
  const g = createGame("AVATAR", player("private-host", "Host"), 3);
  delete g.players[0].avatar;
  assert.equal(view(g, null).players[0].avatar, "player");
  Object.assign(g.players[0], { avatar: "https://example.com/profile.png" });
  assert.equal(view(g, null).players[0].avatar, "player");
});
