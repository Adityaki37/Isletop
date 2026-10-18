import { RESOURCES, emptyHand, type Resource } from "./board";
import { type View, type Action, total } from "./game";
import { robberCandidates } from "./robber-strategy";
export { robberValue } from "./robber-strategy";
import {
  basePlans,
  botBuildWait,
  botIncome,
  economicVertex,
  resourceValue,
  planBankTrade,
  planPlayerTrade,
  knownOpponentResource,
  type BotPlan,
} from "./bot-economy";
const best = <T>(xs: readonly T[], score: (x: T) => number) =>
  [...xs].map((x) => ({ x, s: score(x) })).sort((a, b) => b.s - a.s)[0]?.x;
export function estimateResource(g: View, p: number, r: Resource) {
  const income = botIncome(g, p, false),
    sum = total(income),
    count = g.players[p].resources;
  return count * (sum ? income[r] / sum : 0.2);
}
function chooseCards(g: View, n: number) {
  const cards = emptyHand(),
    h = g.players[g.me].hand!,
    plans = basePlans(g),
    plan =
      plans.find((p) => RESOURCES.some((r) => h[r] < (p.cost[r] ?? 0))) ??
      plans[0];
  for (let i = 0; i < n; i++) {
    const r = best(
      RESOURCES.filter((r) => (g.bank?.[r] ?? 0) > cards[r]),
      (r) =>
        ((plan?.cost[r] ?? 0) - h[r] - cards[r] > 0 ? 8 : 0) +
        resourceValue(g, r) / (cards[r] + 1),
    );
    if (r) cards[r]++;
  }
  return cards;
}
export function plannedBaseCandidates(g: View): Action[] {
  const p = g.me,
    own = g.players[p],
    h = own.hand!,
    result: Action[] = [];
  if (g.phase === "setupSettlement") {
    const id = best(g.legal.settlement, (id) => {
      let score = economicVertex(g, id, true);
      if (g.setupStep < g.players.length) {
        const v = g.board.vertices[id],
          blocked = new Set([
            id,
            ...v.edges.map((eid) => {
              const e = g.board.edges[eid];
              return e.a === id ? e.b : e.a;
            }),
          ]);
        const next = {
          ...g,
          board: {
            ...g.board,
            vertices: g.board.vertices.map((v) =>
              v.id === id ? { ...v, owner: p } : v,
            ),
          },
        };
        const second = best(
          g.legal.settlement.filter((id) => !blocked.has(id)),
          (id) => economicVertex(next, id, true),
        );
        if (second !== undefined)
          score += economicVertex(next, second, true) * 0.6;
      }
      return (
        score +
        (g.mode === "seafarers" &&
        g.setupStep < g.players.length &&
        g.board.vertices[id].tiles.some(
          (tid) => g.board.tiles[tid].resource === "sea",
        )
          ? 3
          : 0)
      );
    });
    return id === undefined ? [] : [{ type: "settlement", id }];
  }
  if (g.phase === "setupRoad" || g.phase === "roadBuilding") {
    const plan = basePlans(g).find((plan) =>
      ["road", "ship"].includes(plan.action.type),
    );
    return plan
      ? [plan.action]
      : g.legal.road.length
        ? [{ type: "road", id: g.legal.road[0] }]
        : g.legal.ship.length
          ? [{ type: "ship", id: g.legal.ship[0] }]
          : g.phase === "roadBuilding"
            ? [{ type: "skipRoads" }]
            : [];
  }
  if (g.phase === "gold")
    return [
      {
        type: "gold",
        resources: chooseCards(g, Math.min(g.goldAmount, total(g.bank!))),
      },
    ];
  if (g.phase === "discard") {
    const resources = emptyHand(),
      keep = basePlans(g)[0]?.cost ?? {};
    for (let n = 0; n < g.discards[p]; n++) {
      const r = best(
        RESOURCES.filter((r) => h[r] > resources[r]),
        (r) =>
          (h[r] - resources[r] > (keep[r] ?? 0) ? 8 : 0) +
          (h[r] - resources[r]) / (resourceValue(g, r) + 0.1),
      );
      if (r) resources[r]++;
    }
    return [{ type: "discard", resources }];
  }
  if (g.phase === "robber" || g.phase === "steal") return robberCandidates(g);
  const usable = (own.dev ?? [])
      .filter((d) => d.bought < g.turn)
      .map((d) => d.kind),
    knight = usable.includes("knight") && !g.devPlayed;
  const blocked = g.board.tiles[g.board.robber].vertices.some(
    (vid) => g.board.vertices[vid].owner === p,
  );
  const armyWins =
    g.army !== p &&
    own.knights >= 2 &&
    own.knights >=
      Math.max(...g.players.filter((_, i) => i !== p).map((p) => p.knights));
  if (g.phase === "roll")
    return knight && (blocked || armyWins)
      ? [{ type: "knight" }, { type: "roll" }]
      : [{ type: "roll" }];
  if (!["action", "special"].includes(g.phase)) return [];
  const plans = basePlans(g),
    affordable = (plan: BotPlan) =>
      RESOURCES.every((r) => h[r] >= (plan.cost[r] ?? 0));
  // Taking a winning build overrides every economic preference.
  for (const plan of plans)
    if (
      affordable(plan) &&
      own.score +
        (plan.action.type === "city" || plan.action.type === "settlement"
          ? 1
          : 0) >=
        g.target
    )
      result.push(plan.action);
  if (g.phase === "action" && !g.devPlayed) {
    if (usable.includes("monopoly")) {
      const expected = (r: Resource) =>
        knownOpponentResource(g, r) ??
        g.players.reduce(
          (s, _, i) => s + (i === p ? 0 : estimateResource(g, i, r)),
          0,
        );
      const r = best(
        RESOURCES.filter((r) => expected(r) >= 3),
        (r) => expected(r) * resourceValue(g, r),
      );
      if (r) result.push({ type: "monopoly", resource: r });
    }
    if (knight && (blocked || armyWins)) result.push({ type: "knight" });
    const waiting = plans.find((plan) => !affordable(plan));
    if (
      usable.includes("plenty") &&
      waiting &&
      RESOURCES.reduce(
        (s, r) => s + Math.max(0, (waiting.cost[r] ?? 0) - h[r]),
        0,
      ) <= 2 &&
      total(g.bank!) >= 2
    )
      result.push({ type: "plenty", resources: chooseCards(g, 2) });
    if (
      usable.includes("roadBuilding") &&
      plans.some(
        (plan) =>
          ["road", "ship"].includes(plan.action.type) && plan.value >= 3,
      )
    )
      result.push({ type: "roadBuilding" });
  }
  const goal = plans[0];
  const fundingWait =
    goal && !affordable(goal) ? botBuildWait(g, goal.cost) : 0;
  for (const plan of plans) {
    if (affordable(plan)) {
      // Preserve cards for a nearby scoring build when a lesser purchase would
      // consume them. Independent surplus cards can still fund useful roads.
      if (
        goal &&
        !affordable(goal) &&
        Number.isFinite(fundingWait) &&
        total(h) <= g.discardLimit &&
        ["road", "buyDev", "ship"].includes(plan.action.type) &&
        RESOURCES.some(
          (r) =>
            (plan.cost[r] ?? 0) > 0 &&
            (goal.cost[r] ?? 0) > 0 &&
            h[r] - (plan.cost[r] ?? 0) < (goal.cost[r] ?? 0),
        ) &&
        (() => {
          const after = { ...h };
          for (const r of RESOURCES) after[r] -= plan.cost[r] ?? 0;
          const afterWait = botBuildWait(g, goal.cost, after);
          if (!Number.isFinite(afterWait)) return true;
          const delay = afterWait - fundingWait;
          // Compare this purchase's value with the delay it imposes on the
          // scoring goal. Purchases that leave its funding intact stay usable.
          return (
            delay > 0 &&
            (goal.value * delay) / (1.6 + fundingWait + delay) > plan.value
          );
        })()
      )
        continue;
      result.push(plan.action);
    } else if (g.phase === "action") {
      const trade = planBankTrade(g, plan);
      if (!goal || plan.priority >= goal.priority * 0.7) {
        const offer = planPlayerTrade(g, plan);
        if (offer) result.push(offer);
        if (trade) result.push(trade);
      }
    }
  }
  if (
    g.phase === "action" &&
    knight &&
    !g.devPlayed &&
    (own.knights < 3 || g.army !== p)
  )
    result.push({ type: "knight" });
  result.push({ type: g.phase === "special" ? "pass" : "end" });
  return result;
}
