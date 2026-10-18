// Cities & Defenders rules core. The room adapter will expose this only once the
// complete progress-card flow and human controls are implemented and verified.
import { Board, RESOURCES, Resource, secureRandom, shuffle } from "./board";
import type { ProgressChoice } from "./cities-progress";
import { seatsAfter } from "./turn-order";

export const COMMODITIES = ["paper", "cloth", "coin"] as const;
export type Commodity = (typeof COMMODITIES)[number];
export const GOODS = [...RESOURCES, ...COMMODITIES] as const;
export type Good = (typeof GOODS)[number];
export type CitiesHand = Record<Good, number>;
export const citiesHand = (): CitiesHand => ({
  wood: 0,
  brick: 0,
  sheep: 0,
  wheat: 0,
  ore: 0,
  paper: 0,
  cloth: 0,
  coin: 0,
});
export const TRACKS = ["science", "trade", "politics"] as const;
export type CityTrack = (typeof TRACKS)[number];
export const TRACK_COMMODITY: Record<CityTrack, Commodity> = {
  science: "paper",
  trade: "cloth",
  politics: "coin",
};
export const CITY_COMMODITY: Partial<Record<Resource, Commodity>> = {
  wood: "paper",
  sheep: "cloth",
  ore: "coin",
};

export const PROGRESS_COUNTS = {
  science: {
    alchemist: 2,
    crane: 2,
    engineer: 1,
    inventor: 2,
    irrigation: 2,
    medicine: 2,
    mining: 2,
    printer: 1,
    roadBuilding: 2,
    smith: 2,
  },
  trade: {
    commercialHarbor: 2,
    masterMerchant: 2,
    merchantFleet: 2,
    merchant: 6,
    resourceMonopoly: 4,
    commodityMonopoly: 2,
  },
  politics: {
    bishop: 2,
    constitution: 1,
    deserter: 2,
    diplomat: 2,
    intrigue: 2,
    saboteur: 2,
    spy: 3,
    warlord: 2,
    wedding: 2,
  },
} as const;
export type ProgressKind =
  | keyof typeof PROGRESS_COUNTS.science
  | keyof typeof PROGRESS_COUNTS.trade
  | keyof typeof PROGRESS_COUNTS.politics;
export type ProgressCard = { id: number; kind: ProgressKind; track: CityTrack };
export type BoardKnight = {
  owner: number;
  vertex: number;
  level: 1 | 2 | 3;
  active: boolean;
  activatedAt: number;
  upgradedAt: number;
};
export type Metropolis = { owner: number; vertex: number };
export type CoreCitiesChoice =
  | { kind: "pillage"; player: number; vertices: number[] }
  | { kind: "defenderProgress"; player: number }
  | { kind: "discardProgress"; player: number; limit: 4 | 5 }
  | { kind: "aqueduct"; player: number }
  | { kind: "metropolis"; player: number; track: CityTrack; vertices: number[] }
  | {
      kind: "relocateKnight";
      player: number;
      knight: BoardKnight;
      vertices: number[];
    };
export type CitiesChoice = CoreCitiesChoice | ProgressChoice;
export type PublicCitiesChoice =
  | CoreCitiesChoice
  | Exclude<ProgressChoice, { kind: "harborExchange" }>
  | (Omit<Extract<ProgressChoice, { kind: "harborExchange" }>, "resource"> & {
      resource?: Resource;
    });
export type CitiesPlayer = {
  improvements: Record<CityTrack, number>;
  progress: ProgressCard[];
  revealed: ProgressCard[];
  defenders: number;
  demotedCities: number[];
};
export type CitiesState = {
  players: CitiesPlayer[];
  knights: BoardKnight[];
  walls: number[];
  metropolises: Record<CityTrack, Metropolis | null>;
  barbarianPosition: number;
  attacks: number;
  event: "barbarian" | CityTrack | null;
  decks: Record<CityTrack, ProgressCard[]>;
  choices: CitiesChoice[];
  merchant: { owner: number; tile: number } | null;
  merchantFleet: { owner: number; good: Good; turn: number } | null;
  merchantFleets: { owner: number; good: Good; turn: number }[];
  harbors: { id: number; owner: number; turn: number; remaining: number[] }[];
  freeRoutes: { owner: number; turn: number; remaining: number } | null;
};
export type CitiesTable = {
  turnOrder?: number[];
  seafarers?: boolean;
  board: Board;
  players: { hand: CitiesHand }[];
  bank: CitiesHand;
  active: number;
  turn: number;
  cities: CitiesState;
};
function rule(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function seat(t: CitiesTable, p: number) {
  rule(
    Number.isInteger(p) &&
      p >= 0 &&
      p < t.players.length &&
      t.cities.players[p],
    "Choose a seated player.",
  );
}
export function goodsTotal(hand: CitiesHand) {
  return GOODS.reduce((n, r) => n + hand[r], 0);
}
export function cleanCitiesHand(value: unknown): CitiesHand {
  rule(
    value && typeof value === "object" && !Array.isArray(value),
    "Choose resource and commodity counts.",
  );
  const h = citiesHand();
  for (const [key, count] of Object.entries(value)) {
    rule(
      GOODS.includes(key as Good) &&
        Number.isInteger(count) &&
        count >= 0 &&
        count <= 100,
      "Invalid resource or commodity count.",
    );
    h[key as Good] = count;
  }
  return h;
}
function pay(t: CitiesTable, p: number, cost: Partial<CitiesHand>) {
  seat(t, p);
  rule(
    GOODS.every((r) => t.players[p].hand[r] >= (cost[r] ?? 0)),
    "You do not have the required cards.",
  );
  for (const r of GOODS) {
    const n = cost[r] ?? 0;
    t.players[p].hand[r] -= n;
    t.bank[r] += n;
  }
}
export function createCitiesState(
  players: number,
  rng = secureRandom,
): CitiesState {
  rule(
    Number.isInteger(players) && players >= 3 && players <= 6,
    "Cities & Defenders core supports 3–6 players.",
  );
  let id = 0;
  const decks = Object.fromEntries(
    TRACKS.map((track) => [
      track,
      shuffle(
        Object.entries(PROGRESS_COUNTS[track]).flatMap(([kind, count]) =>
          Array.from({ length: count }, () => ({
            id: ++id,
            kind: kind as ProgressKind,
            track,
          })),
        ),
        rng,
      ),
    ]),
  ) as Record<CityTrack, ProgressCard[]>;
  return {
    players: Array.from({ length: players }, () => ({
      improvements: { science: 0, trade: 0, politics: 0 },
      progress: [],
      revealed: [],
      defenders: 0,
      demotedCities: [],
    })),
    knights: [],
    walls: [],
    metropolises: { science: null, trade: null, politics: null },
    barbarianPosition: 0,
    attacks: 0,
    event: null,
    decks,
    choices: [],
    merchant: null,
    merchantFleet: null,
    merchantFleets: [],
    harbors: [],
    freeRoutes: null,
  };
}
export function citiesBank(players: number): CitiesHand {
  rule(
    Number.isInteger(players) && players >= 3 && players <= 6,
    "Choose 3–6 players.",
  );
  return Object.fromEntries(
    GOODS.map((r) => [
      r,
      COMMODITIES.includes(r as Commodity)
        ? players <= 4
          ? 12
          : 18
        : players <= 4
          ? 19
          : 24,
    ]),
  ) as CitiesHand;
}
export function metropolisAt(t: CitiesTable, vertex: number) {
  return TRACKS.find(
    (track) => t.cities.metropolises[track]?.vertex === vertex,
  );
}
export function knightAt(
  t: { cities: Pick<CitiesState, "knights"> },
  vertex: number,
) {
  return t.cities.knights.find((k) => k.vertex === vertex);
}
export function knightStrength(t: CitiesTable, p: number) {
  return t.cities.knights
    .filter((k) => k.owner === p && k.active)
    .reduce((n, k) => n + k.level, 0);
}
export function citiesBonus(t: CitiesTable, p: number) {
  seat(t, p);
  return (
    t.cities.players[p].defenders +
    t.cities.players[p].revealed.length +
    TRACKS.filter((track) => t.cities.metropolises[track]?.owner === p).length *
      2 +
    (t.cities.merchant?.owner === p ? 1 : 0)
  );
}
export function citiesDiscardLimit(t: CitiesTable, p: number, base = 7) {
  return (
    base +
    2 * t.cities.walls.filter((id) => t.board.vertices[id].owner === p).length
  );
}
export function robberEnabled(t: CitiesTable) {
  return t.cities.attacks > 0;
}
export function citiesRoadBlocked(t: CitiesTable, vertex: number, p: number) {
  const building = t.board.vertices[vertex].owner,
    knight = knightAt(t, vertex);
  return (
    (building !== null && building !== p) || !!(knight && knight.owner !== p)
  );
}
function ownsRoad(t: CitiesTable, edge: number, p: number) {
  const e = t.board.edges[edge];
  return e.owner === p && (t.seafarers || e.kind !== "ship");
}
function freeVertex(t: CitiesTable, vertex: number) {
  return t.board.vertices[vertex]?.owner === null && !knightAt(t, vertex);
}
function knightSupply(t: CitiesTable, p: number, level: number) {
  return (
    2 -
    t.cities.knights.filter((k) => k.owner === p && k.level === level).length
  );
}
export function legalKnightPlacements(t: CitiesTable, p: number, level = 1) {
  seat(t, p);
  if (knightSupply(t, p, level) <= 0) return [];
  return t.board.vertices
    .filter(
      (v) =>
        freeVertex(t, v.id) &&
        v.tiles.some((id) => t.board.tiles[id].resource !== "sea") &&
        v.edges.some((id) => ownsRoad(t, id, p)),
    )
    .map((v) => v.id);
}
export function placeKnight(t: CitiesTable, p: number, vertex: number) {
  rule(
    legalKnightPlacements(t, p).includes(vertex),
    "Place a knight on an empty intersection connected to your road.",
  );
  pay(t, p, { sheep: 1, ore: 1 });
  t.cities.knights.push({
    owner: p,
    vertex,
    level: 1,
    active: false,
    activatedAt: -1,
    upgradedAt: -1,
  });
}
function ownKnight(t: CitiesTable, p: number, vertex: number) {
  seat(t, p);
  const k = knightAt(t, vertex);
  rule(k && k.owner === p, "Choose one of your knights.");
  return k;
}
export function activateKnight(t: CitiesTable, p: number, vertex: number) {
  const k = ownKnight(t, p, vertex);
  rule(!k.active, "This knight is already active.");
  pay(t, p, { wheat: 1 });
  k.active = true;
  k.activatedAt = t.turn;
}
export function canPromoteKnight(t: CitiesTable, p: number, k: BoardKnight) {
  return (
    k.owner === p &&
    k.level < 3 &&
    k.upgradedAt !== t.turn &&
    knightSupply(t, p, k.level + 1) > 0 &&
    (k.level === 1 || t.cities.players[p].improvements.politics >= 3)
  );
}
export function promoteKnight(
  t: CitiesTable,
  p: number,
  vertex: number,
  free = false,
) {
  const k = ownKnight(t, p, vertex);
  rule(
    canPromoteKnight(t, p, k),
    "This knight cannot be promoted now; check supply, this turn's promotion and the Fortress.",
  );
  if (!free) pay(t, p, { sheep: 1, ore: 1 });
  k.level = (k.level + 1) as BoardKnight["level"];
  k.upgradedAt = t.turn;
}
function activeKnight(t: CitiesTable, p: number, vertex: number) {
  rule(p === t.active, "Knight actions are available on your own normal turn.");
  const k = ownKnight(t, p, vertex);
  rule(
    k.active && k.activatedAt < t.turn,
    "Use a knight activated before this turn.",
  );
  return k;
}
// Include an opposing occupied endpoint, but never continue through it. The
// origin may be occupied by the displacing knight while the victim relocates.
export function knightNetwork(t: CitiesTable, p: number, source: number) {
  seat(t, p);
  rule(!!t.board.vertices[source], "Choose an intersection.");
  const seen = new Set<number>([source]),
    pending = [source];
  while (pending.length) {
    const id = pending.pop()!;
    for (const edge of t.board.vertices[id].edges) {
      if (!ownsRoad(t, edge, p)) continue;
      const e = t.board.edges[edge],
        next = e.a === id ? e.b : e.a;
      if (seen.has(next)) continue;
      seen.add(next);
      if (!citiesRoadBlocked(t, next, p)) pending.push(next);
    }
  }
  return [...seen].filter((id) => id !== source);
}
export function legalKnightMoves(t: CitiesTable, p: number, source: number) {
  return knightNetwork(t, p, source).filter((id) => freeVertex(t, id));
}
export function moveKnight(
  t: CitiesTable,
  p: number,
  source: number,
  destination: number,
) {
  const k = activeKnight(t, p, source);
  rule(
    legalKnightMoves(t, p, source).includes(destination),
    "Move along your roads to an empty intersection.",
  );
  k.vertex = destination;
  k.active = false;
}
export function legalKnightDisplacements(
  t: CitiesTable,
  p: number,
  source: number,
) {
  const k = ownKnight(t, p, source);
  return knightNetwork(t, p, source).filter((id) => {
    const other = knightAt(t, id);
    return other && other.owner !== p && other.level < k.level;
  });
}
export function displaceKnight(
  t: CitiesTable,
  p: number,
  source: number,
  destination: number,
) {
  rule(!t.cities.choices.length, "Resolve the pending choice first.");
  const k = activeKnight(t, p, source);
  rule(
    legalKnightDisplacements(t, p, source).includes(destination),
    "Displace a weaker opposing knight connected by your roads.",
  );
  const victim = { ...knightAt(t, destination)! };
  t.cities.knights = t.cities.knights.filter((x) => x.vertex !== destination);
  k.vertex = destination;
  k.active = false;
  const vertices = legalKnightMoves(t, victim.owner, destination);
  if (vertices.length)
    t.cities.choices.push({
      kind: "relocateKnight",
      player: victim.owner,
      knight: victim,
      vertices,
    });
}
export function chaseRobber(t: CitiesTable, p: number, source: number) {
  const k = activeKnight(t, p, source);
  rule(
    robberEnabled(t),
    "The robber stays put until the first barbarian attack.",
  );
  rule(
    t.board.vertices[source].tiles.includes(t.board.robber),
    "This knight does not touch the robber's tile.",
  );
  k.active = false;
  // The room adapter now enters its ordinary robber/steal phase.
}
export function chasePirate(t: CitiesTable, p: number, source: number) {
  rule(
    t.seafarers && robberEnabled(t),
    "The pirate stays put until the first barbarian attack.",
  );
  const knight = activeKnight(t, p, source);
  rule(
    t.board.pirate != null &&
      t.board.tiles[t.board.pirate].vertices.includes(source),
    "Choose an active knight touching the pirate.",
  );
  knight.active = false;
}
export function legalCityWalls(t: CitiesTable, p: number) {
  if (
    t.cities.walls.filter((id) => t.board.vertices[id].owner === p).length >= 3
  )
    return [];
  return t.board.vertices
    .filter((v) => v.owner === p && v.city && !t.cities.walls.includes(v.id))
    .map((v) => v.id);
}
export function buildCityWall(
  t: CitiesTable,
  p: number,
  vertex: number,
  free = false,
) {
  seat(t, p);
  rule(
    legalCityWalls(t, p).includes(vertex),
    "Choose an unwalled city; you have three wall pieces.",
  );
  if (!free) pay(t, p, { brick: 2 });
  t.cities.walls.push(vertex);
}
export function legalCitiesUpgrades(t: CitiesTable, p: number) {
  seat(t, p);
  const vertices = t.board.vertices.filter((v) => v.owner === p && !v.city);
  if (t.board.vertices.filter((v) => v.owner === p && v.city).length >= 4)
    return [];
  return vertices
    .filter(
      (v) =>
        vertices.length <= 5 ||
        t.cities.players[p].demotedCities.includes(v.id),
    )
    .map((v) => v.id);
}
export function upgradeCitiesCity(
  t: CitiesTable,
  p: number,
  vertex: number,
  medicine = false,
) {
  rule(
    legalCitiesUpgrades(t, p).includes(vertex),
    "Rebuild a pillaged city first if your settlement supply is exhausted.",
  );
  pay(t, p, medicine ? { wheat: 1, ore: 2 } : { wheat: 2, ore: 3 });
  t.board.vertices[vertex].city = true;
  t.cities.players[p].demotedCities = t.cities.players[p].demotedCities.filter(
    (id) => id !== vertex,
  );
}
export function improveCity(
  t: CitiesTable,
  p: number,
  track: CityTrack,
  crane = false,
) {
  seat(t, p);
  rule(TRACKS.includes(track), "Choose Science, Trade or Politics.");
  rule(!t.cities.choices.length, "Resolve the pending choice first.");
  const own = t.cities.players[p],
    level = own.improvements[track];
  rule(level < 5, "This city improvement is complete.");
  rule(
    t.board.vertices.some((v) => v.owner === p && v.city),
    "You need a city to buy improvements.",
  );
  const holder = t.cities.metropolises[track];
  const unoccupied = t.board.vertices
    .filter((v) => v.owner === p && v.city && !metropolisAt(t, v.id))
    .map((v) => v.id);
  rule(
    level < 3 || holder?.owner === p || unoccupied.length > 0,
    "You need an available city before buying this improvement.",
  );
  const next = level + 1;
  const claim =
    next >= 4 &&
    (!holder ||
      own.improvements[track] + 1 >
        t.cities.players[holder.owner].improvements[track]);
  pay(t, p, { [TRACK_COMMODITY[track]]: next - (crane ? 1 : 0) });
  own.improvements[track] = next;
  if (claim && holder?.owner !== p)
    t.cities.choices.push({
      kind: "metropolis",
      player: p,
      track,
      vertices: unoccupied,
    });
}
export function drawProgress(t: CitiesTable, p: number, track: CityTrack) {
  seat(t, p);
  rule(TRACKS.includes(track), "Choose a progress-card deck.");
  const card = t.cities.decks[track].shift();
  if (!card) return null;
  const own = t.cities.players[p];
  if (card.kind === "printer" || card.kind === "constitution")
    own.revealed.push(card);
  else {
    own.progress.push(card);
    const limit = p === t.active ? 5 : 4;
    if (
      own.progress.length > limit &&
      !t.cities.choices.some(
        (c) => c.kind === "discardProgress" && c.player === p,
      )
    )
      t.cities.choices.push({ kind: "discardProgress", player: p, limit });
  }
  return card;
}
export function returnProgress(t: CitiesTable, p: number, cardId: number) {
  seat(t, p);
  const own = t.cities.players[p],
    index = own.progress.findIndex((c) => c.id === cardId);
  rule(index >= 0, "Choose a progress card in your hand.");
  const [card] = own.progress.splice(index, 1);
  t.cities.decks[card.track].push(card);
  return card;
}
export function queueProgressLimit(t: CitiesTable, p: number, endTurn = false) {
  seat(t, p);
  const limit = p === t.active && !endTurn ? 5 : 4;
  if (
    t.cities.players[p].progress.length > limit &&
    !t.cities.choices.some(
      (c) => c.kind === "discardProgress" && c.player === p,
    )
  )
    t.cities.choices.push({ kind: "discardProgress", player: p, limit });
}
export function resolveCitiesChoice(
  t: CitiesTable,
  p: number,
  answer: {
    vertex?: number;
    track?: CityTrack;
    cardId?: number;
    resource?: Resource;
  },
) {
  const choice = t.cities.choices[0];
  rule(choice && choice.player === p, "It is another player's pending choice.");
  if (choice.kind === "pillage") {
    rule(
      choice.vertices.includes(answer.vertex!) &&
        t.board.vertices[answer.vertex!].owner === p &&
        t.board.vertices[answer.vertex!].city &&
        !metropolisAt(t, answer.vertex!),
      "Choose one of your vulnerable cities.",
    );
    const id = answer.vertex!;
    t.board.vertices[id].city = false;
    t.cities.walls = t.cities.walls.filter((v) => v !== id);
    t.cities.players[p].demotedCities.push(id);
  } else if (choice.kind === "metropolis") {
    rule(
      choice.vertices.includes(answer.vertex!) &&
        t.board.vertices[answer.vertex!].owner === p &&
        t.board.vertices[answer.vertex!].city &&
        !metropolisAt(t, answer.vertex!),
      "Choose an available city for this metropolis.",
    );
    t.cities.metropolises[choice.track] = { owner: p, vertex: answer.vertex! };
  } else if (choice.kind === "relocateKnight") {
    rule(
      choice.vertices.includes(answer.vertex!) && freeVertex(t, answer.vertex!),
      "Relocate your displaced knight to a highlighted empty intersection.",
    );
    t.cities.knights.push({ ...choice.knight, vertex: answer.vertex! });
  } else if (choice.kind === "aqueduct") {
    rule(
      RESOURCES.includes(answer.resource!) && t.bank[answer.resource!] > 0,
      "Choose an available resource, not a commodity.",
    );
    t.bank[answer.resource!]--;
    t.players[p].hand[answer.resource!]++;
  } else if (choice.kind === "defenderProgress") {
    rule(
      answer.track && TRACKS.includes(answer.track),
      "Choose a progress-card deck.",
    );
    drawProgress(t, p, answer.track);
  } else if (choice.kind === "discardProgress")
    returnProgress(t, p, answer.cardId!);
  else
    throw new Error("Resolve this progress-card choice with its own controls.");
  t.cities.choices.shift();
  if (
    choice.kind === "discardProgress" &&
    t.cities.players[p].progress.length > choice.limit
  )
    t.cities.choices.unshift(choice);
  if (!RESOURCES.some((r) => t.bank[r] > 0))
    t.cities.choices = t.cities.choices.filter((c) => c.kind !== "aqueduct");
}
export type BarbarianAttack = {
  barbarianStrength: number;
  knightStrength: number;
  contributions: number[];
  defended: boolean;
  affected: number[];
};
export function attackBarbarians(t: CitiesTable): BarbarianAttack {
  rule(!t.cities.choices.length, "Resolve the pending choice first.");
  const barbarianStrength = t.board.vertices.filter(
    (v) => v.owner !== null && v.city,
  ).length;
  const contributions = t.players.map((_, p) => knightStrength(t, p)),
    strength = contributions.reduce((a, b) => a + b, 0);
  const defended = strength >= barbarianStrength;
  const order = [t.active, ...seatsAfter(t, t.active)];
  let affected: number[];
  if (defended) {
    const best = Math.max(...contributions);
    affected = order.filter((p) => contributions[p] === best);
    if (affected.length === 1) t.cities.players[affected[0]].defenders++;
    else
      for (const p of affected)
        t.cities.choices.push({ kind: "defenderProgress", player: p });
  } else {
    const vulnerable = order.filter((p) =>
      t.board.vertices.some(
        (v) => v.owner === p && v.city && !metropolisAt(t, v.id),
      ),
    );
    const weakest = Math.min(...vulnerable.map((p) => contributions[p]));
    affected = vulnerable.filter((p) => contributions[p] === weakest);
    for (const p of affected)
      t.cities.choices.push({
        kind: "pillage",
        player: p,
        vertices: t.board.vertices
          .filter((v) => v.owner === p && v.city && !metropolisAt(t, v.id))
          .map((v) => v.id),
      });
  }
  t.cities.attacks++;
  t.cities.barbarianPosition = 0;
  for (const k of t.cities.knights) k.active = false;
  return {
    barbarianStrength,
    knightStrength: strength,
    contributions,
    defended,
    affected,
  };
}
export function resolveEventDie(t: CitiesTable, red: number, event: number) {
  rule(
    Number.isInteger(red) &&
      red >= 1 &&
      red <= 6 &&
      Number.isInteger(event) &&
      event >= 1 &&
      event <= 6,
    "Roll valid red and event dice.",
  );
  rule(!t.cities.choices.length, "Resolve the pending choice before rolling.");
  if (event <= 3) {
    t.cities.event = "barbarian";
    t.cities.barbarianPosition++;
    return t.cities.barbarianPosition === 7 ? attackBarbarians(t) : null;
  }
  const track = TRACKS[event - 4];
  t.cities.event = track;
  for (const p of [t.active, ...seatsAfter(t, t.active)]) {
    const level = t.cities.players[p].improvements[track];
    if (level > 0 && red <= level + 1) drawProgress(t, p, track);
  }
  return null;
}
// The caller resolves event-die choices before production. A pillaged city must
// produce as a settlement on this same roll. Resource and commodity shortages
// are independent; if only one player claims a scarce good, they get the rest.
export function produceCitiesGoods(t: CitiesTable, roll: number) {
  rule(
    Number.isInteger(roll) && roll >= 2 && roll <= 12,
    "Choose a valid numbered-dice sum.",
  );
  rule(!t.cities.choices.length, "Resolve the event before production.");
  const received = t.players.map(() => citiesHand());
  const gold = t.players.map(() => 0);
  if (roll === 7) return { received, aqueduct: [] as number[], gold };
  const demand = t.players.map(() => citiesHand());
  for (const tile of t.board.tiles) {
    if (
      tile.resource === "gold" &&
      !tile.fog &&
      tile.id !== t.board.robber &&
      tile.number === roll
    ) {
      for (const id of tile.vertices) {
        const v = t.board.vertices[id];
        if (v.owner !== null) gold[v.owner] += v.city ? 2 : 1;
      }
    }
    if (
      tile.id === t.board.robber ||
      tile.number !== roll ||
      !RESOURCES.includes(tile.resource as Resource)
    )
      continue;
    const resource = tile.resource as Resource;
    for (const id of tile.vertices) {
      const vertex = t.board.vertices[id];
      if (vertex.owner === null) continue;
      const commodity = CITY_COMMODITY[resource];
      demand[vertex.owner][resource] += vertex.city && !commodity ? 2 : 1;
      if (vertex.city && commodity) demand[vertex.owner][commodity]++;
    }
  }
  for (const good of GOODS) {
    const claimants = demand.flatMap((h, p) => (h[good] > 0 ? [p] : [])),
      requested = demand.reduce((n, h) => n + h[good], 0);
    if (requested > t.bank[good] && claimants.length > 1) continue;
    for (const p of claimants) {
      const n = Math.min(t.bank[good], demand[p][good]);
      t.bank[good] -= n;
      t.players[p].hand[good] += n;
      received[p][good] += n;
    }
  }
  const aqueduct = [t.active, ...seatsAfter(t, t.active)]
    .filter(
      (p) =>
        !goodsTotal(received[p]) &&
        !gold[p] &&
        t.cities.players[p].improvements.science >= 3,
    );
  if (RESOURCES.some((r) => t.bank[r] > 0))
    for (const p of aqueduct)
      t.cities.choices.push({ kind: "aqueduct", player: p });
  return { received, aqueduct, gold };
}
export function citiesBankRatio(t: CitiesTable, p: number, good: Good) {
  seat(t, p);
  rule(GOODS.includes(good), "Choose a resource or commodity.");
  let ratio = 4;
  for (const port of t.board.ports) {
    const e = t.board.edges[port.edge];
    if (t.board.vertices[e.a].owner !== p && t.board.vertices[e.b].owner !== p)
      continue;
    if (port.resource === "any") ratio = Math.min(ratio, 3);
    else if (port.resource === good) ratio = 2;
  }
  if (
    COMMODITIES.includes(good as Commodity) &&
    t.cities.players[p].improvements.trade >= 3
  )
    ratio = 2;
  const merchant = t.cities.merchant;
  if (merchant?.owner === p && t.board.tiles[merchant.tile].resource === good)
    ratio = 2;
  if (
    t.cities.merchantFleet?.owner === p &&
    t.cities.merchantFleet.turn === t.turn &&
    t.cities.merchantFleet.good === good
  )
    ratio = 2;
  if (
    t.cities.merchantFleets?.some(
      (fleet) =>
        fleet.owner === p && fleet.turn === t.turn && fleet.good === good,
    )
  )
    ratio = 2;
  return ratio;
}
export function exchangeCitiesBank(
  t: CitiesTable,
  p: number,
  give: Good,
  want: Good,
  count = 1,
) {
  rule(
    GOODS.includes(give) &&
      GOODS.includes(want) &&
      give !== want &&
      Number.isInteger(count) &&
      count > 0 &&
      count <= 100,
    "Choose different card types and a valid trade count.",
  );
  const ratio = citiesBankRatio(t, p, give);
  rule(t.bank[want] >= count, "The bank does not have enough requested cards.");
  pay(t, p, { [give]: ratio * count });
  t.bank[want] -= count;
  t.players[p].hand[want] += count;
}
// Never spread private decks or other players' progress cards into an API view.
export function citiesView(t: CitiesTable, viewer: number) {
  const { decks, players, choices, ...state } = t.cities;
  const current = choices[0];
  let choice: PublicCitiesChoice | null = current
    ? structuredClone(current)
    : null;
  if (
    current?.kind === "harborExchange" &&
    viewer !== current.player &&
    viewer !== current.to
  ) {
    const { resource, ...publicChoice } = current;
    choice = structuredClone(publicChoice);
  }
  const peek: {
    player: number;
    hand?: CitiesHand;
    progress?: ProgressCard[];
  } | null =
    current?.player === viewer && current.kind === "masterMerchant"
      ? {
          player: current.from,
          hand: structuredClone(t.players[current.from].hand),
        }
      : current?.player === viewer && current.kind === "spy"
        ? {
            player: current.from,
            progress: structuredClone(players[current.from].progress),
          }
        : null;
  return {
    ...structuredClone(state),
    deckCounts: Object.fromEntries(
      TRACKS.map((track) => [track, decks[track].length]),
    ),
    players: players.map(({ progress, ...player }, p) => ({
      ...structuredClone(player),
      progressCount: progress.length,
      ...(p === viewer ? { progress: structuredClone(progress) } : {}),
    })),
    choice,
    peek,
    pendingPlayers: choices.map((c) => c.player),
  };
}
