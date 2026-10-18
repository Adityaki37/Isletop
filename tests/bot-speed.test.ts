import test from "node:test";
import assert from "node:assert/strict";
import { addPlayer, applyAction, createGame, normalizeGame, player, view } from "../lib/game";
import { advanceBots } from "../lib/disconnect-bots";
import { BOT_MOVE_INTERVAL, FAST_BOT_MOVE_INTERVAL, botMoveInterval, isBotPracticeGame } from "../lib/bot-speed";
import { applyRoomOperation } from "../lib/room-operation";

function practice() {
  const g = createGame("BOT222", player("host", "Host"), 2, false, "duel");
  applyAction(g, 0, { type: "addBot" });
  applyAction(g, 0, { type: "start" });
  return g;
}

test("fast forwarding reschedules the pending bot and persists across state reload", () => {
  let g = practice();
  const at = Date.now();
  g.active = 1;g.botDueAt = at + BOT_MOVE_INTERVAL;
  const deadline = g.deadline;
  applyAction(g, 0, { type: "botSpeed", enabled: true }, undefined, at);
  assert.equal(g.botDueAt, at + FAST_BOT_MOVE_INTERVAL);
  assert.equal(g.deadline, deadline, "human turn clocks are unchanged");
  assert.equal(view(g, "host").botFastForward, true);
  g = normalizeGame(JSON.parse(JSON.stringify(g)));
  advanceBots(g, [1], at + FAST_BOT_MOVE_INTERVAL - 1);
  assert.equal(g.phase, "setupSettlement");
  advanceBots(g, [1], at + FAST_BOT_MOVE_INTERVAL);
  assert.equal(g.phase, "setupRoad");
  assert.equal(g.botDueAt, at + 2 * FAST_BOT_MOVE_INTERVAL);
  applyAction(g, 0, { type: "botSpeed", enabled: false }, undefined, at + FAST_BOT_MOVE_INTERVAL + 1);
  assert.equal(g.botDueAt, at + FAST_BOT_MOVE_INTERVAL + 1 + BOT_MOVE_INTERVAL);
  assert.equal(botMoveInterval(g), BOT_MOVE_INTERVAL);
});

test("only the human host in a private game with permanent bot opponents controls speed", () => {
  const g = practice(), at = Date.now();
  assert(isBotPracticeGame(g));
  assert.throws(() => applyAction(g, -1, { type: "botSpeed", enabled: true }, undefined, at));
  assert.throws(() => applyAction(g, 1, { type: "botSpeed", enabled: true }, undefined, at), /Only the player/);
  assert.throws(() => applyAction(g, 0, { type: "botSpeed" }, undefined, at), /Choose whether/);
  for (const modified of [
    { ...g, public: true },
    { ...g, ranked: {} as NonNullable<typeof g.ranked> },
    { ...g, matchmaking: "casualBase" as typeof g.matchmaking },
    { ...g, players: g.players.map(p => ({ ...p, bot: false })), botPlayers: [1] },
  ]) {
    assert.equal(isBotPracticeGame(modified), false);
    assert.equal(botMoveInterval({ ...modified, botFastForward: true }), BOT_MOVE_INTERVAL);
    assert.throws(() => applyAction(modified, 0, { type: "botSpeed", enabled: true }, undefined, at), /private bot game/);
  }
  const multiplayer = createGame("ABC234", player("h", "Host"), 3);
  addPlayer(multiplayer, player("guest", "Guest"));applyAction(multiplayer, 0, { type: "addBot" });
  assert.equal(isBotPracticeGame(multiplayer), false);
});

test("the speed control tolerates a bot changing turns while generation checks still apply", () => {
  const g = practice(), ident = { id: "host", aliases: [], account: null };
  applyRoomOperation(g, ident, { op: "action", expectedCreated: g.created,
    nonce: "fast-forward-control-001", context: "previous-bot-turn",
    action: { type: "botSpeed", enabled: true } }, "player");
  assert.equal(g.botFastForward, true);
  assert.throws(() => applyRoomOperation(g, ident, { op: "action", expectedCreated: g.created - 1,
    nonce: "fast-forward-control-002", action: { type: "botSpeed", enabled: false } }, "player"), /earlier game/);
});

test("saved practice games default to normal speed and fast forward cannot bypass a pause", () => {
  const g = practice(), at = Date.now();
  delete (g as Partial<typeof g>).botFastForward;
  normalizeGame(g);
  assert.equal(g.botFastForward, false);
  applyAction(g, 0, { type: "botSpeed", enabled: true }, undefined, at);
  applyAction(g, 0, { type: "pauseRequest" }, undefined, at + 1);
  const due = g.botDueAt;
  advanceBots(g, [1], at + 10000);
  assert.equal(g.botDueAt, due);
  assert.throws(() => applyAction(g, 0, { type: "botSpeed", enabled: false }, undefined, at + 10001), /paused/);
});
