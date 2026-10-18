import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  player,
  addPlayer,
  advanceClock,
  actor,
  view,
  moveContext,
  normalizeGame,
  type Game,
  type Phase,
} from "../lib/game";
import { createRush } from "../lib/rush";
import {
  PAUSE_VOTE_MS,
  needsPauseUpdate,
} from "../lib/table-pause";
import { chooseMove } from "./autoplay";
import { replayState } from "../lib/match-replay";
import { needsMyAction } from "../lib/game-sounds";

function table(seats = 3) {
  const g = createGame("PAUS22", player("0", "Host"), seats);
  for (let p = 1; p < seats; p++) addPlayer(g, player(String(p), `Seat ${p}`));
  for (let p = 0; p < seats; p++) applyAction(g, p, { type: "ready" });
  applyAction(g, 0, { type: "start" });
  while (g.phase.startsWith("setup")) applyAction(g, actor(g), chooseMove(g)!);
  return g;
}
function agree(g: Game, at: number) {
  applyAction(g, 0, { type: "pauseRequest" }, undefined, at);
  const id = g.pause.vote?.id;
  for (let p = 1; p < g.players.length; p++)
    applyAction(
      g,
      p,
      { type: "pauseVote", id, accept: true },
      undefined,
      at + p,
    );
  return at + g.players.length - 1;
}
const position = (g: Game) =>
  JSON.stringify({
    board: g.board,
    bank: g.bank,
    players: g.players,
    deck: g.deck,
    phase: g.phase,
    turn: g.turn,
    active: g.active,
    cities: g.cities,
  });

test("all human counts pause by consent, preserve their position and resume with the same time left", () => {
  for (let n = 1; n <= 8; n++) {
    const g = table(n),
      at = Date.now(),
      deadline = g.deadline,
      before = position(g),
      context = moveContext(g);
    const stopped = agree(g, at);
    assert.equal(g.pause.pausedAt, stopped);
    assert.equal(g.pause.vote, null);
    assert.equal(g.pause.until, null);
    advanceClock(g, stopped + 3600000);
    assert.equal(position(g), before);
    assert.equal(g.deadline, deadline);
    assert(!needsMyAction(view(g, "0")));
    assert.throws(
      () => applyAction(g, 0, { type: "roll" }, undefined, stopped + 3600001),
      /paused/,
    );
    assert.equal(position(g), before);
    const resumed = agree(g, stopped + 3600002);
    assert.equal(g.pause.pausedAt, null);
    assert.equal(
      g.deadline,
      deadline === null ? null : deadline + resumed - stopped,
    );
    assert.notEqual(moveContext(g), context);
    assert.equal(position(g), before);
  }
});
test("votes are seat owned, distinct, cannot be counted twice and cannot be sent to a later vote", () => {
  const g = table(3),
    at = Date.now();
  applyAction(g, 0, { type: "pauseRequest" }, undefined, at);
  const id = g.pause.vote!.id;
  assert.throws(
    () => applyAction(g, -1, { type: "pauseVote", id, accept: true }),
    /seated/,
  );
  assert.throws(
    () => applyAction(g, 1, { type: "pauseVote", id: id + 1, accept: true }),
    /ended/,
  );
  assert.throws(() => applyAction(g, 1, { type: "pauseVote", id }), /whether/);
  applyAction(g, 1, { type: "pauseVote", id, accept: true }, undefined, at + 1);
  assert.throws(
    () =>
      applyAction(
        g,
        1,
        { type: "pauseVote", id, accept: true },
        undefined,
        at + 2,
      ),
    /already/,
  );
  applyAction(
    g,
    2,
    { type: "pauseVote", id, accept: false },
    undefined,
    at + 3,
  );
  assert.equal(g.pause.vote, null);
  assert.equal(g.pause.pausedAt, null);
  assert.throws(
    () => applyAction(g, 0, { type: "pauseRequest" }, undefined, at + 4),
    /Wait/,
  );
  applyAction(g, 2, { type: "pauseRequest" }, undefined, at + 5);
  assert.notEqual(g.pause.vote!.id, id);
  assert.throws(
    () =>
      applyAction(
        g,
        1,
        { type: "pauseVote", id, accept: true },
        undefined,
        at + 6,
      ),
    /ended/,
  );
});
test("unanswered votes expire while the ordinary clock continues", () => {
  const g = table(3),
    at = Date.now();
  g.turnSeconds = 0;
  advanceClock(g, at);
  applyAction(g, 0, { type: "pauseRequest" }, undefined, at);
  assert(needsPauseUpdate(g, at + PAUSE_VOTE_MS));
  advanceClock(g, at + PAUSE_VOTE_MS);
  assert.equal(g.pause.vote, null);
  assert.equal(g.pause.pausedAt, null);
  assert.equal(g.phase, "roll");
});
test("an expired resume vote leaves the game paused until a new vote succeeds", () => {
  const g = table(2),
    at = Date.now();
  g.turnSeconds = 0;
  advanceClock(g, at);
  const stopped = agree(g, at);
  applyAction(g, 0, { type: "pauseRequest" }, undefined, stopped + 1000);
  assert.equal(g.pause.vote!.target, "resume");
  advanceClock(g, stopped + 86400000);
  assert.equal(g.pause.pausedAt, stopped);
  assert.equal(g.pause.vote, null);
  assert.equal(g.phase, "roll");
  assert(!needsPauseUpdate(g, stopped + 86400000));
  agree(g, stopped + 86400001);
  assert.equal(g.pause.pausedAt, null);
});

test("old saved pause expiries cannot automatically resume a game", () => {
  const g = table(2), at = Date.now();
  const stopped = agree(g, at), before = position(g), deadline = g.deadline;
  g.pause.until = stopped + 120000;
  normalizeGame(g);
  assert.equal(g.pause.until, null);
  advanceClock(g, stopped + 86400000);
  assert.equal(g.pause.pausedAt, stopped);
  assert.equal(position(g), before);
  assert.equal(g.deadline, deadline);
});
test("setup and every mandatory phase freeze without automatic choices or resource loss", () => {
  for (const phase of [
    "setupSettlement",
    "setupRoad",
    "roll",
    "action",
    "discard",
    "robber",
    "steal",
    "roadBuilding",
    "special",
    "gold",
    "citiesChoice",
  ] as Phase[]) {
    const g = table(3),
      at = Date.now();
    g.phase = phase;
    g.turnSeconds = 30;
    g.specialPlayer = 1;
    applyAction(g, 0, { type: "chat", text: "Start clock" }, undefined, at);
    const before = position(g),
      deadline = g.deadline;
    const stopped = agree(g, at + 1);
    advanceClock(g, stopped + 3600000);
    assert.equal(position(g), before, phase);
    assert.equal(g.deadline, deadline, phase);
  }
});
test("trade response, preparation, cleanup and internally paused clocks shift exactly once", () => {
  const g = table(3),
    at = Date.now();
  g.phase = "action";
  g.offers = [
    {
      id: 1,
      from: 0,
      to: 1,
      give: { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 },
      want: { wood: 0, brick: 1, sheep: 0, wheat: 0, ore: 0 },
      accepted: [],
      rejected: [],
      preparing: [1],
      replyTo: null,
      targets: [1],
      blocked: [],
      expired: [],
      responseDeadlines: { 1: at + 10000, 2: null },
      preparingUntil: { 1: at + 45000 },
      closeAt: at + 2000,
      pausedAt: at - 5000,
    },
  ];
  const stopped = agree(g, at);
  const frozen = structuredClone(g.offers);
  advanceClock(g, stopped + 60000);
  assert.deepEqual(g.offers, frozen);
  const resumed = agree(g, stopped + 60000),
    elapsed = resumed - stopped;
  assert.equal(g.offers[0].responseDeadlines[1], at + 10000 + elapsed);
  assert.equal(g.offers[0].responseDeadlines[2], null);
  assert.equal(g.offers[0].preparingUntil[1], at + 45000 + elapsed);
  assert.equal(g.offers[0].closeAt, at + 2000 + elapsed);
  assert.equal(g.offers[0].pausedAt, at - 5000 + elapsed);
});
test("Rush's automatic dice, discards, robber and free-road clocks all freeze", () => {
  const g = table(3),
    at = Date.now();
  g.mode = "rush";
  g.phase = "action";
  g.rush = createRush(3);
  Object.assign(g.rush, {
    rollAt: at + 5000,
    discardUntil: at + 10000,
    robberUntil: at + 15000,
    pausedAt: at - 1000,
  });
  g.rush.seats[0].until = at + 20000;
  g.deadline = at + 5000;
  const stopped = agree(g, at),
    before = structuredClone(g.rush),
    ctx = moveContext(view(g, "0"));
  advanceClock(g, stopped + 60000);
  assert.deepEqual(g.rush, before);
  const resumed = agree(g, stopped + 60000),
    elapsed = resumed - stopped;
  assert.equal(g.rush.rollAt, before.rollAt! + elapsed);
  assert.equal(g.rush.discardUntil, before.discardUntil! + elapsed);
  assert.equal(g.rush.robberUntil, before.robberUntil! + elapsed);
  assert.equal(g.rush.pausedAt, before.pausedAt! + elapsed);
  assert.equal(g.rush.seats[0].until, before.seats[0].until! + elapsed);
  assert.equal(g.rush.seats[1].until, null);
  assert.notEqual(moveContext(view(g, "0")), ctx);
});
test("chat and 1v1 resignation remain available while paused, and finished games clear votes", () => {
  const g = table(2),
    at = Date.now();
  agree(g, at);
  applyAction(g, 0, { type: "chat", text: "Still here" }, undefined, at + 1000);
  assert.equal(g.chat.at(-1)!.text, "Still here");
  applyAction(g, 1, { type: "chat", text: "/resign" }, undefined, at + 2000);
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 0);
  assert.equal(g.pause.pausedAt, null);
  assert.equal(g.pause.vote, null);
  assert.equal(g.deadline, null);
});
test("pause commands work in chat without broadcasting commands or leaking private cooldowns", () => {
  const g = table(3),
    at = Date.now();
  applyAction(g, 1, { type: "chat", text: " /pause " }, undefined, at);
  assert.equal(g.pause.vote!.creator, 1);
  assert.equal(g.chat.length, 0);
  const v = view(g, null);
  assert(!("pauseCooldowns" in v));
  assert(!JSON.stringify(replayState(g)).includes("pauseCooldowns"));
  assert.deepEqual(v.pause.vote, g.pause.vote);
});
test("legacy games normalize without changing play, and lobby/finished votes are rejected", () => {
  const g = table(3),
    before = position(g);
  delete (g as Partial<Game>).pause;
  delete (g as Partial<Game>).pauseCooldowns;
  normalizeGame(g);
  assert.equal(position(g), before);
  assert.equal(g.pause.pausedAt, null);
  assert.deepEqual(g.pauseCooldowns, {});
  for (const phase of ["lobby", "finished"] as const) {
    g.phase = phase;
    assert.throws(
      () => applyAction(g, 0, { type: "pauseRequest" }),
      /during a game/,
    );
  }
});
