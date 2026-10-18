import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  player,
  addPlayer,
  actor,
  advanceClock,
  view,
  normalizeGame,
  type Game,
  type Action,
} from "../lib/game";
import {
  beginReplayCapture,
  takeReplayCapture,
  replayState,
  ReplayTimeline,
  replayDiff,
  applyReplayPatch,
  type ReplayFrame,
  type ReplayState,
} from "../lib/match-replay";
import { chooseMove } from "./autoplay";
function lobby(mode: "base" | "citiesKnights" | "rush" | "duel" = "duel") {
  const n = mode === "duel" ? 2 : 3,
    g = createGame("REPLAY", player("session-secret", "Host"), n, false, mode);
  for (let p = 1; p < n; p++) {
    addPlayer(g, player(`session-secret-${p}`, `Seat ${p}`));
    g.players[p].ready = true;
  }
  return g;
}
function recorded(g: Game, action: Action, seat = actor(g)) {
  beginReplayCapture(g);
  applyAction(g, seat, action, () => 0.4, 100000);
  return takeReplayCapture(g)!;
}
test("legacy live rooms mark replays as partial without inventing opening actions", () => {
  const g = lobby();
  recorded(g, { type: "start" }, 0);
  recorded(g, chooseMove(g, 0)!, 0);
  delete (g as Partial<Game>).replayComplete;
  delete (g as Partial<Game>).replaySequence;
  normalizeGame(g);
  const capture = recorded(g, chooseMove(g, actor(g))!);
  assert.equal(capture.complete, false);
  assert.equal(capture.initial!.phase, "setupRoad");
  assert.equal(capture.initialSequence, 0);
  assert.equal(capture.frames.length, 1);
  assert.deepEqual(
    new ReplayTimeline(capture.initial!, capture.frames).stateAt(1),
    replayState(g),
  );
});
test("ordinary chat changes neither replay sequence nor historical recording", () => {
  const g = lobby();
  recorded(g, { type: "start" }, 0);
  const sequence = g.replaySequence;
  const capture = recorded(
    g,
    { type: "chat", text: "private chat message" },
    0,
  );
  assert.equal(g.replaySequence, sequence);
  assert.deepEqual(capture.frames, []);
  assert(!JSON.stringify(capture.initial).includes("private chat message"));
});
test("replay records start, setup, final victory, and reconstructs every accepted snapshot", () => {
  const g = lobby(),
    start = recorded(g, { type: "start" }, 0),
    initial = start.initial!;
  assert(start.complete && initial);
  assert.equal(start.initialSequence, 0);
  const frames: ReplayFrame[] = [];
  while (g.phase.startsWith("setup")) {
    const capture = recorded(g, chooseMove(g, actor(g))!);
    frames.push(...capture.frames);
    assert.deepEqual(
      new ReplayTimeline(initial, frames).stateAt(frames.length),
      replayState(g),
    );
  }
  frames.push(...recorded(g, { type: "resign" }, 0).frames);
  const timeline = new ReplayTimeline(initial, frames);
  assert.equal(timeline.stateAt(frames.length).winner, 1);
  assert.equal(timeline.stateAt(frames.length).phase, "finished");
  assert.equal(timeline.stateAt(0).phase, "setupSettlement");
  assert.deepEqual(
    initial,
    start.initial,
    "Seeking never mutates the initial snapshot.",
  );
});
test("replay never records session identities, future decks, receipts or chat", () => {
  const g = lobby();
  recorded(g, { type: "start" }, 0);
  g.receipts.push("secret-receipt");
  g.chat.push({ name: "Host", text: "private-chat" });
  const json = JSON.stringify(replayState(g));
  for (const secret of [
    "session-secret",
    "secret-receipt",
    "private-chat",
    '"diceState"',
    '"fogDeck"',
    '"fogNumbers"',
    '"decks"',
  ])
    assert(!json.includes(secret));
  assert.equal(view(g, "session-secret").statistics, null);
  assert(!("replaySequence" in view(g, "session-secret")));
});
test("recordings preserve public expansion rules, gold obligations and island scores", () => {
  const g = createGame(
    "REPLAY",
    player("session-secret", "Host"),
    3,
    false,
    "seafarersCitiesKnights",
  );
  for (let p = 1; p < 3; p++) {
    addPlayer(g, player(`session-secret-${p}`, `Seat ${p}`));
    g.players[p].ready = true;
  }
  recorded(g, { type: "start" }, 0);
  g.goldClaims = { 0: 2 };
  g.goldResume = "setupRoad";
  g.shipMoved = true;
  g.players[0].islandBonus = 2;
  g.players[0].islands = [1, 2];
  const state = replayState(g);
  for (const field of [
    "mode",
    "map",
    "scenario",
    "target",
    "friendlyRobber",
    "goldClaims",
    "goldResume",
    "shipMoved",
  ] as const)
    assert.deepEqual(state[field], g[field]);
  assert.equal(state.players[0].islandBonus, 2);
  assert.deepEqual(state.players[0].islands, [1, 2]);
  assert(
    !("fogDeck" in state) && !("deck" in state) && !("decks" in state.cities!),
  );
  g.goldClaims[0] = 7;
  g.players[0].islands.push(3);
  assert.deepEqual(state.goldClaims, { 0: 2 });
  assert.deepEqual(state.players[0].islands, [1, 2]);
});
test("an older replay opening accepts new nested gold-claim patches during an ongoing game", () => {
  const before = replayState(lobby());
  const oldOpening = structuredClone(before);
  delete oldOpening.goldClaims;
  const claimed = structuredClone(before);
  claimed.goldClaims = { 0: 2 };
  const patches = replayDiff(before, claimed);
  assert(
    patches.some((p) => p.path[0] === "goldClaims" && p.path.length === 2),
  );
  const restored = applyReplayPatch(oldOpening, patches);
  assert.deepEqual(restored, claimed);
  assert.deepEqual(
    applyReplayPatch(restored, replayDiff(claimed, before)),
    before,
  );
  // A first post-update move can also remove an outstanding legacy claim.
  const missing = structuredClone(claimed);
  delete missing.goldClaims;
  assert.deepEqual(
    applyReplayPatch(missing, replayDiff(claimed, before)),
    before,
  );
});
test("expansion draft replay frames commit only after successful validation", () => {
  const g = lobby("citiesKnights");
  recorded(g, { type: "start" }, 0);
  const before = JSON.stringify(g);
  beginReplayCapture(g);
  assert.throws(
    () => applyAction(g, 1, { type: "settlement", id: 0 }),
    /turn|place/i,
  );
  assert.equal(takeReplayCapture(g)!.frames.length, 0);
  assert.equal(JSON.stringify(g), before);
  const capture = recorded(g, chooseMove(g, 0)!, 0);
  assert(capture.frames.length > 0);
  assert.deepEqual(
    new ReplayTimeline(capture.initial!, capture.frames).stateAt(
      capture.frames.length,
    ),
    replayState(g),
  );
});
test("automatic timeout setup records settlement and road separately", () => {
  const g = lobby();
  recorded(g, { type: "start" }, 0);
  beginReplayCapture(g);
  advanceClock(g, g.deadline!, () => 0.4);
  const capture = takeReplayCapture(g)!;
  assert.deepEqual(
    capture.frames.map((f) => f.action),
    ["settlement", "road"],
  );
  assert.deepEqual(
    new ReplayTimeline(capture.initial!, capture.frames).stateAt(
      capture.frames.length,
    ),
    replayState(g),
  );
});
test("replay uses element patches for board changes and restores removed optional fields", () => {
  const g = lobby();
  recorded(g, { type: "start" }, 0);
  const before = replayState(g),
    after = structuredClone(before);
  after.board.vertices[0].owner = 0;
  after.board.tiles[0].number = 8;
  delete (after.board.edges[0] as { kind?: string }).kind;
  const patches = replayDiff(before, after);
  assert(patches.every((p) => p.path.length >= 3));
  assert.deepEqual(applyReplayPatch(structuredClone(before), patches), after);
  assert.throws(
    () =>
      applyReplayPatch(before, [
        { path: ["__proto__", "polluted"], value: true },
      ]),
    /Invalid/,
  );
});
test("replay seeking crosses checkpoints in both directions without accumulating changes", () => {
  const initial = replayState(lobby()),
    frames: ReplayFrame[] = Array.from({ length: 133 }, (_, i) => ({
      sequence: i + 1,
      at: i,
      seat: null,
      action: "system",
      messages: [],
      patch: [{ path: ["turn"], value: i + 1 }],
    }));
  const timeline = new ReplayTimeline(initial, frames);
  for (const index of [133, 49, 100, 0, 51, 1, 132])
    assert.equal(timeline.stateAt(index).turn, index);
  assert.throws(() => timeline.stateAt(-1));
  assert.throws(() => timeline.stateAt(134));
});
