import { Resource, RESOURCES, emptyHand } from "../lib/board";
import {
  Game,
  Action,
  actor,
  affordable,
  applyAction,
  bankRate,
  COSTS,
  legalCities,
  legalRoads,
  legalSettlements,
  legalRobberTiles,
  legalShips,
  legalPirateTiles,
  legalMoveShips,
  shipDestinations,
  points,
  total,
} from "../lib/game";
export function vertexValue(g: Game, id: number, p: number) {
  const v = g.board.vertices[id],
    production = emptyHand();
  g.board.vertices
    .filter((v) => v.owner === p)
    .forEach((v) =>
      v.tiles.forEach((tid) => {
        const t = g.board.tiles[tid];
        if (RESOURCES.includes(t.resource as Resource))
          production[t.resource as Resource] += 6 - Math.abs(7 - t.number);
      }),
    );
  let score = 0;
  for (const tid of v.tiles) {
    const t = g.board.tiles[tid];
    if (t.resource === "desert" || t.resource === "sea") continue;
    if (t.resource === "gold") {
      score += (6 - Math.abs(7 - t.number)) * 1.5;
      continue;
    }
    score +=
      (6 - Math.abs(7 - t.number)) *
      (production[t.resource] === 0 ? 1.7 : 1) *
      { wood: 1.1, brick: 1.2, sheep: 0.85, wheat: 1.25, ore: 1.25 }[
        t.resource
      ];
  }
  for (const port of g.board.ports) {
    const e = g.board.edges[port.edge];
    if ([e.a, e.b].includes(id))
      score += g.map === "blackForest" ? 12 : port.resource === "any" ? 2 : 1;
  }
  return score;
}
function best<T>(xs: readonly T[], value: (x: T) => number) {
  return [...xs].sort((a, b) => value(b) - value(a))[0];
}
function bestRoad(g: Game, p: number, setup = false) {
  const choices = legalRoads(g, p, setup),
    targets = legalSettlements(g, p, true);
  const distances = new Map<number, number>();
  for (const target of targets) distances.set(target, 0);
  let frontier = [...targets];
  for (let depth = 1; depth < 8 && frontier.length; depth++) {
    const next: number[] = [];
    for (const id of frontier)
      for (const eid of g.board.vertices[id].edges) {
        const e = g.board.edges[eid],
          other = e.a === id ? e.b : e.a,
          v = g.board.vertices[other];
        if (
          (e.owner === null || e.owner === p) &&
          (v.owner === null || v.owner === p) &&
          !distances.has(other)
        ) {
          distances.set(other, depth);
          next.push(other);
        }
      }
    frontier = next;
  }
  return best(choices, (eid) => {
    const e = g.board.edges[eid];
    return (
      Math.max(
        ...[e.a, e.b].map(
          (id) =>
            (distances.has(id) ? 12 - (distances.get(id) ?? 8) * 4 : -25) +
            vertexValue(g, id, p) * 0.1 +
            (targets.includes(id) ? 8 : 0),
        ),
      ) +
      // Stable tie-breaking keeps seeded match fixtures reproducible.
      ((eid * 37) % 101) / 1010
    );
  });
}
function bestShip(g: Game, p: number, choices = legalShips(g, p)) {
  const targets = g.board.vertices.filter(
    (v) =>
      v.owner === null &&
      v.tiles.some((id) => {
        const t = g.board.tiles[id];
        return (
          (t.fog || t.resource !== "sea") &&
          t.resource !== "desert" &&
          (g.scenario === "fourIslands"
            ? !g.players[p].islands.includes(t.island!)
            : !t.home)
        );
      }) &&
      v.edges.every((id) => {
        const e = g.board.edges[id];
        return g.board.vertices[e.a === v.id ? e.b : e.a].owner === null;
      }),
  );
  const distance = new Map(targets.map((v) => [v.id, 0]));
  let frontier = targets.map((v) => v.id);
  for (let depth = 1; depth < 15 && frontier.length; depth++) {
    const next: number[] = [];
    for (const id of frontier)
      for (const eid of g.board.vertices[id].edges) {
        const e = g.board.edges[eid],
          other = e.a === id ? e.b : e.a;
        if (
          (e.owner === null || e.owner === p) &&
          e.tiles.some((t) => g.board.tiles[t].resource === "sea") &&
          !e.tiles.includes(g.board.pirate!) &&
          (g.board.vertices[other].owner === null ||
            g.board.vertices[other].owner === p) &&
          !distance.has(other)
        ) {
          distance.set(other, depth);
          next.push(other);
        }
      }
    frontier = next;
  }
  return best(choices, (id) => {
    const e = g.board.edges[id];
    return Math.max(
      ...[e.a, e.b].map(
        (v) => 20 - (distance.get(v) ?? 20) * 4 + vertexValue(g, v, p) * 0.05,
      ),
    );
  });
}
function desired(g: Game, p: number): Partial<Record<Resource, number>> {
  if (legalSettlements(g, p).length) return COSTS.settlement;
  if (legalCities(g, p).length && g.players[p].hand.ore >= 1) return COSTS.city;
  if (
    g.mode === "seafarers" &&
    legalShips(g, p).length &&
    g.board.edges.filter((e) => e.owner === p && e.kind === "ship").length < 6
  )
    return COSTS.ship;
  // Match the actual build policy, so a capped route does not hoard lumber
  // and brick indefinitely instead of saving for development cards.
  if (
    legalRoads(g, p).length &&
    legalSettlements(g, p, true).length &&
    g.board.edges.filter((e) => e.owner === p).length < 12
  )
    return COSTS.road;
  if (g.deck.length) return COSTS.development;
  return COSTS.city;
}
export function chooseMove(g: Game, p = actor(g)): Action | null {
  const pl = g.players[p],
    h = pl.hand;
  if (g.phase === "gold" && g.goldClaims[p]) {
    const resources = emptyHand(),
      cost = desired(g, p),
      amount = Math.min(g.goldClaims[p], total(g.bank));
    for (let i = 0; i < amount; i++)
      resources[
        best(
          RESOURCES.filter((r) => g.bank[r] > resources[r]),
          (r) => (cost[r] ?? 0) - h[r] - resources[r],
        )
      ]++;
    return { type: "gold", resources };
  }
  if (g.phase === "discard" && g.discards[p]) {
    const resources = emptyHand(),
      keep = desired(g, p);
    for (let i = 0; i < g.discards[p]; i++) {
      const r = best(
        RESOURCES.filter((r) => h[r] - resources[r] > 0),
        (r) => h[r] - resources[r] - (keep[r] ?? 0) + (r === "sheep" ? 0.2 : 0),
      );
      resources[r]++;
    }
    return { type: "discard", resources };
  }
  if (p !== actor(g)) return null;
  if (g.phase === "setupSettlement")
    return {
      type: "settlement",
      id: best(
        legalSettlements(g, p, true),
        (id) =>
          vertexValue(g, id, p) +
          (g.mode === "seafarers" &&
          g.setupStep < g.players.length &&
          g.board.vertices[id].tiles.some(
            (t) => g.board.tiles[t].resource === "sea",
          )
            ? 5
            : 0),
      ),
    };
  if (
    g.phase === "setupRoad" &&
    g.mode === "seafarers" &&
    g.setupStep < g.players.length &&
    legalShips(g, p, true).length
  )
    return { type: "ship", id: bestShip(g, p, legalShips(g, p, true)) };
  if (g.phase === "setupRoad")
    return { type: "road", id: bestRoad(g, p, true) };
  if (g.phase === "robber") {
    if (g.mode === "seafarers") {
      const pirate = best(legalPirateTiles(g), (id) =>
        g.board.edges
          .filter((e) => e.tiles.includes(id) && e.kind === "ship")
          .reduce(
            (n, e) => n + (e.owner === p ? -2 : e.owner !== null ? 2 : 0),
            0,
          ),
      );
      if (
        pirate !== undefined &&
        g.board.edges.some(
          (e) =>
            e.tiles.includes(pirate) &&
            e.kind === "ship" &&
            e.owner !== p &&
            e.owner !== null,
        )
      )
        return { type: "pirate", id: pirate };
    }
    return {
      type: "robber",
      id: best(
        g.board.tiles.filter((t) => legalRobberTiles(g).includes(t.id)),
        (t) => {
          let score = 0;
          for (const vid of t.vertices) {
            const v = g.board.vertices[vid];
            if (v.owner !== null)
              score +=
                (v.owner === p ? -5 : 1 + points(g, v.owner, false) * 0.4) *
                (v.city ? 2 : 1);
          }
          return (
            score * (6 - Math.abs(7 - t.number)) +
            (t.resource === "desert" ? -2 : 0)
          );
        },
      )?.id,
    };
  }
  if (g.phase === "steal")
    return {
      type: "steal",
      id: best(
        g.victims,
        (i) => points(g, i, false) * 2 + total(g.players[i].hand),
      ),
    };
  if (g.phase === "roadBuilding") {
    if (
      g.mode === "seafarers" &&
      legalShips(g, p).length &&
      g.board.edges.filter((e) => e.owner === p && e.kind === "ship").length < 6
    )
      return { type: "ship", id: bestShip(g, p) };
    const id = bestRoad(g, p);
    if (id !== undefined) return { type: "road", id };
    // Free routes must still be placed when the preferred ship count is met.
    const ship = g.mode === "seafarers" ? bestShip(g, p) : undefined;
    return ship === undefined ? { type: "skipRoads" } : { type: "ship", id: ship };
  }
  if (g.phase === "roll") {
    if (
      !g.devPlayed &&
      pl.dev.some((d) => d.kind === "knight" && d.bought < g.turn)
    )
      return { type: "knight" };
    return { type: "roll" };
  }
  if (!["action", "special"].includes(g.phase)) return null;
  if (g.phase === "action") {
    for (const o of g.offers) {
      if (
        o.from === p ||
        (o.to !== null && o.to !== p) ||
        o.rejected.includes(p) ||
        o.accepted.includes(p) ||
        !affordable(g, p, o.want) ||
        !affordable(g, o.from, o.give)
      )
        continue;
      const cost = desired(g, p);
      const value = (hand: typeof h) =>
        RESOURCES.reduce(
          (n, r) => n + hand[r] * (h[r] < (cost[r] ?? 0) ? 2 : 1),
          0,
        );
      if (value(o.give) >= value(o.want)) return { type: "accept", id: o.id };
    }
    if (!g.devPlayed) {
      const usable = pl.dev.filter((d) => d.bought < g.turn).map((d) => d.kind);
      if (usable.includes("monopoly")) {
        const r = best(RESOURCES, (r) =>
          g.players.reduce(
            (n, other, i) => n + (i === p ? 0 : other.hand[r]),
            0,
          ),
        );
        if (
          g.players.reduce(
            (n, other, i) => n + (i === p ? 0 : other.hand[r]),
            0,
          ) >= 2
        )
          return { type: "monopoly", resource: r };
      }
      if (usable.includes("roadBuilding") && legalRoads(g, p).length)
        return { type: "roadBuilding" };
      if (usable.includes("plenty") && total(g.bank) >= 2) {
        const resources = emptyHand(),
          cost = desired(g, p);
        for (let i = 0; i < 2; i++) {
          const r = best(
            RESOURCES.filter((r) => g.bank[r] > resources[r]),
            (r) => (cost[r] ?? 0) - h[r] - resources[r],
          );
          resources[r]++;
        }
        return { type: "plenty", resources };
      }
      if (usable.includes("knight")) return { type: "knight" };
    }
  }
  if (affordable(g, p, COSTS.city) && legalCities(g, p).length)
    return {
      type: "city",
      id: best(legalCities(g, p), (id) => vertexValue(g, id, p)),
    };
  if (affordable(g, p, COSTS.settlement) && legalSettlements(g, p).length)
    return {
      type: "settlement",
      id: best(legalSettlements(g, p), (id) => vertexValue(g, id, p)),
    };
  if (
    g.mode === "seafarers" &&
    affordable(g, p, COSTS.ship) &&
    legalShips(g, p).length &&
    g.board.edges.filter((e) => e.owner === p && e.kind === "ship").length < 6
  )
    return { type: "ship", id: bestShip(g, p) };
  if (
    affordable(g, p, COSTS.road) &&
    legalRoads(g, p).length &&
    legalSettlements(g, p, true).length &&
    g.board.edges.filter((e) => e.owner === p).length < 12
  )
    return { type: "road", id: bestRoad(g, p) };
  if (affordable(g, p, COSTS.development) && g.deck.length)
    return { type: "buyDev" };
  if (g.phase === "action") {
    const cost = desired(g, p),
      need = RESOURCES.filter((r) => h[r] < (cost[r] ?? 0) && g.bank[r] > 0);
    for (const to of need) {
      const from = best(
        RESOURCES.filter(
          (r) => r !== to && h[r] - (cost[r] ?? 0) >= bankRate(g, p, r),
        ),
        (r) => h[r] - (cost[r] ?? 0),
      );
      if (from) {
        const give = emptyHand(),
          want = emptyHand();
        give[from] = bankRate(g, p, from);
        want[to] = 1;
        return { type: "bankTrade", give, want };
      }
    }
    return { type: "end" };
  }
  return { type: "pass" };
}
