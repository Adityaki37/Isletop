import { citiesCandidates, citiesMatchActor } from "./cities-match-driver";
import { GOOD_LABELS, PROGRESS_LABELS, CHOICE_LABELS } from "../lib/goods-ui";
import { RESOURCES, emptyHand } from "../lib/board";
import type { View, Action, Game } from "../lib/game";
import { usesSeafarers } from "../lib/game-modes";
import { chooseMove } from "./autoplay";
export { scenarioTarget } from "../lib/scenarios";
export { citiesMatchActor, GOOD_LABELS, PROGRESS_LABELS, CHOICE_LABELS };
export function candidates(g: View): Action[] {
  if (g.mode === "seafarers") {
    // Only the acting guest's projection is available. Opponents' aggregate
    // card counts stand in for their unknown hands; no hidden order is read.
    const copy = {
      ...g,
      players: g.players.map((x) => ({
        ...x,
        id: "test-only",
        hand: x.hand ?? { ...emptyHand(), wood: x.resources },
        dev: x.dev ?? [],
      })),
      deck: Array(g.deckCount).fill("knight"),
      receipts: [],
    } as unknown as Game;
    const move = chooseMove(copy, g.me);
    return move ? [move] : [];
  }
  const p = g.me,
    c = g.cities!,
    own = c.players[p],
    hand = g.players[p].hand!;
  const harbor = c.harbors.find((h) => h.owner === p && h.turn === g.turn);
  // Offering to a seat without commodities is legal and spends no resource.
  // Never inspect an opponent's private hand to decide whom to offer to.
  const resource = RESOURCES.find((r) => hand[r] > 0);
  if (g.phase === "action" && harbor)
    return [
      harbor.remaining.length && resource
        ? {
            type: "harborExchange",
            cardId: harbor.id,
            to: harbor.remaining[0],
            resource,
          }
        : { type: "finishHarbor", cardId: harbor.id },
    ] as Action[];
  const moves = citiesCandidates(g).filter((a) => {
    if (a.type !== "progress") return true;
    const k = own.progress!.find((x) => x.id === a.cardId)!.kind;
    if (k === "merchant") {
      const tile = g.board.tiles[a.tile!];
      return (
        !tile.fog &&
        tile.resource !== "sea" &&
        tile.resource !== "gold" &&
        tile.vertices.some((id) => g.board.vertices[id].owner === p)
      );
    }
    if (k === "warlord")
      return c.knights.some((x) => x.owner === p && !x.active);
    if (k === "irrigation" || k === "mining")
      return g.board.tiles.some(
        (t) =>
          t.resource === (k === "irrigation" ? "wheat" : "ore") &&
          t.vertices.some((id) => g.board.vertices[id].owner === p),
      );
    if (k === "commercialHarbor") return RESOURCES.some((r) => hand[r] > 0);
    if (k === "roadBuilding")
      return (
        (g.legal.road.length > 0 &&
          g.board.edges.filter((e) => e.owner === p && e.kind !== "ship")
            .length < 15) ||
        (g.legal.ship.length > 0 &&
          g.board.edges.filter((e) => e.owner === p && e.kind === "ship")
            .length < 15)
      );
    if (k === "masterMerchant")
      return (
        g.players[a.target!].score > g.players[p].score &&
        g.players[a.target!].resources > 0
      );
    if (k === "spy") return c.players[a.target!].progressCount > 0;
    if (k === "deserter") return c.knights.some((x) => x.owner === a.target);
    if (k === "wedding" || k === "saboteur")
      return g.players.some(
        (x, i) =>
          i !== p &&
          (k === "saboteur" ? x.resources >= 2 : x.resources > 0) &&
          (k === "wedding"
            ? x.score > g.players[p].score
            : x.score >= g.players[p].score),
      );
    if (k === "intrigue")
      return g.board.vertices[a.vertex!].edges.some(
        (id) => g.board.edges[id].owner === p,
      );
    if (k === "bishop") {
      // The ordinary robber projection is populated only in the robber phase.
      // Bishop's action/roll dialog uses the visible land and friendly rule.
      const tile = g.board.tiles[a.tile!];
      return (
        c.attacks > 0 &&
        !tile.fog &&
        tile.resource !== "sea" &&
        tile.id !== g.board.robber &&
        (!g.friendlyRobber ||
          tile.vertices.every((id) => {
            const owner = g.board.vertices[id].owner;
            return owner === null || g.players[owner].publicScore > 2;
          }))
      );
    }
    return true;
  });
  if (usesSeafarers(g.mode)) {
    // Test decisions use only owned legal destinations and visible terrain.
    // Prefer a ship for alternating opening routes and the first free route.
    if (
      (g.phase === "setupRoad" && g.setupStep % 2 === 0) ||
      (g.phase === "roadBuilding" && c.freeRoutes?.remaining === 2)
    )
      moves.sort(
        (a, b) => Number(b.type === "ship") - Number(a.type === "ship"),
      );
    if (g.phase === "robber" && g.legal.pirate.length && g.turn % 2 === 0)
      moves.unshift({ type: "pirate", id: g.legal.pirate[0] });
    if (g.phase === "action" && g.legal.moveShips.length) {
      const value = (id: number) =>
        Math.max(
          ...[g.board.edges[id].a, g.board.edges[id].b].map((v) =>
            g.board.vertices[v].tiles.reduce(
              (n, id) =>
                n +
                (g.board.tiles[id].fog
                  ? 3
                  : g.board.tiles[id].resource === "gold"
                    ? 2
                    : g.board.tiles[id].resource !== "sea"
                      ? 1
                      : 0),
              0,
            ),
          ),
        );
      for (const id of g.legal.moveShips) {
        const to = [...(g.legal.shipDestinations[id] ?? [])].sort(
          (a, b) => value(b) - value(a),
        )[0];
        if (to !== undefined && value(to) > value(id)) {
          moves.unshift({ type: "moveShip", id, to });
          break;
        }
      }
    }
  }
  return moves;
}
export function roadTrails(g: View, p: number) {
  // Independent edge traversal: opponent buildings and knights end a trail.
  const edges = g.board.edges.filter((e) => e.owner === p),
    knights = g.cities?.knights ?? [];
  const walk = (
    v: number,
    seen: Set<number>,
    previous?: "road" | "ship",
  ): number => {
    if (
      seen.size &&
      ((g.board.vertices[v].owner !== null &&
        g.board.vertices[v].owner !== p) ||
        knights.some((k) => k.vertex === v && k.owner !== p))
    )
      return seen.size;
    let best = seen.size;
    for (const e of edges)
      if (
        !seen.has(e.id) &&
        (e.a === v || e.b === v) &&
        (!previous ||
          previous === (e.kind ?? "road") ||
          g.board.vertices[v].owner === p)
      )
        best = Math.max(
          best,
          walk(
            e.a === v ? e.b : e.a,
            new Set([...seen, e.id]),
            e.kind ?? "road",
          ),
        );
    return best;
  };
  return Math.max(
    0,
    ...[...new Set(edges.flatMap((e) => [e.a, e.b]))].map((v) =>
      walk(v, new Set()),
    ),
  );
}
export function score(g: View, p: number) {
  const c = g.cities;
  return (
    g.board.vertices
      .filter((v) => v.owner === p)
      .reduce((s, v) => s + (v.city ? 2 : 1), 0) +
    (g.longest === p ? 2 : 0) +
    (g.players[p].islandBonus ?? 0) +
    (c
      ? c.players[p].defenders +
        c.players[p].revealed.length +
        (c.merchant?.owner === p ? 1 : 0) +
        Object.values(c.metropolises).filter((m) => m?.owner === p).length * 2
      : (g.army === p ? 2 : 0) +
        (g.players[p].dev?.filter((d) => d.kind === "victory").length ?? 0))
  );
}
export { applyReplayPatch } from "../lib/match-replay";
