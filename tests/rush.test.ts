import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import { assertStatistics } from "./statistics-assertions";
import { assertRecordedTransition } from "./replay-assertions";
import test from "node:test";
import assert from "node:assert/strict";
import { emptyHand, RESOURCES } from "../lib/board";
import {
  createGame,
  player,
  addPlayer,
  actor,
  advanceClock,
  view,
  Game,
  legalRoads,
  moveContext,
  normalizeGame,
  points,
} from "../lib/game";
import { chooseRushMove } from "./rush-match-driver";
import { gameSounds, needsMyAction } from "../lib/game-sounds";
function random(seed: number) {
  return () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function table(n = 4) {
  const g = createGame("RUSH22", player("p0", "P0"), n, false, "rush");
  for (let p = 1; p < n; p++) addPlayer(g, player(`p${p}`, `P${p}`));
  g.players.forEach((p) => {
    p.ready = true;
    p.autoRejectTrades = false;
  });
  applyAction(g, 0, { type: "start" }, random(1), 1000);
  while (g.phase.startsWith("setup")) {
    const p = actor(g),
      a = chooseRushMove(view(g, `p${p}`));
    assert(a);
    applyAction(g, p, a, random(1), 1000);
  }
  assert.equal(g.phase, "action");
  return g;
}
function give(
  g: Game,
  p: number,
  resources: Partial<Record<(typeof RESOURCES)[number], number>>,
) {
  for (const key of RESOURCES) {
    const amount = resources[key] ?? 0;
    assert(g.bank[key] >= amount);
    g.bank[key] -= amount;
    g.players[p].hand[key] += amount;
  }
}
function card(
  g: Game,
  p: number,
  kind: "knight" | "roadBuilding" | "monopoly",
) {
  const index = g.deck.indexOf(kind);
  assert(index >= 0);
  g.deck.splice(index, 1);
  g.players[p].dev.push({ kind, bought: g.turn });
}
function inventory(g: Game) {
  for (const key of RESOURCES) {
    const stock = [g.bank[key], ...g.players.map((p) => p.hand[key])];
    assert(stock.every((n) => Number.isInteger(n) && n >= 0));
    assert.equal(
      stock.reduce((n, a) => n + a, 0),
      g.capacity <= 4 ? 19 : g.capacity <= 6 ? 24 : 29,
    );
  }
  for (let p = 0; p < g.players.length; p++) {
    assert(g.board.edges.filter((e) => e.owner === p).length <= 15);
    assert(g.board.vertices.filter((v) => v.owner === p && v.city).length <= 4);
    assert(
      g.board.vertices.filter((v) => v.owner === p && !v.city).length <= 5,
    );
  }
}
test("Rush preset, supported seats and mandatory timer settings validate atomically", () => {
  const g = createGame("RUSH22", player("p0", "P0"), 8, false, "rush");
  assert.deepEqual(
    [
      g.target,
      g.discardLimit,
      g.friendlyRobber,
      g.turnSeconds,
      g.bank.wood,
      g.board.tiles.length,
    ],
    [10, 9, false, 5, 19, 19],
  );
  const before = JSON.stringify(g);
  assert.throws(
    () => applyAction(g, 0, { type: "settings", turnSeconds: 0, target: 15 }),
    /timer/,
  );
  assert.equal(JSON.stringify(g), before);
  applyAction(g, 0, { type: "settings", turnSeconds: 8 });
  assert.equal(g.turnSeconds, 8);
  assert.throws(() =>
    createGame("RUSH22", player("p0", "P0"), 2, false, "rush"),
  );
});
test("automatic rolls occur once and unanimous irreversible votes roll early", () => {
  const g = table(3),
    start = g.rush!.rollAt!;
  assert.equal(start, 6000);
  advanceClock(g, start - 1, () => 0);
  assert.equal(g.turn, 0);
  advanceClock(g, start, () => 0);
  assert.deepEqual(g.dice, [1, 1]);
  assert.equal(g.turn, 1);
  advanceClock(g, start, () => 0);
  assert.equal(g.turn, 1);
  for (const p of [2, 0])
    applyAction(g, p, { type: "voteRoll" }, () => 0, start + 1);
  assert.equal(g.turn, 1);
  const before = JSON.stringify(g);
  assert.throws(
    () => applyAction(g, 2, { type: "voteRoll" }, () => 0, start + 1),
    /already/,
  );
  assert.equal(JSON.stringify(g), before);
  applyAction(g, 1, { type: "voteRoll" }, () => 0, start + 1);
  assert.equal(g.turn, 2);
  assert.deepEqual(g.rush!.votes, []);
  assert.throws(() => applyAction(g, 0, { type: "roll" }), /automatically/);
  assert.throws(() => applyAction(g, 0, { type: "end" }), /automatically/);
  inventory(g);
});
test("every seat can build while another seat owns a robber or free-road choice", () => {
  const g = table();
  g.friendlyRobber = false;
  card(g, 0, "knight");
  applyAction(g, 0, { type: "knight" }, () => 0, 1200);
  assert.equal(view(g, "p0").phase, "robber");
  assert.equal(view(g, "p1").phase, "action");
  assert.equal(view(g, "p1").active, 1);
  assert.equal(moveContext(view(g, "p0")), moveContext(g, 0));
  assert.notEqual(moveContext(g, 0), moveContext(g, 1));
  give(g, 1, { ore: 3, wheat: 2 });
  const city = g.board.vertices.find((v) => v.owner === 1)!;
  applyAction(g, 1, { type: "city", id: city.id }, () => 0, 1300);
  assert(g.board.vertices[city.id].city);
  assert.equal(g.rush!.robberOwner, 0);
  card(g, 2, "knight");
  applyAction(g, 2, { type: "knight" }, () => 0, 1400);
  assert.equal(g.rush!.robberOwner, 0);
  assert.deepEqual(g.rush!.robberQueue, [2]);
  const target =
    view(g, "p0").legal.robber.find((id) =>
      g.board.tiles[id].vertices.every(
        (v) => g.board.vertices[v].owner === null,
      ),
    ) ?? view(g, "p0").legal.robber[0];
  applyAction(g, 0, { type: "robber", id: target }, () => 0, 1500);
  if (g.rush!.robberOwner === 0)
    applyAction(
      g,
      0,
      { type: "steal", id: view(g, "p0").victims[0] },
      () => 0,
      1500,
    );
  assert.equal(g.rush!.robberOwner, 2);
  card(g, 1, "roadBuilding");
  applyAction(g, 1, { type: "roadBuilding" }, () => 0, 1600);
  assert.equal(view(g, "p1").phase, "roadBuilding");
  assert.equal(view(g, "p1").freeRoads, 2);
  assert.equal(view(g, "p3").phase, "action");
  give(g, 3, { ore: 3, wheat: 2 });
  applyAction(
    g,
    3,
    { type: "city", id: view(g, "p3").legal.city[0] },
    () => 0,
    1700,
  );
  applyAction(
    g,
    1,
    { type: "road", id: view(g, "p1").legal.road[0] },
    () => 0,
    1800,
  );
  assert.equal(g.rush!.seats[1].freeRoads, 1);
  assert.throws(() => applyAction(g, 1, { type: "skipRoads" }, () => 0, 1900), /remaining free routes/);
  applyAction(g, 1, { type: "road", id: view(g, "p1").legal.road[0] }, () => 0, 1900);
  assert.equal(view(g, "p1").phase, "action");
  inventory(g);
});
test("a seven globally locks play during discards, pauses choices, and rotates robber control", () => {
  const g = table(3);
  g.friendlyRobber = false;
  card(g, 2, "roadBuilding");
  applyAction(g, 2, { type: "roadBuilding" }, () => 0, 2000);
  const choice = g.rush!.seats[2].until!;
  give(g, 0, { wood: 10 });
  let die = 0;
  advanceClock(g, 6000, () => (die++ % 2 ? 0.5 : 0.34));
  assert.equal(g.phase, "discard");
  assert.equal(g.rush!.nextRobber, 1);
  assert.equal(g.rush!.rollAt, null);
  const before = JSON.stringify(g);
  assert.throws(
    () => applyAction(g, 1, { type: "buyDev" }, () => 0, 7000),
    /discards/,
  );
  assert.equal(JSON.stringify(g), before);
  assert.throws(
    () =>
      applyAction(
        g,
        2,
        { type: "road", id: legalRoads(g, 2)[0] },
        () => 0,
        7000,
      ),
    /discards/,
  );
  const amount = g.discards[0],
    h = emptyHand();
  h.wood = amount;
  applyAction(g, 0, { type: "discard", resources: h }, () => 0, 9000);
  assert.equal(g.phase, "action");
  assert.equal(g.rush!.rollAt, 14000);
  assert.equal(g.rush!.seats[2].until, choice + 3000);
  assert.equal(g.rush!.robberOwner, 0);
  inventory(g);
});
test("Rush trades have independent executors, hide unusable offers, and preserve unrelated offers", () => {
  const g = table();
  give(g, 1, { wood: 2 });
  give(g, 2, { brick: 2 });
  const giveWood = { ...emptyHand(), wood: 1 },
    wantBrick = { ...emptyHand(), brick: 1 };
  applyAction(
    g,
    1,
    { type: "offer", give: giveWood, want: wantBrick, targets: [2] },
    () => 0,
    1200,
  );
  const offer = g.offers[0];
  assert.equal(offer.executor, 1);
  assert(view(g, "p2").offers.some((o) => o.id === offer.id));
  assert(!view(g, "p3").offers.some((o) => o.id === offer.id));
  applyAction(
    g,
    2,
    { type: "offer", give: wantBrick, want: giveWood, targets: [1] },
    () => 0,
    1200,
  );
  const unrelated = g.offers[1].id;
  applyAction(g, 2, { type: "accept", id: offer.id }, () => 0, 1300);
  const h1 = { ...g.players[1].hand },
    h2 = { ...g.players[2].hand };
  applyAction(
    g,
    1,
    { type: "completeTrade", id: offer.id, to: 2 },
    () => 0,
    1400,
  );
  assert.equal(g.players[1].hand.wood, h1.wood - 1);
  assert.equal(g.players[2].hand.brick, h2.brick - 1);
  assert(g.offers.some((o) => o.id === unrelated));
  applyAction(g, 1, { type: "reject", id: unrelated }, () => 0, 1500);
  assert(!view(g, "p1").offers.some((o) => o.id === unrelated));
  inventory(g);
});
test("forced-choice expiry places remaining free roads, and legacy rooms keep their rules", () => {
  const g = table(3);
  card(g, 1, "roadBuilding");
  applyAction(g, 1, { type: "roadBuilding" }, () => 0, 1200);
  const roads = g.board.edges.filter((e) => e.owner === 1).length;
  advanceClock(g, g.rush!.seats[1].until!, () => 0);
  assert.equal(g.rush!.seats[1].freeRoads, 0);
  assert.equal(g.board.edges.filter((e) => e.owner === 1).length, roads + 2);
  const old = createGame("OLDM22", player("a", "A"));
  delete (old as Partial<Game>).rush;
  normalizeGame(old);
  assert.equal(old.rush, null);
  inventory(g);
});
test("Rush counteroffer chains keep their original executor and recheck spent cards", () => {
  const g = table();
  give(g, 1, { wood: 4 });
  give(g, 2, { brick: 3 });
  give(g, 3, { brick: 3 });
  const wood = { ...emptyHand(), wood: 2 },
    brick = { ...emptyHand(), brick: 1 };
  applyAction(
    g,
    1,
    { type: "offer", give: wood, want: brick, targets: [2, 3] },
    () => 0,
    1200,
  );
  const root = g.offers[0].id;
  applyAction(
    g,
    2,
    { type: "counterOffer", id: root, give: brick, want: { ...wood, wood: 1 } },
    () => 0,
    1300,
  );
  const counter = g.offers.at(-1)!;
  assert.equal(counter.executor, 1);
  assert(view(g, "p1").offers.some((o) => o.id === counter.id));
  applyAction(g, 3, { type: "accept", id: counter.id }, () => 0, 1400);
  const h1 = { ...g.players[1].hand },
    h3 = { ...g.players[3].hand };
  applyAction(
    g,
    1,
    { type: "completeTrade", id: counter.id, to: 3 },
    () => 0,
    1500,
  );
  assert.equal(g.players[1].hand.wood, h1.wood - 1);
  assert.equal(g.players[3].hand.brick, h3.brick - 1);
  assert(g.offers.some((o) => o.id === root));
  applyAction(g, 2, { type: "accept", id: root }, () => 0, 1600);
  // A simultaneous bank exchange can invalidate already accepted terms.
  const amount = g.players[1].hand.wood;
  g.bank.wood += amount;
  g.players[1].hand.wood = 0;
  const before = JSON.stringify(g);
  assert.throws(
    () =>
      applyAction(
        g,
        1,
        { type: "completeTrade", id: root, to: 2 },
        () => 0,
        1700,
      ),
    /no longer/,
  );
  assert.equal(JSON.stringify(g), before);
  inventory(g);
});
test("Knights can be chained in one roll and a scoring action wins immediately", () => {
  const g = table(3);
  g.friendlyRobber = false;
  for (let i = 0; i < 3; i++) {
    card(g, 1, "knight");
    applyAction(g, 1, { type: "knight" }, () => 0, 1200 + i);
    assert.equal(g.players[1].knights, i + 1);
    applyAction(
      g,
      1,
      { type: "robber", id: view(g, "p1").legal.robber[0] },
      () => 0,
      1200 + i,
    );
    if (view(g, "p1").phase === "steal")
      applyAction(
        g,
        1,
        { type: "steal", id: view(g, "p1").victims[0] },
        () => 0,
        1200 + i,
      );
  }
  assert.equal(g.army, 1);
  assert.equal(g.turn, 0);
  assert.equal(view(g, "p0").phase, "action");
  g.target = points(g, 1) + 1;
  give(g, 1, { ore: 3, wheat: 2 });
  applyAction(
    g,
    1,
    { type: "city", id: view(g, "p1").legal.city[0] },
    () => 0,
    1500,
  );
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 1);
  assert.equal(g.deadline, null);
  inventory(g);
});
test("automatic Rush rolls do not repeat a pending-action sound", () => {
  const g = table(3);
  g.friendlyRobber = false;
  let previous = structuredClone(view(g, "p0"));
  assert.equal(needsMyAction(previous), false);
  card(g, 0, "knight");
  applyAction(g, 0, { type: "knight" }, () => 0, 1200);
  g.revision++;
  let next = structuredClone(view(g, "p0"));
  assert(gameSounds(previous, next).includes("your_turn"));
  previous = next;
  advanceClock(g, 6000, () => 0);
  g.revision++;
  next = structuredClone(view(g, "p0"));
  assert(
    gameSounds(previous, next).some((sound) => sound.startsWith("dice_roll_")),
  );
  assert(!gameSounds(previous, next).includes("your_turn"));
  assert.equal(needsMyAction(view(g, "p1")), false);
});
test("the first simultaneous road placement wins its space without charging the second player", () => {
  const g = table(3);
  const contested = g.board.edges.find(
    (e) =>
      e.owner === null &&
      [e.a, e.b].every(
        (id) =>
          g.board.vertices[id].owner === null &&
          g.board.vertices[id].edges.some(
            (eid) => eid !== e.id && g.board.edges[eid].owner === null,
          ),
      ),
  )!;
  assert(contested);
  for (const [endpoint, p] of [
    [contested.a, 1],
    [contested.b, 2],
  ]) {
    const connection = g.board.vertices[endpoint].edges.find(
      (id) => id !== contested.id && g.board.edges[id].owner === null,
    )!;
    g.board.edges[connection].owner = p;
    give(g, p, { wood: 1, brick: 1 });
    assert(view(g, `p${p}`).legal.road.includes(contested.id));
  }
  applyAction(g, 1, { type: "road", id: contested.id }, () => 0, 1200);
  const before = JSON.stringify(g);
  assert.throws(
    () => applyAction(g, 2, { type: "road", id: contested.id }, () => 0, 1200),
    /legal|connect|road/i,
  );
  assert.equal(JSON.stringify(g), before);
  inventory(g);
});
test("a concurrent Monopoly clears an exhausted steal choice immediately", () => {
  const g = table(4);
  g.friendlyRobber = false;
  for (const p of g.players)
    for (const key of RESOURCES) {
      g.bank[key] += p.hand[key];
      p.hand[key] = 0;
    }
  give(g, 1, { wood: 1 });
  give(g, 3, { wood: 1 });
  card(g, 0, "knight");
  card(g, 2, "monopoly");
  applyAction(g, 0, { type: "knight" }, () => 0, 1200);
  const tile = view(g, "p0").legal.robber.find((id) =>
    g.board.tiles[id].vertices.some((v) => g.board.vertices[v].owner === 1),
  )!;
  assert.notEqual(tile, undefined);
  g.board.vertices[g.board.tiles[tile].vertices.find(v => g.board.vertices[v].owner === null)!].owner = 3;
  applyAction(g, 0, { type: "robber", id: tile }, () => 0, 1300);
  assert.equal(view(g, "p0").phase, "steal");
  applyAction(g, 2, { type: "monopoly", resource: "wood" }, () => 0, 1400);
  assert.equal(g.rush!.robberOwner, null);
  assert.equal(view(g, "p0").phase, "action");
  assert.equal(g.players[2].hand.wood, 2);
  inventory(g);
});
test("discard and robber timeouts finish mandatory choices without replaying missed dice", () => {
  const g = table(3);
  g.friendlyRobber = false;
  give(g, 0, { wood: 10 });
  give(g, 1, { brick: 10 });
  let die = 0;
  advanceClock(g, 6000, () => (die++ % 2 ? 0.5 : 0.34));
  assert.equal(Object.keys(g.discards).length, 2);
  advanceClock(g, 26000, () => 0);
  assert.deepEqual(g.discards, {});
  assert.equal(g.phase, "action");
  assert.equal(g.rush!.robberOwner, 0);
  assert.equal(g.rush!.rollAt, 31000);
  advanceClock(g, 46000, () => 0);
  if (g.rush!.robberOwner !== null) advanceClock(g, 66000, () => 0);
  assert.equal(g.rush!.robberOwner, null);
  assert(
    g.turn <= 3,
    "An offline table does not replay every missed dice interval.",
  );
  inventory(g);
});
for (const n of [3, 4, 8])
  test(`complete ${n}-seat Rush match uses permitted views and reaches its default target`, () => {
    const g = table(n),
      rng = random(1234 + n);
    let now = 1000,
      moves = 0;
    for (let round = 0; round < 2500 && g.phase !== "finished"; round++) {
      let changed = false;
      for (let p = 0; p < n && (g.phase as Game["phase"]) !== "finished"; p++) {
        const a = chooseRushMove(view(g, `p${p}`));
        if (a) {
          assertRecordedTransition(g, () => applyAction(g, p, a, rng, now));
          moves++;
          changed = true;
          inventory(g);
          assertStatistics(g);
        }
      }
      if (!changed && (g.phase as Game["phase"]) !== "finished") {
        now = g.deadline!;
        assert(Number.isFinite(now));
        assertRecordedTransition(g, () => advanceClock(g, now, rng));
        inventory(g);
        assertStatistics(g);
      }
    }
    assert.equal(g.phase, "finished", `${moves} moves / ${g.turn} rolls`);
    assert(g.winner !== null);
    assert(points(g, g.winner!) >= 10);
    const spectator = view(g, null);
    assert.equal(spectator.me, -1);
    assert(!("diceState" in spectator));
  });
