import { emptyHand, RESOURCES } from "./board";
import { nextTurnSeat } from "./turn-order";
import { appendGameLog } from "./game-log";
import { drawBalancedDice } from "./dice";
import type { Action, Game } from "./game";
import { trackStatistics } from "./match-statistics";

export const RUSH_SPEEDS = [5, 8, 10, 15, 30];
export const RUSH_CHOICE_SECONDS = 20;
export type RushState = {
  nextRobber: number;
  rollAt: number | null;
  votes: number[];
  pausedAt: number | null;
  rollRemaining: number;
  discardUntil: number | null;
  robberQueue: number[];
  robberOwner: number | null;
  robberStep: "robber" | "steal";
  robberVictims: number[];
  robberUntil: number | null;
  seats: { freeRoads: number; until: number | null; sequence: number }[];
};
type Rules = {
  perform: (
    g: Game,
    p: number,
    a: Action,
    rng: () => number,
    now: number,
  ) => void;
  beginRobber: (g: Game, resume: "action") => void;
  distribute: (g: Game, sum: number) => void;
  timeoutRobberMove: (g: Game, p: number) => Action | null;
  timeoutRoadMove: (g: Game, p: number) => Action;
  scores: (g: Game) => number[];
};
const requireRush = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message);
};
export function createRush(seats: number): RushState {
  return {
    nextRobber: 0,
    rollAt: null,
    votes: [],
    pausedAt: null,
    rollRemaining: 0,
    discardUntil: null,
    robberQueue: [],
    robberOwner: null,
    robberStep: "robber",
    robberVictims: [],
    robberUntil: null,
    seats: Array.from({ length: seats }, () => ({
      freeRoads: 0,
      until: null,
      sequence: 0,
    })),
  };
}
export function startRushPlay(g: Game, now: number) {
  g.phase = "action";
  g.turn = 0;
  g.rush!.rollAt = now + g.turnSeconds * 1000;
  refreshRushClock(g);
}
export function rushPhase(g: Pick<Game, "phase" | "rush">, p: number) {
  if (!g.rush || g.phase !== "action" || p < 0) return g.phase;
  if (g.rush.robberOwner === p) return g.rush.robberStep;
  return g.rush.seats[p]?.freeRoads ? "roadBuilding" : "action";
}
export function refreshRushClock(g: Game) {
  const r = g.rush!;
  if (g.phase === "finished") {
    g.deadline = null;
    return;
  }
  if (g.phase === "discard") {
    g.deadline = r.discardUntil;
    return;
  }
  const deadlines = [
    r.rollAt,
    r.robberUntil,
    ...r.seats.map((s) => s.until),
  ].filter((t): t is number => t !== null);
  g.deadline = deadlines.length ? Math.min(...deadlines) : null;
}
function finishRushRobber(g: Game) {
  const r = g.rush!;
  if (r.robberOwner !== null) r.seats[r.robberOwner].sequence++;
  r.robberOwner = null;
  r.robberVictims = [];
  r.robberUntil = null;
}
function startNextRobber(g: Game, rules: Rules, now: number) {
  const r = g.rush!;
  if (
    r.robberOwner !== null &&
    r.robberStep === "steal" &&
    !r.robberVictims.some((p) =>
      RESOURCES.some((key) => g.players[p].hand[key] > 0),
    )
  )
    finishRushRobber(g);
  while (
    g.phase === "action" &&
    r.robberOwner === null &&
    r.robberQueue.length
  ) {
    if (r.seats[r.robberQueue[0]].freeRoads) return;
    const owner = r.robberQueue.shift()!;
    g.active = owner;
    rules.beginRobber(g, "action");
    const after = g.phase as Game["phase"];
    if (after === "robber" || after === "steal") {
      r.robberOwner = owner;
      r.robberStep = after;
      r.robberVictims = [...g.victims];
      r.robberUntil = now + RUSH_CHOICE_SECONDS * 1000;
      r.seats[owner].sequence++;
    }
    g.phase = "action";
    g.active = r.nextRobber;
    g.victims = [];
  }
}
function rollRush(g: Game, rules: Rules, rng: () => number, now: number) {
  trackStatistics(
    g,
    g.rush!.nextRobber,
    { type: "roll" },
    now,
    () => rollRushInternal(g, rules, rng, now),
    rules.scores,
  );
}
function rollRushInternal(
  g: Game,
  rules: Rules,
  rng: () => number,
  now: number,
) {
  const r = g.rush!;
  g.dice =
    g.diceMode === "balanced"
      ? drawBalancedDice(g.diceState, r.nextRobber, g.players.length, rng)
      : [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
  const sum = g.dice[0] + g.dice[1];
  g.turn++;
  g.rollCounts[sum] = (g.rollCounts[sum] ?? 0) + 1;
  appendGameLog(g, `Dice rolled ${sum}.`);
  r.votes = [];
  r.rollAt = now + g.turnSeconds * 1000;
  if (sum !== 7) rules.distribute(g, sum);
  else {
    appendGameLog(g, "No resources produced on a seven.");
    r.robberQueue.push(r.nextRobber);
    r.nextRobber = nextTurnSeat(g, r.nextRobber);
    g.discards = {};
    g.players.forEach((pl, p) => {
      const total = RESOURCES.reduce((n, key) => n + pl.hand[key], 0);
      if (total > g.discardLimit) g.discards[p] = Math.floor(total / 2);
    });
    if (Object.keys(g.discards).length) {
      g.phase = "discard";
      r.pausedAt = now;
      r.rollRemaining = g.turnSeconds * 1000;
      r.rollAt = null;
      r.discardUntil = now + RUSH_CHOICE_SECONDS * 1000;
    }
  }
  g.active = r.nextRobber;
  startNextRobber(g, rules, now);
  refreshRushClock(g);
}
function discardRush(g: Game, p: number, a: Action, rules: Rules, now: number) {
  trackStatistics(
    g,
    p,
    a,
    now,
    () => discardRushInternal(g, p, a, rules, now),
    rules.scores,
  );
}
function discardRushInternal(
  g: Game,
  p: number,
  a: Action,
  rules: Rules,
  now: number,
) {
  const r = g.rush!,
    h = a.resources;
  requireRush(g.discards[p] > 0, "You do not need to discard.");
  requireRush(
    h &&
      Object.keys(h).length === 5 &&
      RESOURCES.every(
        (key) =>
          Number.isInteger(h[key]) &&
          h[key] >= 0 &&
          h[key] <= g.players[p].hand[key],
      ),
    "Choose resources you own.",
  );
  requireRush(
    RESOURCES.reduce((n, key) => n + h![key], 0) === g.discards[p],
    "Discard exactly half your cards, rounded down.",
  );
  for (const key of RESOURCES) {
    g.players[p].hand[key] -= h![key];
    g.bank[key] += h![key];
  }
  appendGameLog(
    g,
    `${g.players[p].name} discarded ${g.discards[p]} resources.`,
  );
  delete g.discards[p];
  if (Object.keys(g.discards).length) return;
  const elapsed = now - (r.pausedAt ?? now);
  for (const seat of r.seats) if (seat.until !== null) seat.until += elapsed;
  if (r.robberUntil !== null) r.robberUntil += elapsed;
  r.rollAt = now + r.rollRemaining;
  r.pausedAt = null;
  r.discardUntil = null;
  g.phase = "action";
  startNextRobber(g, rules, now);
}
export function performRushAction(
  g: Game,
  p: number,
  a: Action,
  rules: Rules,
  rng: () => number,
  now: number,
) {
  const r = g.rush!;
  requireRush(
    p >= 0 && p < g.players.length,
    "Join this room before making a move.",
  );
  const social = ["chat", "embargo", "tradePreference", "cancelOffer"].includes(
    a.type,
  );
  if (g.phase === "finished" && a.type === "chat") {
    rules.perform(g, p, a, rng, now);
    return;
  }
  requireRush(g.phase !== "finished", "This game is finished.");
  if (g.phase === "discard" && !social) {
    requireRush(
      a.type === "discard",
      "Wait for all required discards before building or trading.",
    );
    discardRush(g, p, a, rules, now);
    refreshRushClock(g);
    return;
  }
  if (a.type === "voteRoll") {
    requireRush(
      g.phase === "action" && rushPhase(g, p) === "action",
      "Finish your pending action before voting to roll.",
    );
    requireRush(!r.votes.includes(p), "Your vote is already recorded.");
    r.votes.push(p);
    if (r.votes.length === g.players.length) rollRush(g, rules, rng, now);
    return;
  }
  requireRush(
    !["roll", "end", "pass"].includes(a.type),
    "Rush dice roll automatically. Use Vote to Roll instead.",
  );
  if (a.type === "knight") {
    requireRush(
      g.phase === "action" &&
        rushPhase(g, p) === "action" &&
        !r.robberQueue.includes(p),
      "Finish your pending action before playing a Knight.",
    );
    // The shared card helper consumes the card and updates Largest Army. Its
    // temporary robber phase is converted into a queued personal action below.
    const oldOffers = g.offers;
    const activeOwner = r.robberOwner;
    const oldRobber = g.board.robber;
    const phase = g.phase,
      active = g.active,
      victims = g.victims;
    g.active = p;
    rules.perform(g, p, a, rng, now);
    g.offers = oldOffers;
    if (g.phase === "finished") return;
    // beginRobber does not auto-move while Rush is enabled.
    g.board.robber = oldRobber;
    g.phase = phase;
    g.active = active;
    g.victims = victims;
    r.robberOwner = activeOwner;
    r.robberQueue.push(p);
    startNextRobber(g, rules, now);
    refreshRushClock(g);
    return;
  }
  const phase = g.phase,
    active = g.active,
    victims = g.victims;
  const freeRoads = g.freeRoads,
    resume = g.resume;
  const personalPhase = social ? phase : rushPhase(g, p);
  g.phase = personalPhase;
  g.active = p;
  g.resume = "action";
  g.freeRoads = r.seats[p].freeRoads;
  g.victims =
    r.robberOwner === p
      ? r.robberVictims.filter((i) =>
          RESOURCES.some((key) => g.players[i].hand[key] > 0),
        )
      : [];
  rules.perform(g, p, a, rng, now);
  if (g.phase === "finished") return;
  if (!social) {
    if (personalPhase === "robber" || personalPhase === "steal") {
      if (g.phase === "robber" || g.phase === "steal") {
        if (r.robberStep !== g.phase) {
          r.seats[p].sequence++;
          r.robberUntil = now + RUSH_CHOICE_SECONDS * 1000;
        }
        r.robberStep = g.phase;
        r.robberVictims = [...g.victims];
      } else finishRushRobber(g);
    }
    if (g.phase === "roadBuilding") {
      if (!r.seats[p].freeRoads) {
        r.seats[p].sequence++;
        r.seats[p].until = now + RUSH_CHOICE_SECONDS * 1000;
      }
      r.seats[p].freeRoads = g.freeRoads;
    } else if (r.seats[p].freeRoads && personalPhase === "roadBuilding") {
      r.seats[p].freeRoads = 0;
      r.seats[p].until = null;
      r.seats[p].sequence++;
    }
  }
  g.phase = phase;
  g.active = active;
  g.victims = victims;
  g.freeRoads = freeRoads;
  g.resume = resume;
  startNextRobber(g, rules, now);
  refreshRushClock(g);
}
export function advanceRush(
  g: Game,
  rules: Rules,
  rng: () => number,
  now: number,
) {
  const r = g.rush!;
  if (g.phase === "finished") {
    g.deadline = null;
    return;
  }
  if (g.phase === "discard") {
    if (r.discardUntil !== null && r.discardUntil <= now)
      for (const [p, amount] of Object.entries({ ...g.discards })) {
        const seat = Number(p),
          resources = emptyHand();
        const bag = RESOURCES.flatMap(
          (key) =>
            Array(g.players[seat].hand[key]).fill(
              key,
            ) as (typeof RESOURCES)[number][],
        );
        for (let n = 0; n < amount; n++)
          resources[bag.splice(Math.floor(rng() * bag.length), 1)[0]]++;
        discardRush(g, seat, { type: "discard", resources }, rules, now);
      }
    refreshRushClock(g);
    return;
  }
  for (const [p, seat] of r.seats.entries())
    if (seat.until !== null && seat.until <= now) {
      for (let i = 0; i < 2 && seat.freeRoads; i++) {
        performRushAction(g, p, rules.timeoutRoadMove(g, p), rules, rng, now);
        if ((g.phase as Game["phase"]) === "finished") return;
      }
    }
  if (r.robberOwner !== null) {
    if (
      r.robberStep === "steal" &&
      !r.robberVictims.some((p) =>
        RESOURCES.some((key) => g.players[p].hand[key] > 0),
      )
    )
      finishRushRobber(g);
    else if (r.robberUntil !== null && r.robberUntil <= now) {
      const owner = r.robberOwner;
      const move = rules.timeoutRobberMove(g, owner);
      if (move)
        performRushAction(
          g,
          owner,
          move,
          rules,
          rng,
          now,
        );
      else finishRushRobber(g);
    }
  }
  startNextRobber(g, rules, now);
  if (r.rollAt !== null && r.rollAt <= now) rollRush(g, rules, rng, now);
  refreshRushClock(g);
}
