import type { Action, Game } from "./game";
import { GOODS, type Good } from "./cities-knights";
import { recordReplayFrame } from "./match-replay";

export const RESOURCE_METRICS = [
  ["totalResourceIncome", "Total resource income"],
  ["totalResourceLoss", "Total resource loss"],
  ["totalResourceScore", "Resource score"],
  ["rollingIncome", "Income from dice"],
  ["robbingIncome", "Income from robbery"],
  ["devCardIncome", "Income from development cards"],
  ["tradeIncome", "Income from trading"],
  ["rollingLoss", "Discarded on seven"],
  ["robbingLoss", "Lost to robbery"],
  ["devCardLoss", "Lost to development cards"],
  ["tradeLoss", "Paid in trades"],
  ["goldIncome", "Income from gold"],
  ["setupIncome", "Starting resources"],
  ["discoveryIncome", "Exploration income"],
] as const;
export const ACTIVITY_METRICS = [
  ["proposedTrades", "Proposed trades"],
  ["successfulTrades", "Successful player trades"],
  ["bankTrades", "Bank / port trades"],
  ["resourcesUsed", "Resources spent building / buying cards"],
  ["resourceIncomeBlocked", "Production blocked by robber / bank"],
  ["devCardsBought", "Development cards bought"],
  ["devCardsUsed", "Development cards played"],
] as const;
export const CITIES_ACTIVITY_METRICS = [
  ["progressCardsStolen", "Progress cards stolen with Spy"],
  ["progressCardsLost", "Progress cards lost to Spy"],
  ["progressCardsDiscarded", "Progress cards discarded"],
] as const;
export const BUILD_ACTIVITY_METRICS = [
  ["road", "Roads built"],
  ["ship", "Ships built"],
  ["settlement", "Settlements built"],
  ["city", "Cities built"],
] as const;
type ResourceMetric = (typeof RESOURCE_METRICS)[number][0];
type ActivityMetric =
  | (typeof ACTIVITY_METRICS)[number][0]
  | (typeof CITIES_ACTIVITY_METRICS)[number][0];
export type PlayerStatistics = {
  // Optional for archives created before construction actions were recorded.
  builds?: Record<(typeof BUILD_ACTIVITY_METRICS)[number][0], number>;
  resources: Record<ResourceMetric, number>;
  activity: Record<ActivityMetric, number>;
  received: Record<Good, number>;
  spent: Record<Good, number>;
  cardsBought: Record<string, number>;
  cardsUsed: Record<string, number>;
  cardsStolen?: Record<string, number>;
  cardsLost?: Record<string, number>;
  cardsDiscarded?: Record<string, number>;
};
export type MatchStatistics = {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  complete: boolean;
  detailed: boolean;
  sequence: number;
  players: PlayerStatistics[];
  points: { sequence: number; turn: number; scores: number[] }[];
  graphTruncated: boolean;
};
const zeros = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
export function createMatchStatistics(
  g: Game,
  now: number,
  complete = true,
): MatchStatistics {
  return {
    id: crypto.randomUUID(),
    startedAt: now,
    finishedAt: null,
    complete,
    detailed: true,
    sequence: 0,
    points: [],
    graphTruncated: false,
    players: g.players.map(() => ({
      builds: zeros(BUILD_ACTIVITY_METRICS.map(([key]) => key)),
      resources: zeros(RESOURCE_METRICS.map(([key]) => key)),
      activity: zeros(
        [...ACTIVITY_METRICS, ...CITIES_ACTIVITY_METRICS].map(([key]) => key),
      ),
      received: zeros(GOODS),
      spent: zeros(GOODS),
      cardsBought: {},
      cardsUsed: {},
      cardsStolen: {},
      cardsLost: {},
      cardsDiscarded: {},
    })),
  };
}
const payments = new WeakMap<
  Game,
  {
    type: string;
    paid: Record<Good, number>[];
    production: Record<Good, number>[];
    robbery: Record<Good, number>[];
    blocked: number[];
  }
>();
export function recordRobbery(g: Game, from: number, to: number, resource: Good) {
  const context = payments.get(g);
  if (!context) return;
  context.robbery[from][resource]--;
  context.robbery[to][resource]++;
}
// Event-die choices can postpone production until a later HTTP action. The
// adapter records actual production after pillaging, rather than inferring it
// from dice-count changes or counting aqueduct compensation as blocked income.
export function recordCitiesProduction(
  g: Game,
  sum: number,
  received: Record<Good, number>[],
) {
  const context = payments.get(g);
  if (!context) return;
  const expected = g.players.map(() => 0);
  for (const tile of g.board.tiles)
    if (
      tile.number === sum &&
      ["wood", "brick", "sheep", "wheat", "ore"].includes(tile.resource)
    )
      for (const vertex of tile.vertices.map((id) => g.board.vertices[id]))
        if (vertex.owner !== null)
          expected[vertex.owner] += vertex.city ? 2 : 1;
  received.forEach((hand, seat) => {
    for (const good of GOODS) context.production[seat][good] += hand[good];
    context.blocked[seat] += Math.max(
      0,
      expected[seat] - GOODS.reduce((sum, good) => sum + hand[good], 0),
    );
  });
}
// Capture the actual validated payment, including free routes and setup rules.
export function recordPayment(
  g: Game,
  p: number,
  cost: Partial<Record<Good, number>>,
) {
  const context = payments.get(g);
  if (!context || ["bankTrade", "discard"].includes(context.type)) return;
  for (const good of GOODS) context.paid[p][good] += cost[good] ?? 0;
}
const tally = (cards: { kind: string }[]) => {
  const counts: Record<string, number> = {};
  for (const card of cards) counts[card.kind] = (counts[card.kind] ?? 0) + 1;
  return counts;
};
export function trackStatistics(
  g: Game,
  p: number,
  a: Action,
  now: number,
  perform: () => void,
  scores: (g: Game) => number[],
) {
  if (
    g.phase === "lobby" ||
    !g.statistics ||
    (["chat", "embargo", "tradePreference", "cancelOffer"].includes(a.type) &&
      a.text?.trim() !== "/resign")
  ) {
    perform();
    return;
  }
  const before = {
    phase: g.phase,
    hands: g.players.map((pl) => ({ ...pl.hand })),
    cards: g.players.map((pl) => tally(pl.dev)),
    progress:
      g.cities?.players.flatMap((pl, seat) =>
        [...pl.progress, ...pl.revealed].map((card) => ({ ...card, seat })),
      ) ?? [],
    choice: g.cities?.choices[0]?.kind,
    rollCount: Object.values(g.rollCounts).reduce((n, count) => n + count, 0),
    production: g.board.tiles.map((tile) => ({
      number: tile.number,
      resource: tile.resource,
      buildings: tile.vertices
        .map((id) => g.board.vertices[id])
        .filter((v) => v.owner !== null)
        .map((v) => ({ owner: v.owner!, amount: v.city ? 2 : 1 })),
    })),
  };
  const paid = g.players.map(() => zeros(GOODS));
  const context = {
    type: a.type,
    paid,
    production: g.players.map(() => zeros(GOODS)),
    robbery: g.players.map(() => zeros(GOODS)),
    blocked: g.players.map(() => 0),
  };
  payments.set(g, context);
  try {
    perform();
  } finally {
    payments.delete(g);
  }
  const stats = g.statistics;
  if (!stats) return;
  if (stats.detailed) {
    if (!before.phase.startsWith("setup") &&
      (a.type === "road" || a.type === "ship" || a.type === "settlement" || a.type === "city")) {
      const builds = stats.players[p].builds;
      if (builds) builds[a.type]++;
    }
    const rolled =
      Object.values(g.rollCounts).reduce((n, count) => n + count, 0) >
      before.rollCount;
    const setup = before.phase === "setupSettlement";
    const harbor =
      a.type === "citiesChoice" && before.choice === "harborExchange";
    const traded = ["completeTrade", "bankTrade"].includes(a.type) || harbor;
    const income: ResourceMetric = rolled
      ? "rollingIncome"
      : setup
        ? "setupIncome"
        : a.type === "gold"
          ? "goldIncome"
          : a.type === "steal"
            ? "robbingIncome"
            : traded
              ? "tradeIncome"
              : before.choice === "aqueduct"
                ? "rollingIncome"
                : ["plenty", "monopoly", "progress", "citiesChoice"].includes(
                      a.type,
                    )
                  ? "devCardIncome"
                  : "discoveryIncome";
    const loss: ResourceMetric | null =
      a.type === "discard"
        ? "rollingLoss"
        : a.type === "steal"
          ? "robbingLoss"
          : traded
            ? "tradeLoss"
            : ["monopoly", "progress", "citiesChoice"].includes(a.type)
              ? "devCardLoss"
              : null;
    for (let seat = 0; seat < g.players.length; seat++) {
      const row = stats.players[seat];
      let participated = false;
      for (const good of GOODS) {
        const actualPayment =
          g.cities &&
          seat === p &&
          !setup &&
          [
            "placeKnight",
            "activateKnight",
            "promoteKnight",
            "wall",
            "improve",
            "city",
            "road",
            "settlement",
          ].includes(a.type)
            ? Math.max(
                0,
                (before.hands[seat][good] ?? 0) -
                  (g.players[seat].hand[good] ?? 0),
              )
            : 0;
        const spent = Math.max(paid[seat][good], actualPayment);
        const production = context.production[seat][good];
        const robbery = context.robbery[seat][good];
        const delta =
          (g.players[seat].hand[good] ?? 0) -
          (before.hands[seat][good] ?? 0) +
          spent -
          production - robbery;
        row.resources.rollingIncome += production;
        row.resources.totalResourceIncome += production;
        row.received[good] += production;
        if (robbery > 0) {
          row.resources.robbingIncome += robbery;
          row.resources.totalResourceIncome += robbery;
          row.received[good] += robbery;
        } else if (robbery < 0) {
          row.resources.robbingLoss -= robbery;
          row.resources.totalResourceLoss -= robbery;
        }
        if (delta > 0) {
          row.resources[income] += delta;
          row.resources.totalResourceIncome += delta;
          row.received[good] += delta;
          participated = true;
        }
        if (delta < 0 && loss) {
          row.resources[loss] -= delta;
          row.resources.totalResourceLoss -= delta;
          participated = true;
        }
        row.activity.resourcesUsed += spent;
        row.spent[good] += spent;
      }
      row.resources.totalResourceScore =
        row.resources.totalResourceIncome - row.resources.totalResourceLoss;
      row.activity.resourceIncomeBlocked += context.blocked[seat];
      if (participated && (a.type === "completeTrade" || harbor))
        row.activity.successfulTrades++;
      const afterCards = tally(g.players[seat].dev),
        oldCards = before.cards[seat];
      for (const kind of new Set([
        ...Object.keys(oldCards),
        ...Object.keys(afterCards),
      ])) {
        const delta = (afterCards[kind] ?? 0) - (oldCards[kind] ?? 0);
        if (delta > 0) {
          row.activity.devCardsBought += delta;
          row.cardsBought[kind] = (row.cardsBought[kind] ?? 0) + delta;
        }
        if (delta < 0) {
          row.activity.devCardsUsed -= delta;
          row.cardsUsed[kind] = (row.cardsUsed[kind] ?? 0) - delta;
        }
      }
    }
    if (["offer", "counterOffer"].includes(a.type))
      stats.players[p].activity.proposedTrades++;
    if (a.type === "bankTrade") stats.players[p].activity.bankTrades++;
    if (rolled && !g.cities && g.dice[0] + g.dice[1] !== 7) {
      const demand = g.players.map(() => 0);
      for (const tile of before.production)
        if (
          tile.number === g.dice[0] + g.dice[1] &&
          !["sea", "desert", "gold", "fog"].includes(tile.resource)
        )
          for (const building of tile.buildings)
            demand[building.owner] += building.amount;
      stats.players.forEach((row, seat) => {
        const actual = GOODS.reduce(
          (n, good) =>
            n +
            Math.max(
              0,
              (g.players[seat].hand[good] ?? 0) -
                (before.hands[seat][good] ?? 0),
            ),
          0,
        );
        row.activity.resourceIncomeBlocked += Math.max(
          0,
          demand[seat] - actual,
        );
      });
    }
    if (g.cities) {
      const after = g.cities.players.flatMap((pl, seat) =>
        [...pl.progress, ...pl.revealed].map((card) => ({ ...card, seat })),
      );
      const oldOwners = new Map(before.progress.map((card) => [card.id, card]));
      const newOwners = new Map(after.map((card) => [card.id, card]));
      const played =
        a.type === "progress"
          ? before.progress.find(
              (card) => card.id === a.cardId && card.seat === p,
            )
          : undefined;
      const count = (map: Record<string, number>, kind: string) => {
        map[kind] = (map[kind] ?? 0) + 1;
      };
      if (played) {
        const row = stats.players[p];
        row.activity.devCardsUsed++;
        count(row.cardsUsed, played.kind);
        oldOwners.delete(played.id);
      }
      for (const card of after) {
        const old = oldOwners.get(card.id),
          row = stats.players[card.seat];
        if (!old) {
          row.activity.devCardsBought++;
          count(row.cardsBought, card.kind);
        } else if (old.seat !== card.seat) {
          row.activity.progressCardsStolen =
            (row.activity.progressCardsStolen ?? 0) + 1;
          count((row.cardsStolen ??= {}), card.kind);
          const victim = stats.players[old.seat];
          victim.activity.progressCardsLost =
            (victim.activity.progressCardsLost ?? 0) + 1;
          count((victim.cardsLost ??= {}), card.kind);
        }
      }
      for (const card of oldOwners.values())
        if (!newOwners.has(card.id)) {
          const row = stats.players[card.seat];
          row.activity.progressCardsDiscarded =
            (row.activity.progressCardsDiscarded ?? 0) + 1;
          count((row.cardsDiscarded ??= {}), card.kind);
        }
    }
  }
  stats.sequence++;
  const current = scores(g),
    last = stats.points.at(-1);
  if (!last || current.some((score, i) => score !== last.scores[i])) {
    stats.points.push({
      sequence: stats.sequence,
      turn: g.turn,
      scores: current,
    });
    if (stats.points.length > 10000) {
      stats.points.splice(1, 1);
      stats.graphTruncated = true;
    }
  }
  if (g.phase === "finished") stats.finishedAt ??= now;
  recordReplayFrame(g, p, a, now);
}
