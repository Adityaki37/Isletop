import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  player,
  addPlayer,
  advanceClock,
  points,
  view,
} from "../lib/game";
import {
  advanceBots,
  botSeats,
  BOT_DISCONNECT_GRACE,
  BOT_MOVE_INTERVAL,
} from "../lib/disconnect-bots";
import { emptyHand } from "../lib/board";
test("permanent bots accept fair offers through normal trade validation", () => {
  const g = room("base", 3);
  g.players[1].bot = true;
  g.phase = "action";
  g.active = 0;
  g.players.forEach((p) => (p.hand = emptyHand()));
  g.players[0].hand.wood = 2;
  g.players[1].hand.brick = 1;
  applyAction(g, 0, {
    type: "offer",
    give: { ...emptyHand(), wood: 1 },
    want: { ...emptyHand(), brick: 1 },
    to: 1,
  });
  advanceBots(g, [1], Date.now());
  assert(g.offers[0].accepted.includes(1));
  applyAction(g, 0, { type: "completeTrade", id: g.offers[0].id, to: 1 });
  assert.equal(g.players[0].hand.brick, 1);
});
test("temporary replacements reject fair trades without changing the player's preferences or cards", () => {
  const g = room("base", 3);
  g.phase = "action";
  g.active = 0;
  g.players.forEach((p) => {
    p.hand = emptyHand();
    p.autoRejectTrades = false;
  });
  g.players[0].hand.wood = 2;
  g.players[1].hand.brick = 1;
  applyAction(g, 0, {
    type: "offer",
    give: { ...emptyHand(), wood: 1 },
    want: { ...emptyHand(), brick: 1 },
    to: 1,
  });
  const hands = g.players.map((p) => ({ ...p.hand }));
  advanceBots(g, [1], Date.now());
  assert(g.offers[0].rejected.includes(1));
  assert.equal(g.offers[0].accepted.length, 0);
  assert.deepEqual(g.players.map((p) => p.hand), hands);
  assert.equal(g.players[1].autoRejectTrades, false);
  advanceBots(g, [], Date.now());
  assert.equal(g.botPlayers.includes(1), false);
});
test("temporary replacements cancel their player's pending trade instead of completing it", () => {
  const g = room("base", 3);
  g.phase = "action";
  g.active = 0;
  g.players.forEach((p) => {
    p.hand = emptyHand();
    p.autoRejectTrades = false;
  });
  g.players[0].hand.wood = 2;
  g.players[1].hand.brick = 1;
  applyAction(g, 0, {
    type: "offer",
    give: { ...emptyHand(), wood: 1 },
    want: { ...emptyHand(), brick: 1 },
    to: 1,
  });
  applyAction(g, 1, { type: "accept", id: g.offers[0].id });
  const hands = g.players.map((p) => ({ ...p.hand }));
  advanceBots(g, [0], Date.now());
  assert.equal(g.offers.length, 0);
  assert.deepEqual(g.players.map((p) => p.hand), hands);
});
import { RESOURCES } from "../lib/board";
import { assertCitiesInventory } from "./cities-match-inventory";
import { appendGameLog } from "../lib/game-log";
test("hosts can add and remove ready bots; guests cannot add bots or overfill a room", () => {
  const g = createGame("BOT222", player("h", "Host"), 3, false, "base");
  addPlayer(g, player("guest", "Guest"));
  assert.throws(() => applyAction(g, 1, { type: "addBot" }), /host/);
  applyAction(g, 0, { type: "addBot" });
  assert.equal(g.players[2].bot, true);
  assert.equal(g.players[2].ready, true);
  assert.throws(() => applyAction(g, 0, { type: "addBot" }), /full/);
  applyAction(g, 0, { type: "settings", map: "baseRandom" });
  assert(g.players[2].ready);
  applyAction(g, 1, { type: "ready" });
  applyAction(g, 0, { type: "start" });
  assert.deepEqual(botSeats(g, [null, null, null], Date.now()), [2]);
  assert.equal(view(g, null).players[2].bot, true);
  assert.throws(() => applyAction(g, 0, { type: "addBot" }));
});
test("theft log details stay private to thief and victim, including after log trimming", () => {
  const g = room("base", 3);
  g.phase = "steal";
  g.victims = [1];
  g.active = 0;
  g.players[1].hand.ore = 1;
  g.bank.ore--;
  applyAction(g, 0, { type: "steal", id: 1 }, () => 0);
  for (const id of ["0", "1"]) {
    const v = view(g, id);
    assert(v.log.some((s) => s.includes("stole 1 ore")));
    assert(!("logDetails" in v));
  }
  for (const id of ["2", null])
    assert(view(g, id).log.some((s) => s.includes("stole a hidden card")));
  for (let i = 0; i < 161; i++) appendGameLog(g, `Public message ${i}`);
  assert.equal(g.logDetails.length, 160);
  assert.equal(view(g, "0").log.length, 160);
  assert(view(g, "0").log.every((s) => !s.includes("stole")));
});
test("development logs identify the Monopoly type and both Year of Plenty cards", () => {
  const g = room("base", 3);
  g.phase = "action";
  g.turn = 10;
  g.players[0].dev = [
    { kind: "plenty", bought: 0 },
    { kind: "monopoly", bought: 0 },
  ];
  applyAction(g, 0, {
    type: "plenty",
    resources: { wood: 0, brick: 0, sheep: 1, wheat: 0, ore: 1 },
  });
  assert(
    g.log.some((s) => s.includes("1 sheep and 1 ore with Year of Plenty")),
  );
  g.devPlayed = false;
  applyAction(g, 0, { type: "monopoly", resource: "ore" });
  assert(g.log.some((s) => s.includes("chose ore with Monopoly")));
});
function room(mode: Parameters<typeof createGame>[4], n: number) {
  const g = createGame("BOT222", player("0", "Host"), n, false, mode);
  for (let p = 1; p < n; p++) addPlayer(g, player(String(p), `Seat ${p}`));
  g.players.forEach((p) => (p.ready = true));
  g.turnSeconds = 0;
  applyAction(g, 0, { type: "start" });
  return g;
}

test("bots wait three seconds between actions, including after state reload", () => {
  let g = room("base", 3);
  const now = Date.now();
  advanceBots(g, [0], now);
  assert.equal(g.phase, "setupRoad");
  assert.equal(g.botDueAt, now + 3000);
  g = JSON.parse(JSON.stringify(g));
  const before = JSON.stringify(g);
  for (const elapsed of [1, 1000, 2000, 2999]) {
    advanceBots(g, [0], now + elapsed);
    assert.equal(JSON.stringify(g), before);
  }
  advanceBots(g, [0], now + 3000);
  assert.equal(g.board.edges.filter(edge => edge.owner === 0).length, 1);
  assert.equal(g.botDueAt, now + 6000);
});
test("disconnect bots respect grace, multiple browser leases, pauses and reconnection", () => {
  const g = room("base", 3),
    now = Date.now();
  assert.deepEqual(
    botSeats(g, [now + 60000, now - BOT_DISCONNECT_GRACE + 1, null], now),
    [],
  );
  assert.deepEqual(
    botSeats(g, [now + 60000, now - BOT_DISCONNECT_GRACE, null], now),
    [1],
  );
  advanceBots(g, [0], now);
  assert.deepEqual(view(g, null).botPlayers, [0]);
  const takeover = "Host disconnected. A bot is playing until they return.";
  assert.equal(view(g, null).log.filter((s) => s === takeover).length, 1);
  advanceBots(g, [0], now + 1);
  assert.equal(g.log.filter((s) => s === takeover).length, 1);
  assert(g.board.vertices.some((v) => v.owner === 0));
  const before = g.setupStep;
  advanceBots(g, [], now + 1001);
  assert.deepEqual(g.botPlayers, []);
  assert(view(g, null).log.includes("Host returned and regained control."));
  assert.equal(g.setupStep, before);
  g.pause.pausedAt = now;
  const board = JSON.stringify(g.board);
  advanceBots(g, [0], now + 2002);
  assert.equal(JSON.stringify(g.board), board);
  assert(!("id" in view(g, null).players[0]));
});
for (const [mode, n] of [
  ["base", 4],
  ["base", 6],
  ["base", 8],
  ["seafarers", 3],
  ["seafarers", 6],
  ["citiesKnights", 3],
  ["citiesKnights", 6],
  ["seafarersCitiesKnights", 3],
  ["seafarersCitiesKnights", 6],
] as const)
  test(`disconnected bots complete a natural ${n}-player ${mode} game`, () => {
    const g = room(mode, n),
      supply = g.bank.wood,
      seats = g.players.map((_, i) => i);
    let moves = 0,
      now = Date.now();
    while (g.phase !== "finished" && moves < 16000) {
      const prior = JSON.stringify([
        g.phase,
        g.turn,
        g.board,
        g.players,
        g.cities,
        g.offers,
      ]);
      advanceClock(g, now);
      advanceBots(g, seats, now);
      assert.notEqual(
        JSON.stringify([
          g.phase,
          g.turn,
          g.board,
          g.players,
          g.cities,
          g.offers,
        ]),
        prior,
        `Bot stalled at ${g.phase}`,
      );
      if (g.cities) assertCitiesInventory(g);
      else
        for (const r of RESOURCES)
          assert.equal(
            g.bank[r] + g.players.reduce((s, p) => s + p.hand[r], 0),
            supply,
          );
      now += BOT_MOVE_INTERVAL + 1;
      moves++;
    }
    assert.equal(g.phase, "finished");
    assert(points(g, g.winner!) >= g.target);
    console.log(
      `Bot ${mode}/${n}: ${moves} moves, winner ${g.winner}, ${points(g, g.winner!)} points`,
    );
  });
