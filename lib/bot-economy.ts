// Public-board economic evaluation. Opponents' private hands and draws are never inputs.
import { RESOURCES, emptyHand, type Resource } from "./board";
import {
  type View,
  type Game,
  type Action,
  COSTS,
  total,
  roadLength,
  tradeBlocked,
  resourceCardStock,
} from "./game";
export type BotPlan = {
  action: Action;
  cost: Partial<Record<Resource, number>>;
  value: number;
  wait: number;
  priority: number;
};
const weights: Record<Resource, number> = {
  wood: 1.2,
  brick: 1.2,
  sheep: 1,
  wheat: 1.35,
  ore: 1.35,
};
export const pips = (n: number) =>
  n >= 2 && n <= 12 && n !== 7 ? 6 - Math.abs(7 - n) : 0;
export function botIncome(g: View, p = g.me, blocked = true) {
  const income = emptyHand();
  for (const v of g.board.vertices.filter((v) => v.owner === p))
    for (const tid of v.tiles) {
      const t = g.board.tiles[tid];
      if (t.fog || (blocked && tid === g.board.robber)) continue;
      const amount = (pips(t.number) / 36) * (v.city ? 2 : 1);
      if (t.resource === "gold")
        for (const r of RESOURCES) income[r] += amount / 5;
      else if (RESOURCES.includes(t.resource as Resource))
        income[t.resource as Resource] += amount;
    }
  return income;
}
export function resourceValue(g: View, r: Resource) {
  const income = botIncome(g),
    all = total(income),
    h = g.players[g.me].hand?.[r] ?? 0;
  return (
    (weights[r] * (1 + Math.min(1.5, all / (income[r] * 8 + 0.15)))) /
    (1 + Math.max(0, h - 2) * 0.18)
  );
}
// Card conservation reveals the opponents' combined stock, never which seat
// holds it. A concealed bank or inconsistent snapshot supplies no deduction.
export function knownOpponentResource(g: View, r: Resource): number | null {
  const own = g.players[g.me].hand;
  if (g.hideBank || !g.bank || !own) return null;
  const count = resourceCardStock(g.boardPlayers) - g.bank[r] - own[r];
  const publicTotal = g.players.reduce(
    (n, player, p) => n + (p === g.me ? 0 : player.resources),
    0,
  );
  return Number.isInteger(count) && count >= 0 && count <= publicTotal
    ? count
    : null;
}
export function economicVertex(g: View, id: number, setup = false) {
  const income = botIncome(g, g.me, false),
    v = g.board.vertices[id],
    extra = emptyHand();
  for (const tid of v.tiles) {
    const t = g.board.tiles[tid];
    if (t.fog) continue;
    const amount = pips(t.number) / 36;
    if (t.resource === "gold")
      for (const r of RESOURCES) extra[r] += amount / 3;
    else if (RESOURCES.includes(t.resource as Resource))
      extra[t.resource as Resource] += amount;
  }
  let score =
    RESOURCES.reduce(
      (s, r) =>
        s +
        weights[r] *
          (Math.log(1 + (income[r] + extra[r]) * 8) -
            Math.log(1 + income[r] * 8)) *
          7,
      0,
    ) +
    total(extra) * 4;
  for (const port of g.board.ports) {
    const edge = g.board.edges[port.edge];
    if ([edge.a, edge.b].includes(id))
      score +=
        port.resource === "any"
          ? 1.2
          : Math.min(4, (income[port.resource] + extra[port.resource]) * 9);
  }
  if (
    g.map === "blackForest" &&
    g.board.ports.some((port) => {
      const e = g.board.edges[port.edge];
      return [e.a, e.b].includes(id);
    })
  )
    score += 8;
  if (setup && g.setupStep >= g.players.length) {
    for (const tid of v.tiles) {
      const t = g.board.tiles[tid];
      if (RESOURCES.includes(t.resource as Resource))
        score += weights[t.resource as Resource] * 0.25;
    }
  }
  return score;
}
function waitFor(g: View, cost: BotPlan["cost"]) {
  const income = botIncome(g),
    h = g.players[g.me].hand!,
    all = total(income);
  let wait = 0;
  for (const r of RESOURCES) {
    const deficit = Math.max(0, (cost[r] ?? 0) - h[r]);
    if (deficit)
      wait = Math.max(
        wait,
        deficit / Math.max(0.025, income[r] + all / (g.rates[r] * 9)),
      );
  }
  return wait / Math.max(1, g.players.length);
}
// Expected rolls until all missing build cards arrive, rather than the maximum
// of each card's mean wait. Dice profiles preserve correlations (two adjacent
// fields on the same number produce together). A small public-income estimate
// represents eventual bank conversion when direct production is unavailable.
export function botBuildWait(
  g: View,
  cost: BotPlan["cost"],
  hand = g.players[g.me].hand!,
) {
  const income = botIncome(g),
    all = total(income);
  const relevant = RESOURCES.filter((r) => (cost[r] ?? 0) > 0);
  const profiles = Array.from({ length: 11 }, (_, index) => ({
    number: index + 2,
    probability: (index + 2 === 7 ? 6 : pips(index + 2)) / 36,
    gain: relevant.map(() => 0),
    gold: 0,
  }));
  for (const v of g.board.vertices.filter((v) => v.owner === g.me))
    for (const tid of v.tiles) {
      const t = g.board.tiles[tid];
      if (t.fog || tid === g.board.robber || !pips(t.number)) continue;
      const profile = profiles[t.number - 2],
        amount = v.city ? 2 : 1;
      if (t.resource === "gold") profile.gold += amount;
      else {
        const index = relevant.indexOf(t.resource as Resource);
        if (index >= 0) profile.gain[index] += amount;
      }
    }
  const virtual = relevant.map((r) =>
    !g.hideBank && g.bank?.[r] === 0
      ? 0
      : Math.max(0, 0.025 - income[r]) + all / (g.rates[r] * 9),
  );
  const conversion = virtual.reduce((sum, p) => sum + p, 0);
  for (const profile of profiles) profile.probability *= 1 / (1 + conversion);
  const outcomes = [
    ...profiles,
    ...virtual.map((probability, index) => ({
      probability: probability / (1 + conversion),
      gain: relevant.map((_, i) => (i === index ? 1 : 0)),
      gold: 0,
    })),
  ];
  const memo = new Map<string, number>();
  function remainingWait(remaining: number[]): number {
    if (remaining.every((n) => n === 0)) return 0;
    const key = remaining.join(","),
      cached = memo.get(key);
    if (cached !== undefined) return cached;
    let progress = 0,
      future = 0;
    for (const outcome of outcomes) {
      if (outcome.probability === 0) continue;
      const next = remaining.map((n, index) =>
        Math.max(0, n - outcome.gain[index]),
      );
      for (let n = 0; n < outcome.gold; n++) {
        const index = next
          .map((count, i) => ({ count, i }))
          .filter(({ count }) => count > 0)
          .sort(
            (a, b) =>
              b.count / Math.max(0.025, income[relevant[b.i]]) -
              a.count / Math.max(0.025, income[relevant[a.i]]),
          )[0]?.i;
        if (index === undefined) break;
        next[index]--;
      }
      if (next.every((n, i) => n === remaining[i])) continue;
      progress += outcome.probability;
      future += outcome.probability * remainingWait(next);
    }
    const wait = progress > 0 ? (1 + future) / progress : Infinity;
    memo.set(key, wait);
    return wait;
  }
  return (
    remainingWait(relevant.map((r) => Math.max(0, (cost[r] ?? 0) - hand[r]))) /
    Math.max(1, g.players.length)
  );
}
export function basePlans(g: View): BotPlan[] {
  const result: BotPlan[] = [],
    p = g.me,
    own = g.players[p];
  const add = (action: Action, cost: BotPlan["cost"], value: number) => {
    const wait = waitFor(g, cost);
    result.push({ action, cost, value, wait, priority: value / (1.6 + wait) });
  };
  for (const id of g.legal.city) {
    const yieldScore = g.board.vertices[id].tiles.reduce((s, tid) => {
      const t = g.board.tiles[tid];
      return (
        s +
        (RESOURCES.includes(t.resource as Resource)
          ? pips(t.number) * resourceValue(g, t.resource as Resource)
          : 0)
      );
    }, 0);
    add({ type: "city", id }, COSTS.city, 11 + yieldScore * 0.65);
  }
  for (const id of g.legal.settlement) {
    const v = g.board.vertices[id],
      isNew =
        g.mode === "seafarers" &&
        v.tiles.some((tid) => {
          const t = g.board.tiles[tid];
          return (
            t.island !== undefined && !own.islands.includes(t.island) && !t.home
          );
        });
    add(
      { type: "settlement", id },
      COSTS.settlement,
      20 + economicVertex(g, id) * 1.2 + (isNew ? 14 : 0),
    );
  }
  // Search to unoccupied, distance-rule-safe intersections. Own edges cost zero.
  const targets = g.board.vertices.filter(
    (v) =>
      v.owner === null &&
      v.tiles.some(
        (tid) =>
          !g.board.tiles[tid].fog && g.board.tiles[tid].resource !== "sea",
      ) &&
      v.edges.every((eid) => {
        const e = g.board.edges[eid];
        return g.board.vertices[e.a === v.id ? e.b : e.a].owner === null;
      }),
  );
  const paths: { edge: number; kind: "road" | "ship"; value: number }[] = [];
  for (const kind of (g.mode === "seafarers" ? ["road", "ship"] : ["road"]) as (
    "road" | "ship"
  )[]) {
    const choices = g.legal[kind];
    if (!choices.length) continue;
    const network = new Set(
      g.phase === "setupRoad" && g.setupVertex !== null
        ? [g.setupVertex]
        : [
            ...g.board.vertices.filter((v) => v.owner === p).map((v) => v.id),
            ...g.board.edges
              .filter((e) => e.owner === p && (e.kind ?? "road") === kind)
              .flatMap((e) => [e.a, e.b])
              .filter(
                (id) =>
                  g.board.vertices[id].owner === null ||
                  g.board.vertices[id].owner === p,
              ),
          ],
    );
    for (const target of targets) {
      const dist = new Map<number, number>([[target.id, 0]]),
        queue = [target.id];
      while (queue.length) {
        queue.sort((a, b) => dist.get(a)! - dist.get(b)!);
        const vid = queue.shift()!,
          d = dist.get(vid)!;
        if (d > 4) continue;
        if (
          g.board.vertices[vid].owner !== null &&
          g.board.vertices[vid].owner !== p
        )
          continue;
        for (const eid of g.board.vertices[vid].edges) {
          const e = g.board.edges[eid];
          if (e.owner !== null && e.owner !== p) continue;
          const terrain = e.tiles.map((tid) => g.board.tiles[tid]);
          if (
            kind === "ship"
              ? !terrain.some((t) => t.resource === "sea" || t.fog)
              : !terrain.some((t) => t.resource !== "sea" && !t.fog)
          )
            continue;
          if (e.owner === p && (e.kind ?? "road") !== kind) continue;
          if (kind === "ship" && e.tiles.includes(g.board.pirate ?? -1))
            continue;
          const other = e.a === vid ? e.b : e.a,
            nd = d + (e.owner === p ? 0 : 1);
          if (nd < (dist.get(other) ?? 99)) {
            dist.set(other, nd);
            queue.push(other);
          }
        }
      }
      const newIsland =
        g.mode === "seafarers" &&
        target.tiles.some((tid) => {
          const t = g.board.tiles[tid];
          return (
            t.island !== undefined && !own.islands.includes(t.island) && !t.home
          );
        });
      const remaining = Math.min(
        ...[...network].map((id) => dist.get(id) ?? 99),
      );
      // An already connected site needs a settlement, not another branch.
      if (remaining === 0 || remaining > 4) continue;
      for (const eid of choices) {
        const e = g.board.edges[eid],
          destination =
            network.has(e.a) && !network.has(e.b)
              ? e.b
              : network.has(e.b) && !network.has(e.a)
                ? e.a
                : null;
        // Only reward a new endpoint on a shortest path to this site.
        // A loop or a road away from the site does not improve its access.
        if (
          destination === null ||
          (g.board.vertices[destination].owner !== null &&
            g.board.vertices[destination].owner !== p) ||
          (dist.get(destination) ?? 99) + 1 !== remaining
        )
          continue;
        const distance = remaining;
        const potential =
          (15 + economicVertex(g, target.id) * 1.1 + (newIsland ? 12 : 0)) /
          (distance * distance);
        paths.push({ edge: eid, kind, value: potential });
      }
    }
  }
  const routes = paths.sort((a, b) => b.value - a.value || a.edge - b.edge),
    seen = new Set<string>();
  for (const r of routes) {
    const key = r.kind + r.edge;
    if (seen.has(key)) continue;
    seen.add(key);
    if (own.pieces.settlement >= 5) continue;
    add({ type: r.kind, id: r.edge }, COSTS[r.kind], r.value);
    if (seen.size >= 6) break;
  }
  // A route is worthwhile for the award even with no settlement destination.
  if (own.roadLength >= 3 && g.legal.road.length) {
    const required = Math.max(
      5,
      ...g.players.filter((_, i) => i !== p).map((p) => p.roadLength + 1),
    );
    for (const id of g.legal.road) {
      const board = {
        ...g.board,
        edges: g.board.edges.map((e) =>
          e.id === id ? { ...e, owner: p, kind: "road" as const } : e,
        ),
      };
      // roadLength reads public geometry, ownership, route kinds and knights only.
      const length = roadLength({ ...g, board } as unknown as Game, p);
      if (length <= own.roadLength) continue;
      const award = g.longest !== p && length >= required;
      const urgent = award && own.score + 2 >= g.target;
      if (award) add({ type: "road", id }, COSTS.road, urgent ? 100 : 28);
      else if (g.longest !== p && required - length <= 2)
        add({ type: "road", id }, COSTS.road, 12 / (required - length + 1));
      else if (
        g.longest === p &&
        own.roadLength <=
          Math.max(
            ...g.players.filter((_, i) => i !== p).map((p) => p.roadLength),
          ) +
            1
      )
        add({ type: "road", id }, COSTS.road, 9);
    }
  }
  if (g.deckCount > 0) {
    const army = own.knights,
      largest = Math.max(
        2,
        ...g.players.filter((_, i) => i !== p).map((p) => p.knights),
      );
    add(
      { type: "buyDev" },
      COSTS.development,
      7 +
        (g.army !== p && army >= largest - 1 ? 5 : 0) +
        (own.score >= g.target - 2 ? 3 : 0),
    );
  }
  return result.sort((a, b) => b.priority - a.priority || b.value - a.value);
}
export function planBankTrade(g: View, plan: BotPlan): Action | null {
  const h = g.players[g.me].hand!;
  const need = RESOURCES.filter(
    (r) => h[r] < (plan.cost[r] ?? 0) && (g.bank?.[r] ?? 0) > 0,
  ).sort((a, b) => resourceValue(g, b) - resourceValue(g, a));
  for (const to of need) {
    const from = RESOURCES.filter(
      (r) => r !== to && h[r] - (plan.cost[r] ?? 0) >= g.rates[r],
    ).sort(
      (a, b) =>
        resourceValue(g, a) * g.rates[a] - resourceValue(g, b) * g.rates[b],
    )[0];
    if (from) {
      const give = emptyHand(),
        want = emptyHand();
      give[from] = g.rates[from];
      want[to] = 1;
      return { type: "bankTrade", give, want };
    }
  }
  return null;
}
export function strategicTrade(
  g: View,
  give: Partial<Record<Resource, number>>,
  receive: Partial<Record<Resource, number>>,
  other: number,
) {
  const h = g.players[g.me].hand!;
  if (
    RESOURCES.some((r) => (give[r] ?? 0) > h[r]) ||
    !total(give as typeof h) ||
    !total(receive as typeof h)
  )
    return false;
  const before = basePlans(g)[0],
    value = (cards: typeof give) =>
      RESOURCES.reduce((s, r) => s + (cards[r] ?? 0) * resourceValue(g, r), 0);
  const next = { ...h };
  for (const r of RESOURCES) next[r] += (receive[r] ?? 0) - (give[r] ?? 0);
  const completes =
    before && RESOURCES.every((r) => next[r] >= (before.cost[r] ?? 0));
  const wins =
    completes &&
    g.players[g.me].score >= g.target - 1 &&
    ["city", "settlement"].includes(before.action.type);
  if (g.players[other].publicScore >= g.target - 1 && !wins) return false;
  const keepsGoal =
    before &&
    RESOURCES.every(
      (r) => h[r] - (give[r] ?? 0) >= Math.min(h[r], before.cost[r] ?? 0),
    );
  return (
    value(receive) + 0.05 >= value(give) ||
    !!(completes && keepsGoal && value(receive) * 2 >= value(give))
  );
}

// Seek one missing card for a near-term build; targets use only public counts
// and scores. Never inspect an opponent's hand to predict whether they can pay.
export function planPlayerTrade(g: View, plan: BotPlan): Action | null {
  const own = g.players[g.me],
    h = own.hand!;
  const missing = RESOURCES.reduce(
    (n, r) => n + Math.max(0, (plan.cost[r] ?? 0) - h[r]),
    0,
  );
  if (missing !== 1) return null;
  const to = RESOURCES.find((r) => h[r] < (plan.cost[r] ?? 0))!;
  if (knownOpponentResource(g, to) === 0) return null;
  const targets = g.players.flatMap((other, p) =>
    p !== g.me &&
    other.resources > 0 &&
    !tradeBlocked(g, g.me, p) &&
    (other.publicScore < g.target - 2 ||
      (own.score >= g.target - 1 &&
        ["city", "settlement"].includes(plan.action.type)))
      ? [p]
      : [],
  );
  if (!targets.length) return null;
  const from = RESOURCES.filter(
    (r) => r !== to && h[r] > (plan.cost[r] ?? 0),
  ).sort((a, b) => resourceValue(g, a) - resourceValue(g, b))[0];
  if (!from) return null;
  const give = emptyHand(),
    want = emptyHand();
  give[from] = 1;
  want[to] = 1;
  return { type: "offer", give, want, targets };
}
