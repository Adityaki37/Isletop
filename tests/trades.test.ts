import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  player,
  addPlayer,
  applyAction,
  view,
  Game,
  normalizeGame,
  tradeExecutor,
  advanceClock,
  needsTradeUpdate,
} from "../lib/game";
import { emptyHand, Hand, RESOURCES } from "../lib/board";
import { tradeCooldown, tradePerspective } from "../lib/trading";
const cards = (h: Partial<Hand>) => ({ ...emptyHand(), ...h });
function table(n = 4) {
  const g = createGame("TRADE2", player("p0", "Host"), n);
  for (let p = 1; p < n; p++) addPlayer(g, player(`p${p}`, `Player ${p}`));
  g.phase = "action";
  g.turn = 1;
  return g;
}
function give(g: Game, p: number, h: Partial<Hand>) {
  for (const r of RESOURCES) {
    const n = h[r] ?? 0;
    g.players[p].hand[r] += n;
    g.bank[r] -= n;
  }
}
function conserved(g: Game) {
  const initial = g.capacity > 6 ? 29 : g.capacity > 4 ? 24 : 19;
  for (const r of RESOURCES)
    assert.equal(
      g.bank[r] + g.players.reduce((sum, p) => sum + p.hand[r], 0),
      initial,
    );
}
function offer(g: Game, from = 0) {
  applyAction(g, from, {
    type: "offer",
    give: cards({ wood: 1 }),
    want: cards({ brick: 1 }),
  });
  return g.offers.at(-1)!;
}
const at = (
  g: Game,
  p: number,
  a: Parameters<typeof applyAction>[2],
  now: number,
) => applyAction(g, p, a, () => 0.5, now);
function timedOffer(g: Game, targets: number[] | null = [1]) {
  at(
    g,
    0,
    {
      type: "offer",
      targets,
      give: cards({ wood: 1 }),
      want: cards({ brick: 1 }),
    },
    1000,
  );
  return g.offers.at(-1)!;
}
test("player offers retain the same resource on both sides through edits and exchange", () => {
  const g = table();
  give(g, 0, { wood: 3, brick: 1 });
  give(g, 1, { wood: 1, sheep: 1 });
  applyAction(g, 0, {
    type: "offer", targets: [1],
    give: cards({ wood: 2, brick: 1 }), want: cards({ wood: 1, sheep: 1 }),
  });
  const original = g.offers.at(-1)!;
  assert.equal(view(g, "p0").offers[0].give.wood, 2);
  assert.equal(view(g, "p1").offers[0].want.wood, 1);
  applyAction(g, 0, {
    type: "editOffer", id: original.id,
    give: cards({ wood: 3, brick: 1 }), want: cards({ wood: 1, sheep: 1 }),
  });
  const edited = g.offers.at(-1)!;
  applyAction(g, 1, { type: "accept", id: edited.id });
  applyAction(g, 0, { type: "completeTrade", id: edited.id, to: 1 });
  assert.deepEqual(g.players[0].hand, cards({ wood: 1, sheep: 1 }));
  assert.deepEqual(g.players[1].hand, cards({ wood: 3, brick: 1 }));
  conserved(g);
});

test("same-resource counteroffers require the full outgoing cards, not only the net difference", () => {
  const g = table();
  give(g, 0, { wood: 2, brick: 1 });
  give(g, 1, { wood: 1, sheep: 1 });
  const original = offer(g);
  applyAction(g, 1, {
    type: "counterOffer", id: original.id,
    give: cards({ wood: 1, sheep: 1 }), want: cards({ wood: 2, brick: 1 }),
  });
  const counter = g.offers.at(-1)!;
  assert.throws(() => applyAction(g, 1, {
    type: "editOffer", id: counter.id,
    give: cards({ wood: 2, sheep: 1 }), want: cards({ wood: 2, brick: 1 }),
  }), /do not own/);
  applyAction(g, 0, { type: "completeTrade", id: counter.id });
  assert.deepEqual(g.players[0].hand, cards({ wood: 1, sheep: 1 }));
  assert.deepEqual(g.players[1].hand, cards({ wood: 2, brick: 1 }));
  conserved(g);
});

test("offer display gives each participant their own give and receive cards", () => {
  const g = table();
  give(g, 0, { wood: 1 });
  give(g, 1, { brick: 1 });
  const o = timedOffer(g);
  const proposer = tradePerspective(o, g.active, 0);
  const recipient = tradePerspective(o, g.active, 1);
  assert.deepEqual(proposer, {
    give: o.give, receive: o.want, giveFrom: 0, receiveFrom: 1,
  });
  assert.deepEqual(recipient, {
    give: o.want, receive: o.give, giveFrom: 1, receiveFrom: 0,
  });
  applyAction(g, 1, { type: "accept", id: o.id });
  applyAction(g, 0, { type: "completeTrade", id: o.id, to: 1 });
  assert.equal(g.players[0].hand.brick, proposer.receive.brick);
  assert.equal(g.players[1].hand.wood, recipient.receive.wood);
  assert.equal(g.players[0].hand.wood, 0);
  assert.equal(g.players[1].hand.brick, 0);
  assert.equal(view(g, null).log.at(-1), "Host traded 1 wood for 1 brick with Player 1.");
  conserved(g);
});

test("counteroffer display follows the author, executor and joining recipient sides", () => {
  const g = table();
  give(g, 0, { wood: 2 });
  give(g, 1, { brick: 1 });
  give(g, 2, { brick: 1 });
  const original = timedOffer(g, null);
  applyAction(g, 1, {
    type: "counterOffer", id: original.id,
    give: cards({ brick: 1 }), want: cards({ wood: 2 }),
  });
  const o = g.offers.at(-1)!;
  const author = tradePerspective(o, g.active, 1);
  const executor = tradePerspective(o, g.active, 0);
  const joining = tradePerspective(o, g.active, 2);
  assert.deepEqual(author, {
    give: o.give, receive: o.want, giveFrom: 1, receiveFrom: 0,
  });
  assert.deepEqual(executor, {
    give: o.want, receive: o.give, giveFrom: 0, receiveFrom: 1,
  });
  assert.deepEqual(joining, {
    give: o.give, receive: o.want, giveFrom: 2, receiveFrom: 0,
  });
  applyAction(g, 2, { type: "accept", id: o.id });
  applyAction(g, 0, { type: "completeTrade", id: o.id, to: 2 });
  assert.equal(g.players[0].hand.brick, executor.receive.brick);
  assert.equal(g.players[2].hand.wood, joining.receive.wood);
  assert.equal(g.players[1].hand.brick, 1);
  assert.equal(view(g, null).log.at(-1), "Player 2 traded 1 brick for 2 wood with Host.");
  conserved(g);
});

test("spectators see the author's side and rush offers use their explicit executor", () => {
  const g = table();
  give(g, 0, { wood: 1 });
  const o = timedOffer(g, null);
  assert.deepEqual(tradePerspective(o, g.active, -1), {
    give: o.give, receive: o.want, giveFrom: 0, receiveFrom: null,
  });
  const rushCounter = { ...o, from: 1, replyTo: o.id, executor: 0 };
  assert.equal(tradePerspective(rushCounter, 3, 0).give, o.want);
  assert.equal(tradePerspective(rushCounter, 3, 2).give, o.give);
});

test("trade cooldown constants and server expiry work independently of turn clocks", () => {
  assert.deepEqual(
    [0, 15, 30, 60, 120, 200, 240, 9000, 12000].map(tradeCooldown),
    [60000, 12000, 20000, 30000, 45000, 60000, 60000, 90000, 90000],
  );
  const g = table();
  g.turnSeconds = 0;
  give(g, 0, { wood: 1 });
  give(g, 1, { brick: 1 });
  const o = timedOffer(g);
  assert.equal(o.responseDeadlines[1], 61000);
  assert.equal(g.deadline, null);
  assert(!needsTradeUpdate(g, 60999));
  assert(needsTradeUpdate(g, 61000));
  advanceClock(g, 61000);
  assert.deepEqual(o.expired, [1]);
  assert.deepEqual(o.rejected, [1]);
  assert.equal(o.closeAt, 63000);
  assert.equal(g.offers.length, 1);
  advanceClock(g, 63000);
  assert.equal(g.offers.length, 0);
  assert.equal(g.phase, "action");
  conserved(g);
});
test("15-second rooms expose finite response timers to participants, not spectators", () => {
  const g = table();
  g.turnSeconds = 15;
  give(g, 0, { wood: 1 });
  give(g, 1, { brick: 1 });
  const offer = timedOffer(g);
  assert.equal(offer.responseDeadlines[1], 13000);
  assert.equal(view(g, "p1").offers[0].responseDeadline, 13000);
  assert.equal(view(g, "p1").offers[0].responseDuration, 12000);
  assert.equal(view(g, "p0").offers[0].responseDeadline, 13000);
  assert.equal(view(g, "p0").offers[0].responseDuration, 12000);
  assert.equal(view(g, null).offers[0].responseDeadline, null);
  assert.equal(view(g, null).offers[0].responseDuration, null);
  advanceClock(g, 13000);
  assert(offer.expired.includes(1));
  conserved(g);
});
test("outgoing timers follow the last pending timed response and disappear after responses", () => {
  const g = table();
  give(g, 0, { wood: 1 });
  give(g, 1, { brick: 1 });
  give(g, 2, { ore: 1 });
  give(g, 3, { brick: 1 });
  at(g, 3, { type: "tradePreference", autoReject: false }, 1000);
  const o = timedOffer(g, null);
  assert.equal(view(g, "p0").offers[0].responseDeadline, 31000);
  assert.equal(view(g, "p0").offers[0].responseDuration, 30000);
  at(g, 1, { type: "accept", id: o.id }, 2000);
  assert.equal(view(g, "p0").offers[0].responseDeadline, 23500);
  assert.equal(view(g, "p0").offers[0].responseDuration, 22500);
  at(g, 2, { type: "prepareCounter", id: o.id, preparing: true }, 3000);
  assert.equal(view(g, "p0").offers[0].responseDeadline, null);
  at(g, 2, { type: "prepareCounter", id: o.id, preparing: false }, 4000);
  assert.equal(view(g, "p0").offers[0].responseDeadline, 26500);
  g.phase = "roadBuilding";
  advanceClock(g, 5000);
  assert.equal(view(g, "p0").offers[0].pausedAt, 5000);
  g.phase = "action";
  advanceClock(g, 10000);
  assert.equal(view(g, "p0").offers[0].responseDeadline, 31500);
  advanceClock(g, 31500);
  assert(o.expired.includes(2));
  assert.equal(view(g, "p0").offers[0].responseDeadline, null);
  assert.equal(view(g, "p0").offers[0].responseDuration, null);
  assert(!("responseDeadlines" in view(g, "p0").offers[0]));
  conserved(g);
});
test("recipient deadlines and auto-reject preferences never expose another player's private state", () => {
  const g = table();
  give(g, 0, { wood: 1 });
  give(g, 1, { ore: 1 });
  const o = timedOffer(g, null);
  assert.equal(o.responseDeadlines[1], 23500);
  assert(o.expired.includes(2));
  const mine = view(g, "p1"),
    watch = view(g, null);
  assert.equal(mine.offers[0].responseDeadline, 23500);
  assert.equal(mine.offers[0].responseDuration, 22500);
  assert.equal(watch.offers[0].responseDeadline, null);
  assert.equal(watch.offers[0].responseDuration, null);
  assert(
    !("responseDeadlines" in watch.offers[0]) &&
      !("responseDurations" in watch.offers[0]) &&
      !("preparingUntil" in watch.offers[0]),
  );
  assert.equal(mine.players[1].autoRejectTrades, true);
  assert(
    watch.players.every(
      (p) => !p.hand && !p.dev && p.autoRejectTrades === undefined,
    ),
  );
});
test("keeping trades open persists through reconnect and re-enabling expiry starts a fresh cooldown", () => {
  const g = table();
  g.turnSeconds = 0;
  give(g, 0, { wood: 1 });
  give(g, 1, { brick: 1 });
  const o = timedOffer(g);
  at(g, 1, { type: "tradePreference", autoReject: false }, 5000);
  assert.equal(o.responseDeadlines[1], null);
  assert.equal(view(g, "p1").offers[0].responseDuration, null);
  advanceClock(g, 50000);
  assert.equal(g.offers.length, 1);
  const loaded = JSON.parse(JSON.stringify(g)) as Game;
  normalizeGame(loaded);
  assert.equal(view(loaded, "p1").players[1].autoRejectTrades, false);
  at(loaded, 1, { type: "tradePreference", autoReject: true }, 51000);
  assert.equal(loaded.offers[0].responseDeadlines[1], 111000);
  assert.equal(view(loaded, "p1").offers[0].responseDuration, 60000);
  at(loaded, 1, { type: "accept", id: o.id }, 52000);
  advanceClock(loaded, 100000);
  assert.deepEqual(loaded.offers[0].accepted, [1]);
  conserved(loaded);
});
test("counteroffer preparation pauses response expiry and abandoned drafts release their lease", () => {
  const g = table();
  g.turnSeconds = 0;
  give(g, 0, { wood: 1 });
  give(g, 1, { brick: 1 });
  const o = timedOffer(g);
  at(g, 1, { type: "prepareCounter", id: o.id, preparing: true }, 2000);
  advanceClock(g, 30000);
  assert.deepEqual(o.preparing, [1]);
  assert.deepEqual(o.rejected, []);
  at(g, 1, { type: "prepareCounter", id: o.id, preparing: false }, 30000);
  assert.equal(o.responseDeadlines[1], 90000);
  at(g, 1, { type: "prepareCounter", id: o.id, preparing: true }, 31000);
  advanceClock(g, 77000);
  assert.deepEqual(o.preparing, []);
  assert.equal(o.responseDeadlines[1], 137000);
  assert.equal(view(g, "p1").offers[0].responseDuration, 60000);
  assert.equal(g.deadline, null);
  conserved(g);
});
test("response deadlines pause during required game choices and resume with their remaining time", () => {
  const g = table();
  g.turnSeconds = 0;
  give(g, 0, { wood: 1 });
  give(g, 1, { brick: 1 });
  const o = timedOffer(g);
  g.phase = "roadBuilding";
  advanceClock(g, 2000);
  assert.equal(o.pausedAt, 2000);
  advanceClock(g, 22000);
  assert.deepEqual(o.rejected, []);
  g.phase = "action";
  advanceClock(g, 22000);
  assert.equal(o.pausedAt, null);
  assert.equal(o.responseDeadlines[1], 81000);
  assert.equal(view(g, "p1").offers[0].responseDuration, 60000);
  conserved(g);
});
test("selected recipients bound counteroffer participation and other eligible players can join", () => {
  const g = table();
  g.turnSeconds = 0;
  give(g, 0, { wood: 2 });
  for (let p = 1; p < 4; p++) give(g, p, { brick: 1 });
  const o = timedOffer(g, [1, 2]);
  assert.throws(
    () => at(g, 3, { type: "accept", id: o.id }, 2000),
    /unavailable/,
  );
  assert.throws(
    () =>
      at(
        g,
        3,
        {
          type: "counterOffer",
          id: o.id,
          give: cards({ brick: 1 }),
          want: cards({ wood: 1 }),
        },
        2000,
      ),
    /unavailable/,
  );
  at(
    g,
    1,
    {
      type: "counterOffer",
      id: o.id,
      give: cards({ brick: 1 }),
      want: cards({ wood: 1 }),
    },
    2000,
  );
  const counter = g.offers[1];
  assert.deepEqual(counter.targets, [1, 2]);
  at(g, 2, { type: "accept", id: counter.id }, 3000);
  at(g, 0, { type: "completeTrade", id: counter.id, to: 2 }, 4000);
  assert.equal(g.players[2].hand.wood, 1);
  assert.equal(g.players[1].hand.brick, 1);
  assert.equal(g.players[0].hand.brick, 1);
  conserved(g);
});
test("trade blocking revokes existing consent and either player's block prevents an exchange", () => {
  const g = table();
  g.turnSeconds = 0;
  give(g, 0, { wood: 2 });
  give(g, 1, { brick: 1 });
  give(g, 2, { brick: 1 });
  const o = timedOffer(g, [1, 2]);
  at(g, 1, { type: "accept", id: o.id }, 2000);
  at(g, 0, { type: "embargo", to: 1, blocked: true }, 3000);
  assert.deepEqual(o.accepted, []);
  assert(o.blocked.includes(1));
  assert.throws(() => at(g, 1, { type: "accept", id: o.id }, 4000), /blocked/);
  at(g, 1, { type: "embargo", to: 0, blocked: true }, 4000);
  at(g, 0, { type: "embargo", to: 1, blocked: false }, 5000);
  assert(o.blocked.includes(1));
  at(g, 1, { type: "embargo", to: 0, blocked: false }, 6000);
  assert(!o.blocked.includes(1));
  assert.equal(o.responseDeadlines[1], 66000);
  assert.deepEqual(o.accepted, []);
  at(g, 2, { type: "accept", id: o.id }, 7000);
  at(g, 0, { type: "completeTrade", id: o.id, to: 2 }, 8000);
  conserved(g);
});
test("editing recipients resets consent and a live counteroffer keeps its rejected parent available", () => {
  const g = table();
  g.turnSeconds = 0;
  give(g, 0, { wood: 2 });
  give(g, 1, { brick: 1 });
  give(g, 2, { brick: 1 });
  const o = timedOffer(g, [1, 2]);
  at(g, 1, { type: "accept", id: o.id }, 2000);
  at(
    g,
    0,
    {
      type: "editOffer",
      id: o.id,
      targets: [2],
      give: cards({ wood: 1 }),
      want: cards({ brick: 1 }),
    },
    3000,
  );
  const next = g.offers[0];
  assert.deepEqual(next.targets, [2]);
  assert.deepEqual(next.accepted, []);
  assert.throws(
    () => at(g, 1, { type: "accept", id: next.id }, 4000),
    /unavailable/,
  );
  at(
    g,
    2,
    {
      type: "counterOffer",
      id: next.id,
      give: cards({ brick: 1 }),
      want: cards({ wood: 1 }),
    },
    4000,
  );
  advanceClock(g, 50000);
  assert.equal(g.offers.length, 2);
  at(g, 0, { type: "completeTrade", id: g.offers[1].id }, 51000);
  conserved(g);
});
test("eight-seat acceptance is reversible and the offerer chooses one partner", () => {
  const g = table(8);
  give(g, 0, { wood: 2 });
  for (let p = 1; p < 8; p++) give(g, p, { brick: 1 });
  const o = offer(g);
  for (let p = 1; p < 8; p++) applyAction(g, p, { type: "accept", id: o.id });
  assert.deepEqual(o.accepted, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(g.players[0].hand.brick, 0);
  applyAction(g, 1, { type: "accept", id: o.id });
  assert.equal(o.accepted.length, 7);
  applyAction(g, 1, { type: "reject", id: o.id });
  assert(!o.accepted.includes(1));
  applyAction(g, 1, { type: "accept", id: o.id });
  assert(!o.rejected.includes(1));
  assert.throws(
    () => applyAction(g, 1, { type: "completeTrade", id: o.id, to: 0 }),
    /executor/,
  );
  const spectator = view(g, null);
  assert.equal(spectator.offers[0].accepted.length, 7);
  assert(spectator.players.every((p) => !p.hand && !p.dev));
  applyAction(g, 0, { type: "completeTrade", id: o.id, to: 7 });
  assert.equal(g.players[7].hand.wood, 1);
  assert.equal(g.players[1].hand.brick, 1);
  assert.equal(g.offers.length, 0);
  assert.throws(
    () => applyAction(g, 0, { type: "completeTrade", id: o.id, to: 2 }),
    /unavailable/,
  );
  conserved(g);
});
test("counteroffer preparation keeps the parent open and preserves the action clock", () => {
  const g = table();
  g.turnSeconds = 30;
  give(g, 0, { wood: 2 });
  give(g, 1, { brick: 2 });
  const o = offer(g),
    deadline = g.deadline;
  applyAction(g, 1, { type: "prepareCounter", id: o.id, preparing: true });
  assert.deepEqual(o.preparing, [1]);
  assert.equal(g.deadline, deadline);
  applyAction(g, 1, { type: "prepareCounter", id: o.id, preparing: false });
  assert.deepEqual(o.preparing, []);
  assert.equal(g.offers.length, 1);
  applyAction(g, 1, {
    type: "counterOffer",
    id: o.id,
    give: cards({ brick: 2 }),
    want: cards({ wood: 1 }),
  });
  const counter = g.offers[1];
  assert.equal(counter.replyTo, o.id);
  assert.equal(counter.to, 0);
  assert.equal(tradeExecutor(counter, 0), 0);
  assert.equal(g.offers.length, 2);
  assert.equal(g.players[0].hand.brick, 0);
  assert.throws(
    () => applyAction(g, 2, { type: "completeTrade", id: counter.id }),
    /executor/,
  );
  applyAction(g, 0, { type: "completeTrade", id: counter.id });
  assert.equal(g.players[0].hand.brick, 2);
  assert.equal(g.players[1].hand.wood, 1);
  assert.equal(g.deadline, deadline! + 5000);
  conserved(g);
});
test("an active-player counter to a counter awaits the other player's consent", () => {
  const g = table();
  give(g, 0, { wood: 2 });
  give(g, 1, { brick: 3 });
  const o = offer(g);
  applyAction(g, 1, {
    type: "counterOffer",
    id: o.id,
    give: cards({ brick: 2 }),
    want: cards({ wood: 1 }),
  });
  const reply = g.offers[1];
  applyAction(g, 0, { type: "prepareCounter", id: reply.id, preparing: true });
  applyAction(g, 0, {
    type: "counterOffer",
    id: reply.id,
    give: cards({ wood: 1 }),
    want: cards({ brick: 3 }),
  });
  const next = g.offers[2];
  assert.equal(tradeExecutor(next, 0), 0);
  assert.deepEqual(reply.preparing, []);
  assert.throws(
    () => applyAction(g, 0, { type: "completeTrade", id: next.id, to: 1 }),
    /accepted/,
  );
  applyAction(g, 1, { type: "accept", id: next.id });
  applyAction(g, 0, { type: "completeTrade", id: next.id, to: 1 });
  assert.equal(g.players[0].hand.brick, 3);
  conserved(g);
});
test("declining a counter closes it while retaining its original offer", () => {
  const g = table();
  give(g, 0, { wood: 2 });
  give(g, 1, { brick: 2 });
  const original = offer(g);
  applyAction(g, 1, {
    type: "counterOffer",
    id: original.id,
    give: cards({ brick: 2 }),
    want: cards({ wood: 1 }),
  });
  applyAction(g, 0, { type: "reject", id: g.offers[1].id });
  assert.deepEqual(
    g.offers.map((o) => o.id),
    [original.id],
  );
  conserved(g);
});
test("editing invalidates old clicks and descendants while retaining unrelated offers", () => {
  const g = table();
  give(g, 0, { wood: 3 });
  give(g, 1, { brick: 2 });
  const first = offer(g),
    unrelated = offer(g);
  applyAction(g, 1, { type: "accept", id: first.id });
  applyAction(g, 1, {
    type: "counterOffer",
    id: first.id,
    give: cards({ brick: 2 }),
    want: cards({ wood: 1 }),
  });
  const counter = g.offers.at(-1)!;
  assert.throws(
    () =>
      applyAction(g, 1, {
        type: "editOffer",
        id: first.id,
        give: cards({ brick: 1 }),
        want: cards({ wood: 2 }),
      }),
    /own offer/,
  );
  applyAction(g, 0, {
    type: "editOffer",
    id: first.id,
    give: cards({ wood: 2 }),
    want: cards({ brick: 1 }),
  });
  const replacement = g.offers.at(-1)!;
  assert.notEqual(replacement.id, first.id);
  assert.deepEqual(replacement.accepted, []);
  assert(g.offers.some((o) => o.id === unrelated.id));
  assert(!g.offers.some((o) => o.id === counter.id));
  assert.throws(
    () => applyAction(g, 0, { type: "completeTrade", id: first.id, to: 1 }),
    /unavailable/,
  );
  assert.throws(
    () => applyAction(g, 2, { type: "cancelOffer", id: replacement.id }),
    /own offer/,
  );
  applyAction(g, 0, { type: "cancelOffer", id: replacement.id });
  assert.equal(g.offers.length, 1);
  conserved(g);
});
test("open-ended trades require a concrete counteroffer and cannot gift resources", () => {
  const g = table();
  give(g, 0, { wood: 2 });
  give(g, 1, { brick: 1 });
  applyAction(g, 0, {
    type: "offer",
    give: cards({ wood: 1 }),
    want: emptyHand(),
  });
  const o = g.offers[0];
  assert.throws(
    () => applyAction(g, 1, { type: "accept", id: o.id }),
    /open side/,
  );
  assert.throws(
    () => applyAction(g, 0, { type: "completeTrade", id: o.id, to: 1 }),
    /accepted/,
  );
  assert.throws(
    () =>
      applyAction(table(), 0, {
        type: "offer",
        give: emptyHand(),
        want: cards({ wood: 1 }),
      }),
    /cards in hand/,
  );
  applyAction(g, 1, {
    type: "counterOffer",
    id: o.id,
    give: cards({ brick: 1 }),
    want: cards({ wood: 1 }),
  });
  applyAction(g, 0, { type: "completeTrade", id: g.offers[1].id });
  assert.equal(g.players[0].hand.brick, 1);
  conserved(g);
});
test("confirmation revalidates cards and rejects unauthorized or outdated partners", () => {
  const g = table();
  give(g, 0, { wood: 4 });
  give(g, 1, { brick: 1 });
  const o = offer(g);
  applyAction(g, 1, { type: "accept", id: o.id });
  applyAction(g, 0, {
    type: "bankTrade",
    give: cards({ wood: 4 }),
    want: cards({ ore: 1 }),
  });
  const before = JSON.stringify(g.players);
  assert.throws(
    () => applyAction(g, 0, { type: "completeTrade", id: o.id, to: 1 }),
    /no longer/,
  );
  assert.equal(JSON.stringify(g.players), before);
  assert.throws(
    () => applyAction(g, 0, { type: "completeTrade", id: o.id, to: 2 }),
    /accepted/,
  );
  applyAction(g, 0, { type: "end" });
  assert.equal(g.offers.length, 0);
  conserved(g);
});
test("persisted legacy offers normalize without implying anyone's acceptance", () => {
  const g = table();
  give(g, 0, { wood: 1 });
  const o = offer(g);
  delete (o as Partial<typeof o>).accepted;
  delete (o as Partial<typeof o>).preparing;
  delete (o as Partial<typeof o>).replyTo;
  normalizeGame(g);
  assert.deepEqual([o.accepted, o.preparing, o.replyTo], [[], [], null]);
  const reloaded = JSON.parse(JSON.stringify(g)) as Game;
  assert.deepEqual(view(reloaded, "p0").offers, view(g, "p0").offers);
});
