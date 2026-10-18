import { legalRoutes, movableShips, keepsKnightConnections } from "./seafarers";
import { RESOURCES, Resource, secureRandom } from "./board";
import { seatsAfter } from "./turn-order";
import {
  BoardKnight,
  CitiesHand,
  CitiesTable,
  CityTrack,
  Commodity,
  COMMODITIES,
  GOODS,
  Good,
  ProgressKind,
  TRACKS,
  buildCityWall,
  citiesBonus,
  citiesHand,
  cleanCitiesHand,
  goodsTotal,
  improveCity,
  knightAt,
  legalKnightMoves,
  legalKnightPlacements,
  promoteKnight,
  queueProgressLimit,
  returnProgress,
  robberEnabled,
  upgradeCitiesCity,
  citiesRoadBlocked,
} from "./cities-knights";

export type ProgressChoice =
  | { kind: "masterMerchant"; player: number; from: number; count: number }
  | { kind: "spy"; player: number; from: number }
  | { kind: "wedding"; player: number; to: number; count: number }
  | { kind: "saboteur"; player: number; count: number }
  | { kind: "deserter"; player: number; to: number }
  | {
      kind: "deserterPlace";
      player: number;
      knight: BoardKnight;
      vertices: number[];
    }
  | {
      kind: "relocateRoad";
      player: number;
      edges: number[];
      routeKind?: "road" | "ship";
    }
  | { kind: "harborExchange"; player: number; to: number; resource: Resource };
export type ProgressArgs = {
  vertex?: number;
  edge?: number;
  tile?: number;
  tiles?: number[];
  knights?: number[];
  track?: CityTrack;
  good?: Good;
  target?: number;
  dice?: number[];
};
// Values in this context are derived by the authoritative room adapter, never
// copied from a user's move. They include Longest Road and any friendly-robber
// restrictions imposed by the room's rules.
export type ProgressContext = {
  phase: "roll" | "action";
  points?: number[];
  legalRobberTiles?: number[];
};
export type ProgressResult = {
  kind: ProgressKind;
  forcedDice?: [number, number];
  freeRoads?: number;
  deferRoadAward?: boolean;
};
function rule(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function validSeat(t: CitiesTable, p: number) {
  return Number.isInteger(p) && p >= 0 && p < t.players.length;
}
function ownTurn(t: CitiesTable, p: number) {
  rule(
    validSeat(t, p) && p === t.active,
    "Use progress cards on your own normal turn.",
  );
  rule(!t.cities.choices.length, "Resolve the pending choice first.");
  rule(!t.cities.freeRoutes, "Finish your free roads first.");
}
function points(t: CitiesTable, context: ProgressContext) {
  if (context.points) {
    rule(
      context.points.length === t.players.length &&
        context.points.every((n) => Number.isInteger(n) && n >= 0),
      "Use the authoritative public scores.",
    );
    return context.points;
  }
  return t.players.map(
    (_, p) =>
      t.board.vertices
        .filter((v) => v.owner === p)
        .reduce((n, v) => n + (v.city ? 2 : 1), 0) + citiesBonus(t, p),
  );
}
function opponent(t: CitiesTable, p: number, target: number | undefined) {
  rule(
    target !== undefined && validSeat(t, target) && target !== p,
    "Choose another player.",
  );
  return target;
}
function transfer(t: CitiesTable, from: number, to: number, hand: CitiesHand) {
  rule(
    GOODS.every((r) => hand[r] <= t.players[from].hand[r]),
    "Those cards are no longer in that player's hand.",
  );
  for (const r of GOODS) {
    t.players[from].hand[r] -= hand[r];
    t.players[to].hand[r] += hand[r];
  }
}
function clockwise(t: CitiesTable, p: number) {
  return seatsAfter(t, p);
}
export function progressRoadChoices(t: CitiesTable, p: number) {
  if (
    t.board.edges.filter((e) => e.owner === p && e.kind !== "ship").length >= 15
  )
    return [];
  if (t.seafarers)
    return legalRoutes(t.board, p, "road", null, undefined, (id) =>
      citiesRoadBlocked(t, id, p),
    );
  return t.board.edges
    .filter(
      (e) =>
        e.owner === null &&
        e.tiles.some((id) => t.board.tiles[id].resource !== "sea") &&
        [e.a, e.b].some((id) => {
          if (citiesRoadBlocked(t, id, p)) return false;
          const v = t.board.vertices[id];
          return (
            v.owner === p ||
            v.edges.some(
              (edge) =>
                t.board.edges[edge].owner === p &&
                t.board.edges[edge].kind !== "ship",
            )
          );
        }),
    )
    .map((e) => e.id);
}
export function progressShipChoices(t: CitiesTable, p: number) {
  if (
    !t.seafarers ||
    t.board.edges.filter((e) => e.owner === p && e.kind === "ship").length >= 15
  )
    return [];
  return legalRoutes(t.board, p, "ship", null, undefined, (id) =>
    citiesRoadBlocked(t, id, p),
  );
}
export function openDiplomatRoads(
  t: Pick<CitiesTable, "board" | "seafarers"> & {
    cities: Pick<CitiesTable["cities"], "knights">;
  },
) {
  return t.board.edges
    .filter((e) => {
      if (e.owner === null) return false;
      const owner = e.owner;
      const knights = t.cities.knights
        .filter((k) => k.owner === owner)
        .map((k) => k.vertex);
      if (t.seafarers && !keepsKnightConnections(t.board, owner, knights, e.id))
        return false;
      if (e.kind === "ship")
        return (
          !!t.seafarers &&
          movableShips(t.board, owner, -1, knights, true).includes(e.id)
        );
      // An opponent's interruption never turns the two neighboring road pieces
      // into open ends. Connectivity here uses roads of the road owner's color.
      const ownedOther = (id: number) =>
        t.board.vertices[id].edges.filter(
          (edge) =>
            edge !== e.id &&
            t.board.edges[edge].owner === owner &&
            t.board.edges[edge].kind !== "ship",
        );
      if (
        [e.a, e.b].some(
          (id) => knightAt(t, id)?.owner === owner && !ownedOther(id).length,
        )
      )
        return false;
      return [e.a, e.b].some(
        (id) =>
          t.board.vertices[id].owner !== owner &&
          knightAt(t, id)?.owner !== owner &&
          !ownedOther(id).length,
      );
    })
    .map((e) => e.id);
}
function playEffect(
  t: CitiesTable,
  p: number,
  kind: ProgressKind,
  cardId: number,
  a: ProgressArgs,
  context: ProgressContext,
  rng: () => number,
): ProgressResult {
  const result: ProgressResult = { kind };
  if (kind === "alchemist") {
    rule(
      context.phase === "roll" &&
        a.dice?.length === 2 &&
        a.dice.every((n) => Number.isInteger(n) && n >= 1 && n <= 6),
      "Choose the ordinary and red die before rolling.",
    );
    result.forcedDice = [a.dice[0], a.dice[1]];
    return result; // The adapter must roll the event die and resolve it first.
  }
  rule(context.phase === "action", "Play this card after resolving the dice.");
  if (kind === "crane") {
    rule(a.track && TRACKS.includes(a.track), "Choose an improvement track.");
    improveCity(t, p, a.track, true);
  } else if (kind === "engineer") buildCityWall(t, p, a.vertex!, true);
  else if (kind === "medicine") upgradeCitiesCity(t, p, a.vertex!, true);
  else if (kind === "inventor") {
    rule(
      a.tiles?.length === 2 &&
        a.tiles[0] !== a.tiles[1] &&
        a.tiles.every(
          (id) =>
            Number.isInteger(id) &&
            t.board.tiles[id] &&
            !t.board.tiles[id].fog &&
            [3, 4, 5, 9, 10, 11].includes(t.board.tiles[id].number),
        ),
      "Swap two number tokens other than 2, 6, 8 or 12.",
    );
    const [first, second] = a.tiles.map((id) => t.board.tiles[id]);
    [first.number, second.number] = [second.number, first.number];
  } else if (kind === "irrigation" || kind === "mining") {
    const r = kind === "irrigation" ? "wheat" : "ore";
    const tiles = t.board.tiles.filter(
      (tile) =>
        tile.resource === r &&
        tile.vertices.some((id) => t.board.vertices[id].owner === p),
    );
    rule(
      tiles.length,
      "You need a settlement or city touching a matching terrain.",
    );
    const amount = Math.min(t.bank[r], 2 * tiles.length);
    t.bank[r] -= amount;
    t.players[p].hand[r] += amount;
  } else if (kind === "roadBuilding") {
    rule(
      progressRoadChoices(t, p).length || progressShipChoices(t, p).length,
      "You have no available road or ship placement or pieces.",
    );
    t.cities.freeRoutes = { owner: p, turn: t.turn, remaining: 2 };
    result.freeRoads = 2;
  } else if (kind === "smith") {
    rule(
      a.knights &&
        a.knights.length >= 1 &&
        a.knights.length <= 2 &&
        new Set(a.knights).size === a.knights.length,
      "Choose one or two different knights to promote.",
    );
    for (const vertex of a.knights) promoteKnight(t, p, vertex, true);
  } else if (kind === "merchant") {
    const tile = t.board.tiles[a.tile!];
    rule(
      tile &&
        tile.resource !== "sea" &&
        tile.resource !== "gold" &&
        !tile.fog &&
        tile.vertices.some((id) => t.board.vertices[id].owner === p),
      "Place the Merchant on land other than gold, touching one of your settlements or cities.",
    );
    t.cities.merchant = { owner: p, tile: tile.id };
  } else if (kind === "merchantFleet") {
    rule(
      GOODS.includes(a.good!),
      "Choose a resource or commodity for the Fleet.",
    );
    t.cities.merchantFleets ??= [];
    t.cities.merchantFleets.push({ owner: p, good: a.good!, turn: t.turn });
  } else if (kind === "resourceMonopoly" || kind === "commodityMonopoly") {
    rule(
      (kind === "resourceMonopoly" ? RESOURCES : COMMODITIES).includes(
        a.good! as never,
      ),
      "Choose a card type matching this monopoly.",
    );
    for (const from of clockwise(t, p)) {
      const hand = citiesHand();
      hand[a.good!] = Math.min(
        t.players[from].hand[a.good!],
        kind === "resourceMonopoly" ? 2 : 1,
      );
      transfer(t, from, p, hand);
    }
  } else if (kind === "commercialHarbor") {
    rule(
      RESOURCES.some((r) => t.players[p].hand[r] > 0),
      "You need a resource to offer at the Commercial Harbor.",
    );
    t.cities.harbors ??= [];
    t.cities.harbors.push({
      id: cardId,
      owner: p,
      turn: t.turn,
      remaining: clockwise(t, p),
    });
  } else if (kind === "masterMerchant") {
    const from = opponent(t, p, a.target),
      score = points(t, context),
      count = Math.min(2, goodsTotal(t.players[from].hand));
    rule(
      score[from] > score[p] && count > 0,
      "Choose a player with more points and cards in hand.",
    );
    t.cities.choices.push({ kind: "masterMerchant", player: p, from, count });
  } else if (kind === "bishop") {
    rule(
      robberEnabled(t),
      "The robber stays put until the first barbarian attack.",
    );
    const tile = t.board.tiles[a.tile!];
    rule(
      tile &&
        tile.id !== t.board.robber &&
        tile.resource !== "sea" &&
        !tile.fog &&
        (!context.legalRobberTiles ||
          context.legalRobberTiles.includes(tile.id)),
      "Choose another legal robber tile.",
    );
    t.board.robber = tile.id;
    const victims = new Set(
      tile.vertices
        .map((id) => t.board.vertices[id].owner)
        .filter((owner) => owner !== null && owner !== p),
    );
    for (const from of clockwise(t, p).filter((i) => victims.has(i))) {
      const bag = GOODS.flatMap(
        (r) => Array(t.players[from].hand[r]).fill(r) as Good[],
      );
      if (!bag.length) continue;
      const good = bag[Math.floor(rng() * bag.length)];
      t.players[from].hand[good]--;
      t.players[p].hand[good]++;
    }
  } else if (kind === "deserter") {
    const from = opponent(t, p, a.target);
    rule(
      t.cities.knights.some((k) => k.owner === from),
      "Choose a player with a knight on the board.",
    );
    t.cities.choices.push({ kind: "deserter", player: from, to: p });
  } else if (kind === "diplomat") {
    rule(
      openDiplomatRoads(t).includes(a.edge!),
      "Choose an open road without stranding its owner's knight.",
    );
    const e = t.board.edges[a.edge!],
      owner = e.owner,
      routeKind = e.kind === "ship" ? "ship" : "road";
    e.owner = null;
    delete e.kind;
    delete e.built;
    if (owner === p) {
      const edges =
        routeKind === "ship"
          ? progressShipChoices(t, p)
          : progressRoadChoices(t, p);
      if (edges.length) {
        t.cities.choices.push({
          kind: "relocateRoad",
          player: p,
          edges,
          routeKind,
        });
        result.deferRoadAward = true;
      }
    }
  } else if (kind === "intrigue") {
    const victim = knightAt(t, a.vertex!);
    rule(
      victim &&
        victim.owner !== p &&
        t.board.vertices[victim.vertex].edges.some(
          (id) =>
            t.board.edges[id].owner === p &&
            (t.seafarers || t.board.edges[id].kind !== "ship"),
        ),
      "Choose an opposing knight touching one of your roads.",
    );
    const old = { ...victim };
    t.cities.knights = t.cities.knights.filter((k) => k !== victim);
    const vertices = legalKnightMoves(t, old.owner, old.vertex);
    if (vertices.length)
      t.cities.choices.push({
        kind: "relocateKnight",
        player: old.owner,
        knight: old,
        vertices,
      });
  } else if (kind === "saboteur" || kind === "wedding") {
    const score = points(t, context),
      affected = clockwise(t, p).filter((from) =>
        kind === "saboteur" ? score[from] >= score[p] : score[from] > score[p],
      );
    const choices: ProgressChoice[] = affected.flatMap((from) => {
      const count =
        kind === "saboteur"
          ? Math.floor(goodsTotal(t.players[from].hand) / 2)
          : Math.min(2, goodsTotal(t.players[from].hand));
      return count
        ? [
            kind === "saboteur"
              ? { kind, player: from, count }
              : { kind, player: from, to: p, count },
          ]
        : [];
    });
    rule(
      choices.length,
      "No opponent owes cards under this card's point rule.",
    );
    t.cities.choices.push(...choices);
  } else if (kind === "spy") {
    const from = opponent(t, p, a.target);
    rule(
      t.cities.players[from].progress.length > 0,
      "Choose a player holding progress cards.",
    );
    t.cities.choices.push({ kind: "spy", player: p, from });
  } else if (kind === "warlord") {
    const inactive = t.cities.knights.filter((k) => k.owner === p && !k.active);
    rule(inactive.length, "You have no inactive knights to activate.");
    for (const k of inactive) {
      k.active = true;
      k.activatedAt = t.turn;
    }
  } else
    throw new Error("Victory progress cards reveal automatically when drawn.");
  return result;
}
// Validate and commit the whole effect as one operation. This also protects
// multi-knight Smith upgrades and effects that create private/foreign choices.
export function playProgress(
  t: CitiesTable,
  p: number,
  cardId: number,
  args: ProgressArgs,
  context: ProgressContext,
  rng = secureRandom,
) {
  ownTurn(t, p);
  const card = t.cities.players[p].progress.find((c) => c.id === cardId);
  rule(card, "Choose a progress card in your hand.");
  const draft = structuredClone(t);
  const result = playEffect(draft, p, card.kind, card.id, args, context, rng);
  returnProgress(draft, p, cardId);
  Object.assign(t, draft);
  return result;
}
export function buildProgressRoad(
  t: CitiesTable,
  p: number,
  edge: number,
  kind: "road" | "ship" = "road",
) {
  const routes = t.cities.freeRoutes;
  rule(
    !t.cities.choices.length &&
      p === t.active &&
      routes?.owner === p &&
      routes.turn === t.turn &&
      routes.remaining > 0,
    "You do not have pending free roads.",
  );
  rule(
    (kind === "ship"
      ? progressShipChoices(t, p)
      : progressRoadChoices(t, p)
    ).includes(edge),
    "Choose an available road connected to your network.",
  );
  Object.assign(t.board.edges[edge], { owner: p, kind, built: t.turn });
  routes.remaining--;
  if (
    !routes.remaining ||
    !(progressRoadChoices(t, p).length || progressShipChoices(t, p).length)
  )
    t.cities.freeRoutes = null;
}
export function finishProgressRoads(t: CitiesTable, p: number) {
  rule(
    t.cities.freeRoutes?.owner === p && p === t.active,
    "Only the free-road owner can finish this placement.",
  );
  rule(
    !progressRoadChoices(t, p).length && !progressShipChoices(t, p).length,
    "Place your remaining free routes before continuing.",
  );
  t.cities.freeRoutes = null;
}
export function beginHarborExchange(
  t: CitiesTable,
  p: number,
  harborId: number,
  target: number,
  resource: Resource,
) {
  ownTurn(t, p);
  const harbor = t.cities.harbors?.find(
    (h) => h.id === harborId && h.owner === p && h.turn === t.turn,
  );
  rule(
    harbor &&
      harbor.remaining.includes(target) &&
      validSeat(t, target) &&
      target !== p,
    "This player has already used this Harbor exchange, or the ability expired.",
  );
  rule(
    RESOURCES.includes(resource) && t.players[p].hand[resource] > 0,
    "Offer one of your resource cards, not a commodity.",
  );
  harbor.remaining = harbor.remaining.filter((i) => i !== target);
  if (COMMODITIES.some((r) => t.players[target].hand[r] > 0))
    t.cities.choices.push({
      kind: "harborExchange",
      player: target,
      to: p,
      resource,
    });
  // No commodity means no exchange; the offerer's resource stays in hand.
}
export function finishHarbor(t: CitiesTable, p: number, harborId: number) {
  ownTurn(t, p);
  rule(
    t.cities.harbors?.some(
      (h) => h.id === harborId && h.owner === p && h.turn === t.turn,
    ),
    "This Harbor ability is unavailable.",
  );
  t.cities.harbors = t.cities.harbors.filter((h) => h.id !== harborId);
}
export function endCitiesEffects(t: CitiesTable) {
  rule(
    !t.cities.choices.length && !t.cities.freeRoutes,
    "Resolve all pending card choices before ending the turn.",
  );
  t.cities.harbors = [];
  t.cities.merchantFleet = null;
  t.cities.merchantFleets = [];
}
export type ProgressAnswer = {
  resources?: unknown;
  cardId?: number;
  vertex?: number | null;
  edge?: number | null;
  commodity?: Commodity;
};
export function isProgressChoice(kind: string) {
  return [
    "masterMerchant",
    "spy",
    "wedding",
    "saboteur",
    "deserter",
    "deserterPlace",
    "relocateRoad",
    "harborExchange",
  ].includes(kind);
}
export function resolveProgressChoice(
  t: CitiesTable,
  p: number,
  answer: ProgressAnswer,
) {
  const choice = t.cities.choices[0];
  rule(
    choice && choice.player === p && isProgressChoice(choice.kind),
    "Choose your own pending progress-card response.",
  );
  const draft = structuredClone(t);
  draft.cities.choices.shift();
  if (
    choice.kind === "masterMerchant" ||
    choice.kind === "wedding" ||
    choice.kind === "saboteur"
  ) {
    const hand = cleanCitiesHand(answer.resources);
    rule(
      goodsTotal(hand) === choice.count,
      `Choose exactly ${choice.count} cards.`,
    );
    if (choice.kind === "masterMerchant") transfer(draft, choice.from, p, hand);
    else if (choice.kind === "wedding") transfer(draft, p, choice.to, hand);
    else {
      rule(
        GOODS.every((r) => hand[r] <= draft.players[p].hand[r]),
        "You do not have those cards to discard.",
      );
      for (const r of GOODS) {
        draft.players[p].hand[r] -= hand[r];
        draft.bank[r] += hand[r];
      }
    }
  } else if (choice.kind === "spy") {
    const victim = draft.cities.players[choice.from],
      at = victim.progress.findIndex((c) => c.id === answer.cardId);
    rule(
      at >= 0,
      "Choose one of the revealed progress cards, not a victory card.",
    );
    draft.cities.players[p].progress.push(victim.progress.splice(at, 1)[0]);
    queueProgressLimit(draft, p);
  } else if (choice.kind === "deserter") {
    const victim = knightAt(draft, answer.vertex!);
    rule(victim && victim.owner === p, "Choose one of your knights to desert.");
    const old = { ...victim };
    draft.cities.knights = draft.cities.knights.filter((k) => k !== victim);
    let level = old.level;
    if (
      draft.cities.knights.filter(
        (k) => k.owner === choice.to && k.level === level,
      ).length >= 2
    )
      level = 1;
    const vertices = legalKnightPlacements(draft, choice.to, level);
    if (vertices.length)
      draft.cities.choices.unshift({
        kind: "deserterPlace",
        player: choice.to,
        knight: {
          owner: choice.to,
          vertex: -1,
          level,
          active: old.active,
          activatedAt: old.active ? draft.turn - 1 : -1,
          upgradedAt: -1,
        },
        vertices,
      });
  } else if (choice.kind === "deserterPlace") {
    if (answer.vertex !== null) {
      rule(
        choice.vertices.includes(answer.vertex!) &&
          legalKnightPlacements(draft, p, choice.knight.level).includes(
            answer.vertex!,
          ),
        "Choose an available knight placement or skip placement.",
      );
      draft.cities.knights.push({ ...choice.knight, vertex: answer.vertex! });
    }
  } else if (choice.kind === "relocateRoad") {
    if (answer.edge !== null) {
      rule(
        choice.edges.includes(answer.edge!) &&
          (choice.routeKind === "ship"
            ? progressShipChoices(draft, p)
            : progressRoadChoices(draft, p)
          ).includes(answer.edge!),
        "Choose a legal replacement road or skip replacement.",
      );
      Object.assign(draft.board.edges[answer.edge!], {
        owner: p,
        kind: choice.routeKind ?? "road",
        built: draft.turn,
      });
    }
  } else if (choice.kind === "harborExchange") {
    rule(
      COMMODITIES.includes(answer.commodity!) &&
        draft.players[p].hand[answer.commodity!] > 0 &&
        draft.players[choice.to].hand[choice.resource] > 0,
      "Choose a commodity you own to exchange for the offered resource.",
    );
    draft.players[p].hand[answer.commodity!]--;
    draft.players[choice.to].hand[answer.commodity!]++;
    draft.players[choice.to].hand[choice.resource]--;
    draft.players[p].hand[choice.resource]++;
  } else
    throw new Error(
      "This choice uses the regular Cities & Defenders controls.",
    );
  Object.assign(t, draft);
}
