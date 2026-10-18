import { usesSeafarers } from "./game-modes";
// Production decisions for both explicit bots and disconnected seats.
// Decisions consume only the acting seat's projected View, not other hands/decks.
import { Action, Game, View, applyAction, actor, view } from "./game";
import { RESOURCES, Resource } from "./board";
import { CityTrack, Good, GOODS, TRACKS, citiesHand } from "./cities-knights";
import { openDiplomatRoads } from "./cities-progress";
import { pips } from "./bot-economy";
import { robberValue, plannedBaseCandidates } from "./bot-strategy-planned";

type Plan = { action: Action; cost: Partial<Record<Good, number>> };
const commodity: Record<CityTrack, Good> = {
  science: "paper",
  trade: "cloth",
  politics: "coin",
};
const best = <T>(items: readonly T[], value: (item: T) => number) =>
  [...items].sort((a, b) => value(b) - value(a))[0];
export function vertexYield(g: View, id: number) {
  const existing = new Set(
    g.board.vertices
      .filter((v) => v.owner === g.me)
      .flatMap((v) => v.tiles.map((id) => g.board.tiles[id].resource)),
  );
  const portScore =
    g.map === "blackForest" &&
    g.board.ports.some((port) => {
      const e = g.board.edges[port.edge];
      return [e.a, e.b].includes(id);
    })
      ? 12
      : 0;
  return (
    portScore +
    g.board.vertices[id].tiles.reduce((score, id) => {
      const t = g.board.tiles[id];
      if (t.resource === "gold")
        return score + (6 - Math.abs(7 - t.number)) * 2;
      if (!RESOURCES.includes(t.resource as Resource)) return score;
      return (
        score +
        (6 - Math.abs(7 - t.number)) *
          (existing.has(t.resource) ? 1 : 1.6) *
          { wood: 1.1, brick: 1, sheep: 1, wheat: 1.5, ore: 1.5 }[
            t.resource as Resource
          ]
      );
    }, 0)
  );
}
function route(g: View, kind: "road" | "ship" = "road") {
  const targets = g.board.vertices
    .filter(
      (v) =>
        v.owner === null &&
        !g.cities!.knights.some((k) => k.vertex === v.id) &&
        v.edges.every((id) => {
          const e = g.board.edges[id];
          return g.board.vertices[e.a === v.id ? e.b : e.a].owner === null;
        }),
    )
    .map((v) => v.id);
  const distance = new Map(targets.map((id) => [id, 0]));
  let frontier = targets;
  for (let depth = 1; depth < 10 && frontier.length; depth++) {
    const next: number[] = [];
    for (const id of frontier)
      for (const eid of g.board.vertices[id].edges) {
        const e = g.board.edges[eid],
          other = e.a === id ? e.b : e.a;
        const v = g.board.vertices[other],
          k = g.cities!.knights.find((k) => k.vertex === other);
        if (
          (e.owner === null || e.owner === g.me) &&
          (v.owner === null || v.owner === g.me) &&
          (!k || k.owner === g.me) &&
          !distance.has(other)
        ) {
          distance.set(other, depth);
          next.push(other);
        }
      }
    frontier = next;
  }
  return best(g.legal[kind], (id) => {
    const e = g.board.edges[id];
    return Math.max(
      ...[e.a, e.b].map(
        (id) => 30 - (distance.get(id) ?? 20) * 8 + vertexYield(g, id) * 0.1,
      ),
    );
  });
}
function affordable(g: View, cost: Plan["cost"]) {
  return GOODS.every((r) => (g.players[g.me].hand?.[r] ?? 0) >= (cost[r] ?? 0));
}
function plans(g: View): Plan[] {
  const c = g.cities!,
    legal = g.citiesLegal!,
    p = g.me,
    own = c.players[p];
  const cities = g.board.vertices.filter((v) => v.owner === p && v.city),
    knights = c.knights.filter((k) => k.owner === p);
  const strength = knights.reduce((n, k) => n + k.level, 0),
    result: Plan[] = [];
  const add = (action: Action, cost: Plan["cost"]) =>
    result.push({ action, cost });
  for (const id of legal.activate)
    add({ type: "activateKnight", id }, { wheat: 1 });
  if (strength < cities.length + 2) {
    if (legal.promote.length)
      add(
        { type: "promoteKnight", id: legal.promote[0] },
        { sheep: 1, ore: 1 },
      );
    if (legal.knight.length)
      add(
        {
          type: "placeKnight",
          id: best(
            legal.knight,
            (id) =>
              g.board.vertices[id].edges.filter((eid) => {
                const e = g.board.edges[eid];
                return g.board.vertices[e.a === id ? e.b : e.a].owner === p;
              }).length *
                100 -
              vertexYield(g, id),
          ),
        },
        { sheep: 1, ore: 1 },
      );
  }
  if (!cities.length && g.legal.city.length)
    add(
      { type: "city", id: best(g.legal.city, (id) => vertexYield(g, id)) },
      { wheat: 2, ore: 3 },
    );
  for (const track of [...TRACKS].sort((a, b) => {
    const value = (track: CityTrack) =>
      own.improvements[track] < 3
        ? 20 - own.improvements[track] + (track === "science" ? 3 : 0)
        : 10 - own.improvements[track];
    return value(b) - value(a);
  })) {
    const level = own.improvements[track],
      holder = c.metropolises[track];
    const freeCity = cities.some(
      (v) => !TRACKS.some((track) => c.metropolises[track]?.vertex === v.id),
    );
    if (
      cities.length &&
      level < 5 &&
      (level < 3 || holder?.owner === p || freeCity)
    )
      add({ type: "improve", track }, { [commodity[track]]: level + 1 });
  }
  if (g.legal.city.length)
    add(
      { type: "city", id: best(g.legal.city, (id) => vertexYield(g, id)) },
      { wheat: 2, ore: 3 },
    );
  if (g.legal.settlement.length)
    add(
      {
        type: "settlement",
        id: best(g.legal.settlement, (id) => vertexYield(g, id)),
      },
      { wood: 1, brick: 1, sheep: 1, wheat: 1 },
    );
  if (
    g.legal.road.length &&
    g.board.edges.filter((e) => e.owner === p && e.kind !== "ship").length < 15
  )
    add({ type: "road", id: route(g) }, { wood: 1, brick: 1 });
  if (g.legal.ship.length)
    add({ type: "ship", id: route(g, "ship") }, { wood: 1, sheep: 1 });
  if (legal.walls.length)
    add({ type: "wall", id: legal.walls[0] }, { brick: 2 });
  return result;
}
function take(
  g: View,
  count: number,
  hand: Partial<Record<Good, number>>,
  discard: boolean,
) {
  const chosen = citiesHand(),
    keep = plans(g)[0]?.cost ?? {};
  for (let n = 0; n < count; n++) {
    const r = best(
      GOODS.filter((r) => (hand[r] ?? 0) > chosen[r]),
      (r) =>
        discard
          ? (hand[r] ?? 0) - chosen[r] - (keep[r] ?? 0)
          : (keep[r] ?? 0) -
            (g.players[g.me].hand?.[r] ?? 0) -
            chosen[r] +
            0.1 * (hand[r] ?? 0),
    );
    if (r) chosen[r]++;
  }
  return chosen;
}
export function citiesCandidates(g: View): Action[] {
  const p = g.me,
    c = g.cities!,
    own = c.players[p],
    hand = g.players[p].hand!,
    legal = g.citiesLegal!,
    result: Action[] = [];
  const add = (action: Action) => result.push(action);
  if (g.phase === "citiesChoice") {
    const q = c.choice!;
    if ("vertices" in q)
      return [
        {
          type: "citiesChoice",
          vertex: best(
            q.vertices,
            (id) => (q.kind === "pillage" ? -1 : 1) * vertexYield(g, id),
          ),
        },
        ...(q.kind === "deserterPlace"
          ? [{ type: "citiesChoice", vertex: null } as Action]
          : []),
      ];
    if (q.kind === "relocateRoad")
      return [{ type: "citiesChoice", edge: q.edges[0] ?? null }];
    if (q.kind === "deserter")
      return [
        {
          type: "citiesChoice",
          vertex: best(
            c.knights.filter((k) => k.owner === p),
            (k) => -k.level - (k.active ? 1 : 0),
          ).vertex,
        },
      ];
    if (q.kind === "defenderProgress")
      return [
        {
          type: "citiesChoice",
          track: best(
            TRACKS.filter((t) => c.deckCounts[t] > 0),
            (t) => (t === "science" ? 3 : 1),
          ),
        },
      ];
    if (q.kind === "discardProgress")
      return [{ type: "citiesChoice", cardId: own.progress![0].id }];
    if (q.kind === "spy")
      return [{ type: "citiesChoice", cardId: c.peek!.progress![0].id }];
    if (q.kind === "aqueduct")
      return [
        {
          type: "citiesChoice",
          resource: best(
            RESOURCES.filter((r) => (g.bank?.[r] ?? 0) > 0),
            (r) => (plans(g)[0]?.cost[r] ?? 0) - (hand[r] ?? 0),
          ),
        },
      ];
    if (q.kind === "harborExchange")
      return [
        {
          type: "citiesChoice",
          good: best(
            (["paper", "cloth", "coin"] as const).filter(
              (r) => (hand[r] ?? 0) > 0,
            ),
            (r) => hand[r] ?? 0,
          ),
        },
      ];
    if (["masterMerchant", "wedding", "saboteur"].includes(q.kind))
      return [
        {
          type: "citiesChoice",
          resources: take(
            g,
            (q as { count: number }).count,
            q.kind === "masterMerchant" ? c.peek!.hand! : hand,
            q.kind !== "masterMerchant",
          ),
        },
      ];
    throw new Error("Unknown projected expansion choice");
  }
  if (g.phase === "gold")
    return [
      {
        type: "gold",
        resources: take(
          g,
          g.goldAmount,
          Object.fromEntries(RESOURCES.map((r) => [r, g.bank?.[r] ?? 0])),
          false,
        ),
      },
    ];
  if (g.phase === "discard")
    return [{ type: "discard", resources: take(g, g.discards[p], hand, true) }];
  if (g.phase === "setupSettlement")
    return [
      {
        type: "settlement",
        id: best(g.legal.settlement, (id) => vertexYield(g, id)),
      },
    ];
  if (g.phase === "setupRoad" || g.phase === "roadBuilding")
    return [
      ...(g.legal.road.length
        ? [{ type: "road", id: route(g) } as Action]
        : []),
      ...(g.legal.ship.length
        ? [{ type: "ship", id: route(g, "ship") } as Action]
        : []),
      ...(g.phase === "roadBuilding" && !g.legal.road.length && !g.legal.ship.length
        ? [{ type: "skipRoads" } as Action] : []),
    ];
  if (g.phase === "robber") return plannedBaseCandidates(g);
  if (g.phase === "steal")
    return [
      {
        type: "steal",
        id: best(
          g.victims,
          (id) => g.players[id].score + g.players[id].resources,
        ),
      },
    ];
  if (g.phase === "roll") {
    const card = own.progress?.find((card) => card.kind === "alchemist");
    if (card) {
      const sum = best([2, 3, 4, 5, 6, 8, 9, 10, 11, 12], (sum) =>
        g.board.tiles
          .filter((t) => t.number === sum && t.id !== g.board.robber)
          .reduce(
            (n, t) =>
              n +
              t.vertices.reduce((n, id) => {
                const v = g.board.vertices[id];
                return n + (v.owner === p ? (v.city ? 2 : 1) : 0);
              }, 0),
            0,
          ),
      );
      add({
        type: "progress",
        cardId: card.id,
        dice: [Math.min(6, sum - 1), sum - Math.min(6, sum - 1)],
      });
    }
    add({ type: "roll" });
    return result;
  }
  if (!["action", "special"].includes(g.phase))
    throw new Error(`Unexpected match phase ${g.phase}`);
  // A point that ends the match has precedence over spending on defense/cards.
  for (const plan of plans(g))
    if (
      g.players[p].score >= g.target - 1 &&
      ["city", "settlement"].includes(plan.action.type) &&
      affordable(g, plan.cost)
    )
      add(plan.action);
  if (g.phase === "action")
    for (const card of own.progress ?? []) {
      const a: Action = { type: "progress", cardId: card.id },
        kind = card.kind;
      if (kind === "alchemist") continue;
      if (kind === "crane") for (const track of TRACKS) add({ ...a, track });
      else if (kind === "engineer")
        for (const vertex of legal.walls) add({ ...a, vertex });
      else if (kind === "medicine" && affordable(g, { wheat: 1, ore: 2 }))
        for (const vertex of g.legal.city) add({ ...a, vertex });
      else if (kind === "inventor") {
        const tiles = g.board.tiles.filter((t) =>
          [3, 4, 5, 9, 10, 11].includes(t.number),
        );
        const value = (tile: (typeof tiles)[number]) =>
          tile.vertices.reduce((s, id) => {
            const v = g.board.vertices[id];
            return (
              s +
              (v.owner === p
                ? 1
                : v.owner === null
                  ? 0
                  : -0.6 * (1 + g.players[v.owner].publicScore / g.target)) *
                (v.city ? 2 : 1)
            );
          }, 0);
        let pair: [number, number] | null = null,
          gain = 0;
        for (let i = 0; i < tiles.length; i++)
          for (let j = i + 1; j < tiles.length; j++) {
            const delta =
              (value(tiles[i]) - value(tiles[j])) *
              (pips(tiles[j].number) - pips(tiles[i].number));
            if (delta > gain) {
              gain = delta;
              pair = [tiles[i].id, tiles[j].id];
            }
          }
        if (pair) add({ ...a, tiles: pair });
      } else if (kind === "smith" && legal.promote.length)
        add({ ...a, knights: legal.promote.slice(0, 2) });
      else if (kind === "merchant")
        for (const tile of g.board.tiles
          .filter((t) =>
            t.vertices.some((id) => g.board.vertices[id].owner === p),
          )
          .sort(
            (a, b) =>
              (hand[b.resource as Good] ?? 0) - (hand[a.resource as Good] ?? 0),
          ))
          add({ ...a, tile: tile.id });
      else if (kind === "merchantFleet")
        add({
          ...a,
          good: best(
            GOODS,
            (r) => (hand[r] ?? 0) - (plans(g)[0]?.cost[r] ?? 0),
          ),
        });
      else if (kind === "resourceMonopoly")
        add({
          ...a,
          good: best(
            RESOURCES,
            (r) => (plans(g)[0]?.cost[r] ?? 0) - (hand[r] ?? 0),
          ),
        });
      else if (kind === "commodityMonopoly")
        add({
          ...a,
          good: best(
            ["paper", "cloth", "coin"] as const,
            (r) => 5 - (hand[r] ?? 0),
          ),
        });
      else if (["masterMerchant", "spy", "deserter"].includes(kind)) {
        for (const target of g.players
          .map((_, i) => i)
          .filter((i) => i !== p)
          .sort(
            (a, b) =>
              g.players[b].publicScore - g.players[a].publicScore ||
              g.players[b].resources - g.players[a].resources,
          ))
          add({ ...a, target });
      } else if (kind === "diplomat")
        for (const edge of openDiplomatRoads({
          board: g.board,
          cities: c,
          seafarers: usesSeafarers(g.mode),
        }))
          add({ ...a, edge });
      else if (kind === "intrigue")
        for (const k of c.knights.filter((k) => k.owner !== p))
          add({ ...a, vertex: k.vertex });
      else if (kind === "bishop")
        for (const tile of g.board.tiles
          .filter(
            (t) =>
              t.id !== g.board.robber && t.resource !== "sea" && c.attacks > 0,
          )
          .sort((a, b) => robberValue(g, b.id) - robberValue(g, a.id)))
          add({ ...a, tile: tile.id });
      else if (!["printer", "constitution", "medicine", "smith"].includes(kind))
        add(a);
    }
  const building = plans(g);
  for (const plan of building) if (affordable(g, plan.cost)) add(plan.action);
  if (g.phase === "action") {
    for (const plan of building)
      for (const to of GOODS.filter(
        (r) => (hand[r] ?? 0) < (plan.cost[r] ?? 0) && (g.bank?.[r] ?? 0) > 0,
      )) {
        const from = best(
          GOODS.filter(
            (r) =>
              r !== to &&
              (hand[r] ?? 0) - (plan.cost[r] ?? 0) >= (g.rates[r] ?? 4),
          ),
          (r) => (hand[r] ?? 0) - (plan.cost[r] ?? 0),
        );
        if (from) {
          const give = citiesHand(),
            want = citiesHand();
          give[from] = g.rates[from] ?? 4;
          want[to] = 1;
          add({ type: "bankTrade", give, want });
        }
      }
    add({ type: "end" });
  } else add({ type: "pass" });
  return result;
}
// A legality probe on a clone cannot alter the real match or its random stream.
// The chosen action is subsequently submitted through the actual engine/API.
export function chooseLegalCitiesMove(g: Game): Action {
  const p = citiesMatchActor(g),
    visible = view(g, g.players[p].id),
    errors: string[] = [];
  for (const a of citiesCandidates(visible)) {
    try {
      applyAction(structuredClone(g), p, a, () => 0.42, Date.now());
      return a;
    } catch (e) {
      errors.push(`${a.type}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(
    `No legal projected move at ${g.phase}: ${errors.join("; ")}`,
  );
}
export function citiesMatchActor(g: Game | View) {
  return g.phase === "discard"
    ? Number(Object.keys(g.discards)[0])
    : g.phase === "gold"
      ? Number(Object.keys(g.goldClaims)[0])
      : actor(g);
}
