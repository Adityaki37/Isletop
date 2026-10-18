import { usesSeafarers } from "./game-modes";
import { appendGameLog, appendProductionLog, appendResourceReceipt } from "./game-log";
// Authoritative expansion adapter. Public room creation remains gated until the
// human controls and independent HTTP-seat verification are complete.
import { RESOURCES, secureRandom } from "./board";
import type { Hand } from "./board";
import type { Action, Game, Player } from "./game";
import { drawBalancedDice } from "./dice";
import { recordCitiesProduction } from "./match-statistics";
import {
  CitiesHand,
  CitiesTable,
  GOODS,
  TRACKS,
  Good,
  citiesBank,
  citiesHand,
  createCitiesState,
  citiesDiscardLimit,
  goodsTotal,
  resolveEventDie,
  produceCitiesGoods,
  resolveCitiesChoice,
  queueProgressLimit,
  placeKnight,
  activateKnight,
  promoteKnight,
  moveKnight,
  displaceKnight,
  chaseRobber,
  chasePirate,
  buildCityWall,
  improveCity,
  upgradeCitiesCity,
  canPromoteKnight,
  legalKnightPlacements,
  legalKnightMoves,
  legalKnightDisplacements,
  legalCityWalls,
  robberEnabled,
} from "./cities-knights";
import {
  playProgress,
  resolveProgressChoice,
  isProgressChoice,
  endCitiesEffects,
  beginHarborExchange,
  finishHarbor,
  buildProgressRoad,
  finishProgressRoads,
  ProgressAnswer,
  ProgressArgs,
} from "./cities-progress";

export type GameHand = Hand &
  Partial<Record<"paper" | "cloth" | "coin", number>>;
export type CitiesFlow =
  | { kind: "roll"; sum: number }
  | { kind: "resume"; phase: "action" | "special" }
  | { kind: "end" };
export type CitiesRoomHooks = {
  awards: (g: Game) => void;
  checkWin: (g: Game) => void;
  beginRobber: (
    g: Game,
    phase: "roll" | "action",
    kind?: "robber" | "pirate",
  ) => void;
  endTurn: (g: Game) => void;
  points: (g: Game, p: number, hidden?: boolean) => number;
  legalRobberTiles: (g: Game) => number[];
  legalPirateTiles: (g: Game) => number[];
  discoverFog: (g: Game, p: number, edge: number) => void;
};
function rule(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function citiesTable(g: Game): CitiesTable {
  rule(g.cities, "Cities & Defenders is unavailable in this room.");
  return {
    board: g.board,
    seafarers: usesSeafarers(g.mode),
    players: g.players as (Player & { hand: CitiesHand })[],
    bank: g.bank as CitiesHand,
    active: g.active,
    turnOrder: g.turnOrder,
    turn: g.turn,
    cities: g.cities,
  };
}
function run<T>(g: Game, operation: (t: CitiesTable) => T) {
  const t = citiesTable(g),
    result = operation(t);
  g.board = t.board;
  g.players = t.players as Player[];
  g.bank = t.bank;
  g.cities = t.cities;
  return result;
}
export function initializeCitiesRoom(g: Game) {
  g.cities = createCitiesState(g.players.length);
  g.bank = citiesBank(g.players.length);
  g.deck = [];
  for (const p of g.players) {
    p.hand = citiesHand();
    p.dev = [];
    p.knights = 0;
  }
  g.citiesFlow = null;
  g.citiesChoiceSeq = 0;
  g.army = null;
}
const appendLog = appendGameLog;
function finishFlow(g: Game, hooks: CitiesRoomHooks) {
  if (g.cities!.choices.length) {
    g.phase = "citiesChoice";
    g.citiesChoiceSeq++;
    return;
  }
  const flow = g.citiesFlow;
  g.citiesFlow = null;
  if (flow?.kind === "roll") {
    if (flow.sum === 7) {
      appendLog(g, "No resources produced on a seven.");
      g.discards = {};
      for (let p = 0; p < g.players.length; p++) {
        const amount = goodsTotal(g.players[p].hand as CitiesHand);
        if (amount > citiesDiscardLimit(citiesTable(g), p, g.discardLimit))
          g.discards[p] = Math.floor(amount / 2);
      }
      if (Object.keys(g.discards).length) g.phase = "discard";
      else hooks.beginRobber(g, "action");
    } else {
      const production = run(g, (t) => produceCitiesGoods(t, flow.sum));
      recordCitiesProduction(g, flow.sum, production.received);
      appendProductionLog(g, production.received, production.gold,
        g.cities!.choices.filter((choice) => choice.kind === "aqueduct").map((choice) => choice.player), flow.sum);
      g.phase = "action";
      if (g.cities!.choices.length) {
        g.citiesFlow = { kind: "resume", phase: "action" };
        g.phase = "citiesChoice";
        g.citiesChoiceSeq++;
      }
      const resources = RESOURCES.reduce((n, r) => n + g.bank[r], 0);
      if (resources && production.gold.some((n) => n > 0)) {
        g.goldClaims = Object.fromEntries(
          production.gold.flatMap((n, p) => (n ? [[p, n]] : [])),
        );
        g.goldResume = g.phase;
        g.phase = "gold";
      }
    }
  } else if (flow?.kind === "end") {
    run(g, endCitiesEffects);
    hooks.endTurn(g);
  } else if (flow?.kind === "resume") g.phase = flow.phase;
  if (!g.cities!.choices.length) {
    hooks.awards(g);
    hooks.checkWin(g);
  }
}
export function rollCities(
  g: Game,
  p: number,
  hooks: CitiesRoomHooks,
  rng = secureRandom,
  forced?: [number, number],
) {
  rule(
    g.phase === "roll" && g.active === p && !g.cities!.choices.length,
    "Roll once on your own normal turn.",
  );
  g.dice = forced
    ? [...forced]
    : g.diceMode === "balanced"
      ? drawBalancedDice(g.diceState, p, g.players.length, rng)
      : [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
  const sum = g.dice[0] + g.dice[1],
    event = 1 + Math.floor(rng() * 6);
  g.rollCounts[sum] = (g.rollCounts[sum] ?? 0) + 1;
  g.citiesFlow = { kind: "roll", sum };
  const attack = run(g, (t) => resolveEventDie(t, g.dice[1], event));
  appendLog(
    g,
    `${g.players[p].name} rolled ${sum}; event: ${g.cities!.event}.`,
  );
  if (attack)
    appendLog(
      g,
      `Barbarians attacked with strength ${attack.barbarianStrength}; knights contributed ${attack.knightStrength}. ${attack.defended ? "The island was defended." : "Vulnerable cities must be pillaged."}`,
    );
  finishFlow(g, hooks);
}
// Called before the shared base-room building/trade paths. Returns true when
// the expansion owns the action, and throws if a pending choice blocks it.
export function performCitiesAction(
  g: Game,
  p: number,
  a: Action,
  hooks: CitiesRoomHooks,
  rng = secureRandom,
): boolean {
  if (!g.cities) return false;
  if (g.phase === "citiesChoice") {
    rule(
      a.type === "citiesChoice",
      "Resolve the pending Cities & Defenders choice first.",
    );
    const choice = g.cities.choices[0];
    rule(choice?.player === p, "It is another player's pending choice.");
    run(g, (t) =>
      isProgressChoice(choice.kind)
        ? resolveProgressChoice(t, p, {
            resources: a.resources,
            cardId: a.cardId,
            vertex: a.vertex,
            edge: a.edge,
            commodity: a.good as ProgressAnswer["commodity"],
          })
        : resolveCitiesChoice(t, p, {
            vertex: a.vertex ?? undefined,
            track: a.track,
            cardId: a.cardId,
            resource: a.resource,
          }),
    );
    if (choice.kind === "aqueduct")
      appendResourceReceipt(g, p, { [a.resource!]: 1 }, "Aqueduct");
    else appendLog(g, `${g.players[p].name} resolved ${choice.kind}.`);
    finishFlow(g, hooks);
    if (choice.kind === "relocateRoad" && a.edge != null)
      hooks.discoverFog(g, p, a.edge);
    return true;
  }
  if (g.phase === "gold") return false;
  rule(a.type !== "citiesChoice", "No expansion choice is pending.");
  if (g.cities.freeRoutes) {
    rule(
      g.phase === "roadBuilding" &&
        p === g.active &&
        ["road", "ship", "skipRoads"].includes(a.type),
      "Finish the free road placements first.",
    );
    run(g, (t) =>
      a.type === "road" || a.type === "ship"
        ? buildProgressRoad(t, p, a.id!, a.type)
        : finishProgressRoads(t, p),
    );
    g.freeRoads = g.cities!.freeRoutes?.remaining ?? 0;
    if (!g.freeRoads) g.phase = "action";
    if (a.type === "road" || a.type === "ship") hooks.discoverFog(g, p, a.id!);
    hooks.awards(g);
    hooks.checkWin(g);
    return true;
  }
  if (
    a.type === "buyDev" ||
    ["knight", "plenty", "monopoly", "roadBuilding"].includes(a.type)
  )
    throw new Error(
      "Cities & Defenders uses progress cards, not development cards.",
    );
  if (a.type === "roll") {
    rollCities(g, p, hooks, rng);
    return true;
  }
  if (a.type === "progress") {
    rule(
      p === g.active && ["roll", "action"].includes(g.phase),
      "Play progress cards on your own normal turn.",
    );
    const phase = g.phase as "roll" | "action";
    const result = run(g, (t) =>
      playProgress(
        t,
        p,
        a.cardId!,
        a as ProgressArgs,
        {
          phase,
          points: g.players.map((_, i) => hooks.points(g, i, false)),
          legalRobberTiles: hooks.legalRobberTiles(g),
        },
        rng,
      ),
    );
    appendLog(
      g,
      `${g.players[p].name} played ${result.kind}${["resourceMonopoly", "commodityMonopoly"].includes(result.kind) && a.good ? `, choosing ${a.good}` : ""}.`,
    );
    if (result.forcedDice) rollCities(g, p, hooks, rng, result.forcedDice);
    else if (result.freeRoads) {
      g.freeRoads = result.freeRoads;
      g.phase = "roadBuilding";
      g.resume = "action";
    } else {
      g.citiesFlow = { kind: "resume", phase: "action" };
      finishFlow(g, hooks);
    }
    return true;
  }
  if (a.type === "end") {
    rule(
      g.phase === "action" && p === g.active,
      "Finish the current action before ending your turn.",
    );
    run(g, (t) => queueProgressLimit(t, p, true));
    g.citiesFlow = { kind: "end" };
    finishFlow(g, hooks);
    return true;
  }
  const building = [
    "placeKnight",
    "activateKnight",
    "promoteKnight",
    "wall",
    "improve",
    "city",
  ].includes(a.type);
  const moving = [
    "moveKnight",
    "displaceKnight",
    "chaseRobber",
    "chasePirate",
    "harborExchange",
    "finishHarbor",
  ].includes(a.type);
  if (!building && !moving) return false;
  rule(
    p === (g.phase === "special" ? g.specialPlayer : g.active) &&
      (moving ? g.phase === "action" : ["action", "special"].includes(g.phase)),
    moving
      ? "Knight actions and card abilities require your normal turn after rolling."
      : "Build on your normal or special building phase.",
  );
  const phase = g.phase as "action" | "special";
  if (a.type === "placeKnight") run(g, (t) => placeKnight(t, p, a.id!));
  else if (a.type === "activateKnight")
    run(g, (t) => activateKnight(t, p, a.id!));
  else if (a.type === "promoteKnight")
    run(g, (t) => promoteKnight(t, p, a.id!));
  else if (a.type === "moveKnight")
    run(g, (t) => moveKnight(t, p, a.id!, a.to!));
  else if (a.type === "displaceKnight")
    run(g, (t) => displaceKnight(t, p, a.id!, a.to!));
  else if (a.type === "chaseRobber") {
    rule(
      hooks.legalRobberTiles(g).length,
      "No legal destination is available for the robber.",
    );
    run(g, (t) => chaseRobber(t, p, a.id!));
    hooks.beginRobber(g, "action", "robber");
    return true;
  } else if (a.type === "chasePirate") {
    rule(
      hooks.legalPirateTiles(g).length,
      "No legal destination is available for the pirate.",
    );
    run(g, (t) => chasePirate(t, p, a.id!));
    hooks.beginRobber(g, "action", "pirate");
    return true;
  } else if (a.type === "wall") run(g, (t) => buildCityWall(t, p, a.id!));
  else if (a.type === "improve") run(g, (t) => improveCity(t, p, a.track!));
  else if (a.type === "city") run(g, (t) => upgradeCitiesCity(t, p, a.id!));
  else if (a.type === "harborExchange")
    run(g, (t) => beginHarborExchange(t, p, a.cardId!, a.to!, a.resource!));
  else if (a.type === "finishHarbor")
    run(g, (t) => finishHarbor(t, p, a.cardId!));
  appendLog(g, `${g.players[p].name} used ${a.type}.`);
  g.citiesFlow = { kind: "resume", phase };
  finishFlow(g, hooks);
  return true;
}
// Required-choice timeout fallback; does not select strategic actions on a turn.
export function citiesTimeoutChoice(g: Game, rng = secureRandom): Action {
  const t = citiesTable(g),
    c = t.cities.choices[0];
  rule(c, "No expansion choice is pending.");
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(rng() * items.length)];
  const move: Action = { type: "citiesChoice" };
  if (
    ["pillage", "metropolis", "relocateKnight", "deserterPlace"].includes(
      c.kind,
    )
  )
    move.vertex = pick((c as { vertices: number[] }).vertices);
  else if (c.kind === "deserter")
    move.vertex = pick(
      t.cities.knights.filter((k) => k.owner === c.player),
    ).vertex;
  else if (c.kind === "relocateRoad") move.edge = null;
  else if (c.kind === "defenderProgress")
    move.track = pick(TRACKS.filter((track) => t.cities.decks[track].length));
  else if (c.kind === "discardProgress")
    move.cardId = pick(t.cities.players[c.player].progress).id;
  else if (c.kind === "spy")
    move.cardId = pick(t.cities.players[c.from].progress).id;
  else if (c.kind === "aqueduct")
    move.resource = pick(RESOURCES.filter((r) => t.bank[r] > 0));
  else if (c.kind === "harborExchange")
    move.good = pick(
      (["paper", "cloth", "coin"] as const).filter(
        (r) => t.players[c.player].hand[r] > 0,
      ),
    );
  else if (
    c.kind === "masterMerchant" ||
    c.kind === "wedding" ||
    c.kind === "saboteur"
  ) {
    const hand =
        t.players[c.kind === "masterMerchant" ? c.from : c.player].hand,
      chosen = citiesHand();
    const bag = GOODS.flatMap((r) => Array(hand[r]).fill(r) as Good[]);
    for (let i = 0; i < c.count; i++)
      chosen[bag.splice(Math.floor(rng() * bag.length), 1)[0]]++;
    move.resources = chosen;
  } else throw new Error("Unknown Cities & Defenders choice.");
  return move;
}
export function citiesLegal(g: Game, p: number) {
  const t = citiesTable(g),
    own = t.cities.knights.filter((k) => k.owner === p);
  const build =
    p === (g.phase === "special" ? g.specialPlayer : g.active) &&
    ["action", "special"].includes(g.phase);
  const action = p === g.active && g.phase === "action";
  const mobile = action
    ? own.filter((k) => k.active && k.activatedAt < t.turn)
    : [];
  return {
    knight: build ? legalKnightPlacements(t, p) : [],
    activate: build ? own.filter((k) => !k.active).map((k) => k.vertex) : [],
    promote: build
      ? own.filter((k) => canPromoteKnight(t, p, k)).map((k) => k.vertex)
      : [],
    moves: Object.fromEntries(
      mobile.map((k) => [k.vertex, legalKnightMoves(t, p, k.vertex)]),
    ),
    displacements: Object.fromEntries(
      mobile.map((k) => [k.vertex, legalKnightDisplacements(t, p, k.vertex)]),
    ),
    chase: robberEnabled(t)
      ? mobile
          .filter((k) =>
            g.board.tiles[g.board.robber].vertices.includes(k.vertex),
          )
          .map((k) => k.vertex)
      : [],
    pirateChase:
      t.seafarers && robberEnabled(t) && g.board.pirate != null
        ? mobile
            .filter((k) =>
              g.board.tiles[g.board.pirate!].vertices.includes(k.vertex),
            )
            .map((k) => k.vertex)
        : [],
    walls: build ? legalCityWalls(t, p) : [],
  };
}
