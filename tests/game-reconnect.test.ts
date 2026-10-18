import assert from "node:assert/strict";
import { test } from "node:test";
import { canReconnect, parseRememberedGame, type RememberedGame } from "../lib/game-reconnect";

const saved: RememberedGame = { version: 1, code: "ABC234", created: 1234, dismissed: false };
const game = { code: saved.code, created: saved.created, me: 1, phase: "action" };

test("remembered room data survives a new tab without storing a player credential", () => {
  assert.deepEqual(parseRememberedGame(JSON.stringify(saved)), saved);
  assert.deepEqual(parseRememberedGame(JSON.stringify({ ...saved, dismissed: true })), { ...saved, dismissed: true });
  assert.equal(canReconnect(saved, game), true);
});

test("a reused room code, missing seat, lobby, or finished game cannot reconnect", () => {
  assert.equal(canReconnect(saved, { ...game, created: 5678 }), false);
  assert.equal(canReconnect(saved, { ...game, code: "DEF567" }), false);
  assert.equal(canReconnect(saved, { ...game, me: -1 }), false);
  assert.equal(canReconnect(saved, { ...game, phase: "finished" }), false);
  assert.equal(canReconnect(saved, { ...game, phase: "lobby" }), false);
  assert.equal(canReconnect(saved, { ...game, phase: "robber" }), true);
});

test("corrupt or unsupported browser records are ignored", () => {
  for (const raw of [null, "{", "null", "[]", JSON.stringify({ ...saved, version: 2 }),
    JSON.stringify({ ...saved, code: "ABC000" }), JSON.stringify({ ...saved, created: -1 }),
    JSON.stringify({ ...saved, dismissed: undefined })]) assert.equal(parseRememberedGame(raw), null);
});
