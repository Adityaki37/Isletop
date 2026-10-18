import { MAX_PLAYERS } from "./player-colors";
import { nextTurnSeat, seatsAfter, seatsInTurnOrder } from "./turn-order";
import { usesSeafarers, usesCitiesKnights } from "./game-modes";
import { robberCandidates } from "./robber-strategy";
import { cardFeedbackForViewer, recordCardFeedback, type CardTransfer } from "./card-feedback";
import { rankedView } from "./ranked";
import { validTurnSeconds } from "./turn-timer";
import {
  Board,
  Hand,
  Resource,
  RESOURCES,
  emptyHand,
  shuffle,
  secureRandom,
  Tile,
} from "./board";
import {
  BalancedDiceState,
  DiceMode,
  createBalancedDice,
  drawBalancedDice,
} from "./dice";
import {
  hasLand,
  legalRoutes,
  makeSeafarersBoard,
  movableShips,
  routeKind,
} from "./seafarers";
import {
  SEAFARERS_SCENARIOS,
  SeafarersScenario,
  scenarioTarget,
} from "./scenarios";
import { explorationContents } from "./fog";
import {
  forkReplayCapture,
  commitReplayCapture,
  recordReplayFrame,
} from "./match-replay";
import {
  recordRobbery,
  createMatchStatistics,
  MatchStatistics,
  recordPayment,
  trackStatistics,
} from "./match-statistics";
import { BaseMap, baseMapAvailable, defaultBaseMap, makeBaseBoard } from "./base-maps";
import {
  createTablePause,
  advancePause,
  needsPauseUpdate,
  isPauseAction,
  performPauseAction,
  type TablePause,
} from "./table-pause";
import {
  RushState,
  RUSH_SPEEDS,
  RUSH_CHOICE_SECONDS,
  createRush,
  startRushPlay,
  performRushAction,
  advanceRush,
  refreshRushClock,
  rushPhase,
} from "./rush";
import {
  CitiesState,
  CityTrack,
  Good,
  GOODS,
  CitiesHand,
  citiesView,
  citiesBonus,
  citiesRoadBlocked,
  knightAt,
  legalCitiesUpgrades,
  citiesBankRatio,
  robberEnabled,
  cleanCitiesHand,
} from "./cities-knights";
import {
  GameHand,
  CitiesFlow,
  citiesTable,
  initializeCitiesRoom,
  performCitiesAction,
  citiesTimeoutChoice,
  citiesLegal,
} from "./cities-room";
import {
  advanceTrades,
  initializeTrade,
  tradeResponseTimer,
  tradeBlocked,
  tradeEligible,
  tradeExecutor,
  tradePartners,
} from "./trading";
export {
  tradeBlocked,
  tradeEligible,
  tradeExecutor,
  tradePartners,
  needsTradeUpdate,
} from "./trading";
export type GameMode =
  | "base"
  | "duel"
  | "seafarers"
  | "citiesKnights"
  | "seafarersCitiesKnights"
  | "rush"
  | "solo";
// Expansion API exposure follows completion of the human controls.
export const AVAILABLE_GAME_MODES: GameMode[] = [
  "base",
  "duel",
  "seafarers",
  "citiesKnights",
  "seafarersCitiesKnights",
  "rush",
  "solo",
];
export function minimumPlayers(mode: GameMode, capacity = 4) {
  if (mode === "solo") return 1;
  if (mode === "duel") return 2;
  if (mode === "base") return 2;
  return 3;
}
export function boardPlayerCount(g: Pick<Game, "mode" | "players">) {
  return Math.max(minimumPlayers(g.mode), g.players.length);
}
export function resourceCardStock(seats: number) {
  return seats <= 4 ? 19 : seats <= 6 ? 24 : seats <= 8 ? 29 : 39;
}
function boardSizeGroup(
  g: Pick<Game, "mode" | "players">,
  seats = g.players.length,
) {
  const n = Math.max(minimumPlayers(g.mode), seats);
  return usesSeafarers(g.mode)
    ? n === 3
      ? 3
      : n <= 4
        ? 4
        : 6
    : n <= 4
      ? 4
      : n <= 6
        ? 6
        : n <= 8 ? 8 : 12;
}
export function refreshLobbyBoard(
  g: Game,
  previousSeats?: number,
  resetReady = true,
) {
  if (g.phase !== "lobby") return;
  const seats = boardPlayerCount(g);
  g.boardPlayers = seats;
  if (
    previousSeats !== undefined &&
    boardSizeGroup(g, previousSeats) === boardSizeGroup(g)
  )
    return;
  g.board = usesSeafarers(g.mode)
    ? makeSeafarersBoard(seats, g.scenario)
    : makeBaseBoard(seats, g.map);
  g.bank = Object.fromEntries(
    RESOURCES.map((r) => [r, resourceCardStock(seats)]),
  ) as Hand;
  Object.assign(g, explorationContents({ ...g, capacity: seats }));
  if (resetReady)
    g.players.forEach((p) => {
      p.ready = p.bot === true;
    });
}
export type DevKind =
  "knight" | "roadBuilding" | "plenty" | "monopoly" | "victory";
export type Dev = { kind: DevKind; bought: number };
import { normalizeAvatar } from "./avatars";
import { botMoveInterval, isBotPracticeGame } from "./bot-speed";
import { appendGameLog, appendProductionLog, appendResourceReceipt, formatResourceCards, type PrivateLogDetail } from "./game-log";

export type Player = {
  bot?: boolean;
  id: string;
  name: string;
  color: number;
  avatar?: import("./avatars").AvatarId;
  ready: boolean;
  hand: GameHand;
  dev: Dev[];
  knights: number;
  islandBonus: number;
  islands: number[];
  embargoes: number[];
  autoRejectTrades: boolean;
};
export type Phase =
  | "lobby"
  | "setupSettlement"
  | "setupRoad"
  | "roll"
  | "action"
  | "discard"
  | "robber"
  | "steal"
  | "roadBuilding"
  | "special"
  | "gold"
  | "citiesChoice"
  | "finished";
export type Offer = {
  executor?: number;
  id: number;
  from: number;
  to: number | null;
  give: GameHand;
  want: GameHand;
  rejected: number[];
  accepted: number[];
  preparing: number[];
  replyTo: number | null;
  targets: number[] | null;
  blocked: number[];
  expired: number[];
  responseDeadlines: Record<number, number | null>;
  responseDurations?: Record<number, number>;
  preparingUntil: Record<number, number>;
  closeAt: number | null;
  pausedAt: number | null;
};
export type Game = {
  matchmaking?: import("./matchmaking-types").MatchmakingQueue;
  ranked?: import("./ranked-types").RankedSnapshot;
  code: string;
  title: string;
  capacity: number;
  boardPlayers: number;
  botPlayers: number[];
  botDueAt: number;
  botFastForward: boolean;
  botTradeMemory?: Record<
    number,
    {
      turn: number;
      attempts: number;
      signatures: string[];
      startedAt: number;
    }
  >;
  mode: GameMode;
  scenario: SeafarersScenario;
  map: BaseMap;
  rush: RushState | null;
  diceMode: DiceMode;
  diceState: BalancedDiceState;
  target: number;
  public: boolean;
  discardLimit: number;
  friendlyRobber: boolean;
  hideBank: boolean;
  turnSeconds: number;
  deadline: number | null;
  clockKey: string | null;
  pause: TablePause;
  pauseCooldowns: Record<number, number>;
  clockResume: {
    phase: "roll" | "action" | "special";
    remaining: number;
  } | null;
  players: Player[];
  turnOrder?: number[];
  board: Board;
  bank: GameHand;
  cities: CitiesState | null;
  citiesFlow: CitiesFlow | null;
  citiesChoiceSeq: number;
  deck: DevKind[];
  phase: Phase;
  active: number;
  turn: number;
  setupStep: number;
  setupVertex: number | null;
  dice: number[];
  productionFeedback?: import("./production-feedback").ProductionFeedback;
  cardFeedback?: import("./card-feedback").CardFeedback[];
  discards: Record<number, number>;
  victims: number[];
  raiderMove?: "robber" | "pirate" | null;
  resume: "roll" | "action";
  freeRoads: number;
  devPlayed: boolean;
  specialQueue: number[];
  specialRequests: number[];
  specialPlayer: number | null;
  longest: number | null;
  army: number | null;
  winner: number | null;
  resignedBy: number | null;
  shipMoved: boolean;
  goldClaims: Record<number, number>;
  goldResume: Exclude<Phase, "gold">;
  fogDeck: Tile["resource"][];
  fogNumbers: number[];
  offers: Offer[];
  offerSeq: number;
  log: string[];
  logDetails: PrivateLogDetail[];
  chat: { name: string; text: string }[];
  revision: number;
  receipts: string[];
  rollCounts: Record<number, number>;
  statistics: MatchStatistics | null;
  replaySequence: number;
  replayComplete: boolean;
  created: number;
  updated: number;
};
export type Action = {
  type: string;
  id?: number;
  resource?: Resource;
  resources?: GameHand;
  give?: GameHand;
  want?: GameHand;
  cardId?: number;
  vertex?: number | null;
  edge?: number | null;
  tile?: number;
  tiles?: number[];
  knights?: number[];
  dice?: number[];
  track?: CityTrack;
  good?: Good;
  to?: number | null;
  preparing?: boolean;
  targets?: number[] | null;
  blocked?: boolean;
  requested?: boolean;
  autoReject?: boolean;
  accept?: boolean;
  text?: string;
  count?: number;
  public?: boolean;
  target?: number;
  capacity?: number;
  mode?: GameMode;
  scenario?: SeafarersScenario;
  map?: BaseMap;
  diceMode?: DiceMode;
  discardLimit?: number;
  friendlyRobber?: boolean;
  hideBank?: boolean;
  turnSeconds?: number;
  enabled?: boolean;
  color?: number;
};
export const COSTS: Record<string, Partial<Hand>> = {
  road: { wood: 1, brick: 1 },
  ship: { wood: 1, sheep: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  development: { sheep: 1, wheat: 1, ore: 1 },
};
export function resourceTotal(hand: GameHand) {
  return RESOURCES.reduce((n, r) => n + hand[r], 0);
}
export function total(hand: GameHand) {
  return GOODS.reduce((n, r) => n + (hand[r] ?? 0), 0);
}
export function gameGoods(g: Pick<Game, "cities">): readonly Good[] {
  return g.cities ? GOODS : RESOURCES;
}
function requireRule(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function player(
  id: string,
  name: string,
  avatar: import("./avatars").AvatarId = "player",
): Player {
  return {
    id,
    name: name.trim().slice(0, 24) || "Guest",
    color: -1,
    avatar: normalizeAvatar(avatar),
    ready: false,
    hand: emptyHand(),
    dev: [],
    knights: 0,
    islandBonus: 0,
    islands: [],
    embargoes: [],
    autoRejectTrades: true,
  };
}
export function createGame(
  code: string,
  host: Player,
  capacity = 4,
  isPublic = false,
  mode: GameMode = capacity === 1 ? "solo" : capacity === 2 ? "duel" : "base",
  scenario: SeafarersScenario = "newShores",
  map: BaseMap = defaultBaseMap(mode),
): Game {
  requireRule(
    baseMapAvailable(map, mode, capacity),
    "Choose an available map for this mode and player count.",
  );
  requireRule(
    SEAFARERS_SCENARIOS.includes(scenario) &&
      (usesSeafarers(mode) || scenario === "newShores"),
    "Choose an available Voyages scenario.",
  );
  requireRule(
    (mode === "solo" && capacity === 1) ||
      (mode === "duel" && capacity === 2) ||
      (["base", "rush"].includes(mode) &&
        Number.isInteger(capacity) &&
        capacity >= (mode === "base" ? 2 : 3) &&
        capacity <= MAX_PLAYERS) ||
      ((usesSeafarers(mode) || usesCitiesKnights(mode)) &&
        Number.isInteger(capacity) &&
        capacity >= 3 &&
        capacity <= 6),
    "Choose one player for Solo Practice, two for 1v1, 2–12 for Base, 3–12 for Rush, or 3–6 for expansions.",
  );
  const now = Date.now();
  const boardSeats = minimumPlayers(mode);
  host.color = 0;
  return {
    code,
    title: `${host.name}’s table`,
    capacity,
    boardPlayers: boardSeats,
    botPlayers: [],
    botDueAt: 0,
    botFastForward: false,
    mode,
    scenario,
    map,
    rush: null,
    diceMode: mode === "duel" ? "balanced" : "random",
    diceState: createBalancedDice(),
    target:
      mode === "duel"
        ? 15
        : usesSeafarers(mode)
          ? scenarioTarget(scenario, usesCitiesKnights(mode))
          : usesCitiesKnights(mode)
            ? 13
            : 10,
    public: isPublic,
    discardLimit: ["duel", "rush"].includes(mode) ? 9 : 7,
    friendlyRobber: false,
    hideBank: false,
    turnSeconds:
      mode === "solo" ? 0 : mode === "rush" ? 5 : mode === "duel" ? 30 : 60,
    deadline: null,
    clockKey: null,
    clockResume: null,
    pause: createTablePause(),
    pauseCooldowns: {},
    players: [host],
    board: usesSeafarers(mode)
      ? makeSeafarersBoard(boardSeats, scenario)
      : makeBaseBoard(boardSeats, map),
    bank: Object.fromEntries(
      RESOURCES.map((r) => [r, resourceCardStock(boardSeats)]),
    ) as Hand,
    deck: [],
    cities: null,
    citiesFlow: null,
    citiesChoiceSeq: 0,
    phase: "lobby",
    active: 0,
    turn: 0,
    setupStep: 0,
    setupVertex: null,
    dice: [],
    discards: {},
    victims: [],
    resume: "action",
    freeRoads: 0,
    devPlayed: false,
    specialQueue: [],
    specialRequests: [],
    specialPlayer: null,
    longest: null,
    army: null,
    winner: null,
    resignedBy: null,
    shipMoved: false,
    goldClaims: {},
    goldResume: "action",
    ...explorationContents({ map, scenario, capacity: boardSeats }),
    offers: [],
    offerSeq: 0,
    log: ["Welcome to the table."],
    logDetails: [null],
    chat: [],
    revision: 0,
    receipts: [],
    rollCounts: {},
    statistics: null,
    replaySequence: 0,
    replayComplete: false,
    created: now,
    updated: now,
  };
}
export function addPlayer(g: Game, p: Player) {
  normalizeGame(g);
  requireRule(g.phase === "lobby", "This game has already started.");
  requireRule(g.players.length < g.capacity, "This room is full.");
  requireRule(!g.players.some((x) => x.id === p.id), "You are already seated.");
  p.color = Array.from({ length: MAX_PLAYERS }, (_, i) => i).find(
    (color) => !g.players.some((seat) => seat.color === color),
  )!;
  g.players.push(p);
  refreshLobbyBoard(g, g.players.length - 1);
  log(g, `${p.name} joined the table.`);
}
export function actor(
  g: Pick<Game, "phase" | "active" | "specialPlayer"> & {
    cities?: CitiesState | ReturnType<typeof citiesView> | null;
  },
) {
  if (g.phase === "citiesChoice" && g.cities) {
    const choice =
      "choices" in g.cities ? g.cities.choices[0] : g.cities.choice;
    if (choice) return choice.player;
  }
  return g.phase === "special" ? g.specialPlayer! : g.active;
}
export function affordable(g: Game, p: number, cost: Partial<GameHand>) {
  return gameGoods(g).every(
    (r) => (g.players[p].hand[r] ?? 0) >= (cost[r] ?? 0),
  );
}
function pay(g: Game, p: number, cost: Partial<GameHand>) {
  requireRule(
    affordable(g, p, cost),
    "You do not have the required resources.",
  );
  recordPayment(g, p, cost);
  for (const r of gameGoods(g)) {
    const n = cost[r] ?? 0;
    g.players[p].hand[r] = (g.players[p].hand[r] ?? 0) - n;
    g.bank[r] = (g.bank[r] ?? 0) + n;
  }
}
const log = appendGameLog;
export function pieces(g: Game, p: number) {
  return {
    road: g.board.edges.filter((e) => e.owner === p && routeKind(e) === "road")
      .length,
    ship: g.board.edges.filter((e) => e.owner === p && routeKind(e) === "ship")
      .length,
    settlement: g.board.vertices.filter((v) => v.owner === p && !v.city).length,
    city: g.board.vertices.filter((v) => v.owner === p && v.city).length,
  };
}
export function legalSettlements(g: Game, p: number, setup = false) {
  if (pieces(g, p).settlement >= 5) return [];
  return g.board.vertices
    .filter(
      (v) =>
        v.owner === null &&
        hasLand(g.board, v.id) &&
        (!(g.map === "blackForest" && setup && g.phase === "setupSettlement") ||
          v.tiles.some((id) => g.board.tiles[id].home)) &&
        (!g.cities || !knightAt(citiesTable(g), v.id)) &&
        (!usesSeafarers(g.mode) ||
          (hasLand(g.board, v.id) &&
            (!setup || v.tiles.some((id) => g.board.tiles[id].home)))) &&
        v.edges.every((id) => {
          const e = g.board.edges[id];
          return g.board.vertices[e.a === v.id ? e.b : e.a].owner === null;
        }) &&
        (setup || v.edges.some((id) => g.board.edges[id].owner === p)),
    )
    .map((v) => v.id);
}
export function legalCities(g: Game, p: number) {
  if (g.cities) return legalCitiesUpgrades(citiesTable(g), p);
  return pieces(g, p).city >= 4
    ? []
    : g.board.vertices.filter((v) => v.owner === p && !v.city).map((v) => v.id);
}
export function legalRoads(g: Game, p: number, setup = false) {
  if (pieces(g, p).road >= 15) return [];
  if (usesSeafarers(g.mode))
    return legalRoutes(
      g.board,
      p,
      "road",
      setup ? g.setupVertex : null,
      undefined,
      (id) => !!g.cities && citiesRoadBlocked(citiesTable(g), id, p),
    );
  return g.board.edges
    .filter(
      (e) =>
        e.owner === null &&
        e.tiles.some((id) => g.board.tiles[id].resource !== "sea") &&
        (setup
          ? [e.a, e.b].includes(g.setupVertex!)
          : [e.a, e.b].some((id) => {
              if (g.cities && citiesRoadBlocked(citiesTable(g), id, p))
                return false;
              const v = g.board.vertices[id];
              return (
                v.owner === p ||
                (v.owner === null &&
                  v.edges.some((eid) => g.board.edges[eid].owner === p))
              );
            })),
    )
    .map((e) => e.id);
}
export function legalShips(g: Game, p: number, setup = false) {
  if (!usesSeafarers(g.mode) || pieces(g, p).ship >= 15) return [];
  return legalRoutes(
    g.board,
    p,
    "ship",
    setup ? g.setupVertex : null,
    undefined,
    (id) => !!g.cities && citiesRoadBlocked(citiesTable(g), id, p),
  );
}
export function legalMoveShips(g: Game, p: number) {
  return usesSeafarers(g.mode) &&
    !g.shipMoved &&
    g.phase === "action" &&
    p === g.active
    ? movableShips(
        g.board,
        p,
        g.turn,
        g.cities?.knights.filter((k) => k.owner === p).map((k) => k.vertex),
      )
    : [];
}
export function shipDestinations(g: Game, p: number, source: number) {
  return legalMoveShips(g, p).includes(source)
    ? legalRoutes(
        g.board,
        p,
        "ship",
        null,
        source,
        (id) => !!g.cities && citiesRoadBlocked(citiesTable(g), id, p),
      )
    : [];
}
export function roadLength(g: Game, p: number) {
  let best = 0;
  const owned = g.board.edges.filter((e) => e.owner === p);
  function walk(
    v: number,
    used: Set<number>,
    length: number,
    previous?: "road" | "ship",
  ) {
    best = Math.max(best, length);
    if (
      length &&
      ((g.board.vertices[v].owner !== null &&
        g.board.vertices[v].owner !== p) ||
        (g.cities && citiesRoadBlocked(citiesTable(g), v, p)))
    )
      return;
    for (const eid of g.board.vertices[v].edges) {
      const e = g.board.edges[eid];
      if (e.owner !== p || used.has(eid)) continue;
      if (
        previous &&
        routeKind(e) !== previous &&
        g.board.vertices[v].owner !== p
      )
        continue;
      used.add(eid);
      walk(e.a === v ? e.b : e.a, used, length + 1, routeKind(e));
      used.delete(eid);
    }
  }
  for (const e of owned) {
    walk(e.a, new Set(), 0);
    walk(e.b, new Set(), 0);
  }
  return best;
}
function holder(values: number[], minimum: number, old: number | null) {
  const max = Math.max(...values);
  if (max < minimum) return null;
  const leaders = values
    .map((v, i) => (v === max ? i : -1))
    .filter((i) => i >= 0);
  if (old !== null && leaders.includes(old)) return old;
  return leaders.length === 1 ? leaders[0] : null;
}
export function awards(g: Game) {
  const oldRoad = g.longest,
    oldArmy = g.army;
  g.longest = holder(
    g.players.map((_, i) => roadLength(g, i)),
    5,
    g.longest,
  );
  g.army = g.cities
    ? null
    : holder(
        g.players.map((p) => p.knights),
        3,
        g.army,
      );
  if (g.longest !== oldRoad && g.longest !== null)
    log(
      g,
      `${g.players[g.longest].name} holds ${usesSeafarers(g.mode) ? "Longest Trade Route" : "Longest Road"}.`,
    );
  if (g.army !== oldArmy && g.army !== null)
    log(g, `${g.players[g.army].name} holds Largest Army.`);
}
export function points(g: Game, p: number, hidden = true) {
  return (
    g.board.vertices
      .filter((v) => v.owner === p)
      .reduce((n, v) => n + (v.city ? 2 : 1), 0) +
    (g.longest === p ? 2 : 0) +
    (g.army === p ? 2 : 0) +
    (g.players[p].islandBonus ?? 0) +
    (g.cities ? citiesBonus(citiesTable(g), p) : 0) +
    (hidden ? g.players[p].dev.filter((d) => d.kind === "victory").length : 0)
  );
}
export function checkWin(g: Game) {
  if (
    [
      "lobby",
      "setupSettlement",
      "setupRoad",
      "special",
      "gold",
      "citiesChoice",
      "finished",
    ].includes(g.phase)
  )
    return;
  const winner = g.rush
    ? [
        g.active,
        ...g.players.map((_, i) => i).filter((i) => i !== g.active),
      ].find((p) => points(g, p) >= g.target)
    : points(g, g.active) >= g.target
      ? g.active
      : undefined;
  if (winner !== undefined) {
    g.winner = winner;
    g.phase = "finished";
    g.offers = [];
    g.specialRequests = [];
    log(g, `${g.players[winner].name} wins with ${points(g, winner)} points!`);
  }
}
export function bankRate(g: Game, p: number, r: Good) {
  if (g.cities) return citiesBankRatio(citiesTable(g), p, r);
  let rate = 4;
  for (const port of g.board.ports) {
    const e = g.board.edges[port.edge];
    if ([e.a, e.b].some((id) => g.board.vertices[id].owner === p)) {
      if (port.resource === r) return 2;
      if (port.resource === "any") rate = 3;
    }
  }
  return rate;
}
function validateHand(h: GameHand | undefined, g?: Game): GameHand {
  if (g?.cities) return cleanCitiesHand(h);
  requireRule(
    h &&
      RESOURCES.every(
        (r) => Number.isInteger(h[r]) && h[r] >= 0 && h[r] <= 150,
      ) &&
      Object.keys(h).length === 5,
    "Choose valid resource amounts.",
  );
  return h;
}
function start(g: Game, now: number, rng: () => number) {
  requireRule(
    g.players.length >= minimumPlayers(g.mode, g.capacity),
    g.mode === "duel"
      ? "Two players are required for 1v1."
      : `At least ${minimumPlayers(g.mode, g.capacity)} players are required.`,
  );
  requireRule(
    g.players.every((p, i) => i === 0 || p.ready),
    "Every player must be ready.",
  );
  refreshLobbyBoard(g, undefined, false);
  const seats = boardPlayerCount(g);
  const expanded = seats > 4;
  g.deck = shuffle(
    seats > 8 ? [
      ...Array(40).fill("knight"), ...Array(6).fill("roadBuilding"),
      ...Array(6).fill("plenty"), ...Array(6).fill("monopoly"), ...Array(7).fill("victory"),
    ] : expanded
      ? seats <= 6
        ? [
            ...Array(20).fill("knight"),
            ...Array(3).fill("roadBuilding"),
            ...Array(3).fill("plenty"),
            ...Array(3).fill("monopoly"),
            ...Array(5).fill("victory"),
          ]
        : [
            ...Array(26).fill("knight"),
            ...Array(4).fill("roadBuilding"),
            ...Array(4).fill("plenty"),
            ...Array(4).fill("monopoly"),
            ...Array(5).fill("victory"),
          ]
      : [
          ...Array(14).fill("knight"),
          ...Array(2).fill("roadBuilding"),
          ...Array(2).fill("plenty"),
          ...Array(2).fill("monopoly"),
          ...Array(5).fill("victory"),
        ],
  );
  g.phase = "setupSettlement";
  g.specialRequests = [];
  g.specialQueue = [];
  g.specialPlayer = null;
  g.rush = g.mode === "rush" ? createRush(g.players.length) : null;
  if (usesCitiesKnights(g.mode)) initializeCitiesRoom(g);
  g.players.forEach((p) => {
    p.embargoes = [];
  });
  g.turnOrder = shuffle(g.players.map((_, seat) => seat), rng);
  g.active = g.turnOrder[0];
  if (g.rush) g.rush.nextRobber = g.active;
  g.statistics = createMatchStatistics(g, now);
  g.replaySequence = 0;
  g.replayComplete = true;
  g.statistics.points.push({
    sequence: 0,
    turn: g.turn,
    scores: g.players.map(() => 0),
  });
  log(
    g,
    g.cities
      ? "The game begins. Place a settlement in forward order, then a city in reverse order."
      : "The game begins. Place settlements in forward, then reverse order.",
  );
  log(g, `Turn order: ${g.turnOrder.map((seat) => g.players[seat].name).join(" → ")}.`);
}
function normalTurn(g: Game) {
  g.active = nextTurnSeat(g, g.active);
  g.turn++;
  g.phase = "roll";
  g.specialPlayer = null;
  g.specialRequests = g.specialRequests.filter((p) => p !== g.active);
  g.devPlayed = false;
  g.shipMoved = false;
  g.dice = [];
  g.offers = [];
  checkWin(g);
}
function endTurn(g: Game) {
  g.offers = [];
  if (g.boardPlayers > 4) {
    g.specialQueue = seatsAfter(g, g.active);
    nextSpecial(g);
  } else normalTurn(g);
}
function nextSpecial(g: Game) {
  while (g.specialQueue.length) {
    const seat = g.specialQueue.shift()!;
    if (!g.specialRequests.includes(seat)) continue;
    g.specialRequests = g.specialRequests.filter((p) => p !== seat);
    g.specialPlayer = seat;
    g.phase = "special";
    log(g, `${g.players[seat].name} entered the special building phase.`);
    return;
  }
  normalTurn(g);
}
export function distribute(g: Game, sum: number) {
  const before = g.players.map((p) => ({ ...p.hand }));
  const demand = g.players.map(() => emptyHand());
  for (const t of g.board.tiles) {
    if (
      t.number !== sum ||
      t.id === g.board.robber ||
      t.resource === "desert" ||
      t.resource === "sea"
    )
      continue;
    for (const vid of t.vertices) {
      const v = g.board.vertices[vid];
      if (v.owner !== null) {
        if (t.resource === "gold")
          g.goldClaims[v.owner] =
            (g.goldClaims[v.owner] ?? 0) + (v.city ? 2 : 1);
        else demand[v.owner][t.resource] += v.city ? 2 : 1;
      }
    }
  }
  for (const r of RESOURCES) {
    const need = demand.reduce((n, h) => n + h[r], 0);
    if (need <= g.bank[r]) {
      demand.forEach((h, p) => {
        g.players[p].hand[r] += h[r];
        g.bank[r] -= h[r];
      });
    } else {
      const recipients = demand
        .map((h, i) => (h[r] > 0 ? i : -1))
        .filter((i) => i >= 0);
      if (recipients.length === 1) {
        const p = recipients[0],
          n = Math.min(demand[p][r], g.bank[r]);
        g.players[p].hand[r] += n;
        g.bank[r] -= n;
      }
      log(g, `The bank has insufficient ${r}.`);
    }
  }
  appendProductionLog(g, g.players.map((p, seat) =>
    Object.fromEntries(RESOURCES.map((r) => [r, p.hand[r] - before[seat][r]])),
  ), undefined, undefined, sum);
}
function beginRobber(
  g: Game,
  resume: "roll" | "action",
  kind?: "robber" | "pirate",
  rng = secureRandom,
) {
  g.raiderMove = kind ?? null;
  if (g.cities && !robberEnabled(citiesTable(g))) {
    g.resume = resume;
    g.phase = resume;
    g.victims = [];
    log(g, "The robber stays put until the first barbarian attack.");
    return;
  }
  g.resume = resume;
  g.phase = "robber";
  if (!g.rush) g.offers = [];
  const legal = legalRobberTiles(g),
    pirates = legalPirateTiles(g);
  if (!legal.length && !pirates.length) {
    log(g, "Friendly robber protects every other tile; the robber stays put.");
    finishRobber(g);
  } else if (!g.rush && legal.length + pirates.length === 1) {
    if (legal.length) moveRobber(g, legal[0], rng);
    else movePirate(g, pirates[0], rng);
  }
}
function finishRobber(g: Game) {
  g.raiderMove = null;
  g.phase = g.resume;
  g.victims = [];
}
export function legalRobberTiles(g: Game) {
  if (g.raiderMove === "pirate") return [];
  if (g.cities && !robberEnabled(citiesTable(g))) return [];
  return g.board.tiles
    .filter(
      (t) =>
        t.resource !== "sea" &&
        t.id !== g.board.robber &&
        (!g.friendlyRobber ||
          t.vertices.every((id) => {
            const owner = g.board.vertices[id].owner;
            return owner === null || points(g, owner, false) > 2;
          })),
    )
    .map((t) => t.id);
}
export function legalPirateTiles(g: Game) {
  if (g.raiderMove === "robber" || (g.cities && !robberEnabled(citiesTable(g))))
    return [];
  return usesSeafarers(g.mode)
    ? g.board.tiles
        .filter(
          (t) =>
            t.resource === "sea" &&
            !t.fog &&
            t.id !== g.board.pirate &&
            (!g.friendlyRobber ||
              g.board.edges
                .filter(
                  (e) =>
                    e.tiles.includes(t.id) &&
                    e.owner !== null &&
                    routeKind(e) === "ship",
                )
                .every((e) => points(g, e.owner!, false) > 2)),
        )
        .map((t) => t.id)
    : [];
}
function stealCard(g: Game, from: number, rng: () => number) {
  const victim = g.players[from];
  const bag = gameGoods(g).flatMap((r) => Array(victim.hand[r] ?? 0).fill(r) as Good[]);
  const resource = bag[Math.floor(rng() * bag.length)];
  requireRule(resource, "This player has no resources.");
  victim.hand[resource] = (victim.hand[resource] ?? 0) - 1;
  const receiver = g.players[g.active];
  receiver.hand[resource] = (receiver.hand[resource] ?? 0) + 1;
  recordRobbery(g, from, g.active, resource);
  recordCardFeedback(g, "steal", [{ card: resource, amount: 1,
    from: { type: "player", seat: from }, to: { type: "player", seat: g.active } }]);
  log(g, `${receiver.name} stole a hidden card from ${victim.name}.`, {
    text: `${receiver.name} stole 1 ${resource} from ${victim.name}.`,
    seats: [g.active, from],
  });
  finishRobber(g);
}
function resolveVictims(g: Game, rng: () => number) {
  if (g.victims.length === 1) stealCard(g, g.victims[0], rng);
  else if (g.victims.length > 1) g.phase = "steal";
  else finishRobber(g);
}
function movePirate(g: Game, tile: number, rng = secureRandom) {
  g.board.pirate = tile;
  g.victims = [
    ...new Set(
      g.board.edges
        .filter(
          (e) =>
            e.tiles.includes(tile) &&
            e.owner !== null &&
            e.owner !== g.active &&
            routeKind(e) === "ship" &&
            total(g.players[e.owner].hand) > 0,
        )
        .map((e) => e.owner!),
    ),
  ];
  log(g, `${g.players[g.active].name} moved the pirate.`);
  resolveVictims(g, rng);
}
function moveRobber(g: Game, tile: number, rng = secureRandom) {
  g.board.robber = tile;
  g.victims = [
    ...new Set(
      g.board.tiles[tile].vertices
        .map((id) => g.board.vertices[id].owner)
        .filter(
          (id): id is number =>
            id !== null && id !== g.active && total(g.players[id].hand) > 0,
        ),
    ),
  ];
  log(
    g,
    `${g.players[g.active].name} moved the robber to ${g.board.tiles[tile].resource}.`,
  );
  resolveVictims(g, rng);
}
function spendDev(g: Game, p: number, kind: DevKind) {
  requireRule(
    g.rush || !g.devPlayed,
    "You can play only one development card per turn.",
  );
  const idx = g.players[p].dev.findIndex(
    (d) => d.kind === kind && (g.rush || d.bought < g.turn),
  );
  requireRule(idx >= 0, "You cannot play this card yet.");
  g.players[p].dev.splice(idx, 1);
  if (!g.rush) g.devPlayed = true;
}
function discoverFog(g: Game, p: number, edge: number) {
  if (
    g.scenario !== "fogIslands" &&
    !["goldRush", "blackForest"].includes(g.map)
  )
    return;
  const e = g.board.edges[edge];
  const ids = [
    ...new Set([e.a, e.b].flatMap((id) => g.board.vertices[id].tiles)),
  ].sort((a, b) => a - b);
  for (const id of ids) {
    const tile = g.board.tiles[id];
    if (!tile.fog) continue;
    const resource = g.fogDeck.shift();
    requireRule(resource, "The exploration deck is empty.");
    tile.resource = resource;
    tile.number =
      resource === "sea" || resource === "desert" ? 0 : g.fogNumbers.shift()!;
    delete tile.fog;
    tile.home = false;
    log(
      g,
      `${g.players[p].name} discovered ${resource}${tile.number ? ` (${tile.number})` : ""}.`,
    );
    if (resource === "gold") g.goldClaims[p] = (g.goldClaims[p] ?? 0) + 1;
    else if (
      RESOURCES.includes(resource as Resource) &&
      g.bank[resource as Resource] > 0
    ) {
      g.bank[resource as Resource]--;
      g.players[p].hand[resource as Resource]++;
      log(g, `${g.players[p].name} received 1 ${resource} for exploring.`);
    }
  }
  if (
    Object.keys(g.goldClaims).length &&
    resourceTotal(g.bank) > 0 &&
    g.phase !== "gold"
  ) {
    g.goldResume = g.phase;
    g.phase = "gold";
  } else if (!resourceTotal(g.bank)) g.goldClaims = {};
}
// A counteroffer from an opponent is already their consent to its terms;
// the active player chooses whether to execute it. Other offers await responses.
function closeTradeOffer(g: Game, id: number) {
  const closed = new Set([id]);
  for (const o of g.offers)
    if (o.replyTo !== null && closed.has(o.replyTo)) closed.add(o.id);
  g.offers = g.offers.filter((o) => !closed.has(o.id));
}
function performAction(
  g: Game,
  p: number,
  a: Action,
  rng = secureRandom,
  now = Date.now(),
) {
  requireRule(g.players[p], "You are not seated in this room.");
  requireRule(a && typeof a.type === "string", "Invalid move.");
  if (a.type === "tradePreference") {
    requireRule(
      typeof a.autoReject === "boolean",
      "Choose an automatic trade response preference.",
    );
    g.players[p].autoRejectTrades = a.autoReject;
    for (const o of g.offers) {
      if (
        p === tradeExecutor(o, g.active) ||
        p === o.from ||
        !tradeEligible(g, o, p) ||
        o.accepted.includes(p) ||
        o.rejected.includes(p) ||
        o.blocked.includes(p)
      )
        continue;
      o.responseDeadlines[p] = a.autoReject
        ? initializeTrade(g, o, p, now, rng)
        : null;
    }
    return;
  }
  if (a.type === "embargo") {
    requireRule(
      !["lobby", "finished"].includes(g.phase),
      "Trade blocking is available during a game.",
    );
    requireRule(
      typeof a.to === "number" &&
        Number.isInteger(a.to) &&
        a.to >= 0 &&
        a.to < g.players.length &&
        a.to !== p &&
        typeof a.blocked === "boolean",
      "Choose another player and a trade-blocking status.",
    );
    g.players[p].embargoes = g.players[p].embargoes.filter((i) => i !== a.to);
    if (a.blocked) g.players[p].embargoes.push(a.to);
    return;
  }
  if (a.type === "specialBuild") {
    requireRule(
      g.boardPlayers > 4 && g.mode !== "rush",
      "Special building is available on expanded turn-based tables.",
    );
    requireRule(
      g.turn > 0 && !["lobby", "finished"].includes(g.phase),
      "Special building requests are available after opening placements.",
    );
    requireRule(
      typeof a.requested === "boolean",
      "Choose a special building request status.",
    );
    g.specialRequests = g.specialRequests.filter((seat) => seat !== p);
    if (a.requested) g.specialRequests.push(p);
    return;
  }
  if (
    a.type === "resign" ||
    (a.type === "chat" && a.text?.trim() === "/resign")
  ) {
    requireRule(
      g.mode === "duel" &&
        g.players.length === 2 &&
        !["lobby", "finished"].includes(g.phase),
      "You can resign during an active 1v1 game.",
    );
    g.resignedBy = p;
    g.winner = 1 - p;
    g.phase = "finished";
    g.offers = [];
    log(g, `${g.players[p].name} resigned. ${g.players[g.winner].name} wins!`);
    return;
  }
  if (a.type === "chat") {
    requireRule(
      typeof a.text === "string" &&
        a.text.trim().length > 0 &&
        a.text.length <= 240,
      "Chat must be 1–240 characters.",
    );
    g.chat.push({ name: g.players[p].name, text: a.text.trim() });
    g.chat = g.chat.slice(-80);
    return;
  }
  if (g.phase === "lobby") {
    if (a.type === "color") {
      requireRule(
        Number.isInteger(a.color) && a.color! >= 0 && a.color! < MAX_PLAYERS,
        "Choose a valid color.",
      );
      requireRule(
        !g.players.some((seat, i) => i !== p && seat.color === a.color),
        "That color is already taken.",
      );
      g.players[p].color = a.color!;
      return;
    }
    if (a.type === "nickname") {
      requireRule(
        typeof a.text === "string" &&
          a.text.trim().length > 0 &&
          a.text.length <= 24,
        "Choose a name with 1–24 characters.",
      );
      const old = g.players[p].name;
      g.players[p].name = a.text.trim();
      log(g, `${old} is now ${g.players[p].name}.`);
      return;
    }
    if (a.type === "ready") {
      g.players[p].ready = !g.players[p].ready;
      return;
    }
    requireRule(p === 0, "Only the host can change this room.");
    if (a.type === "addBot") {
      requireRule(
        g.mode !== "solo" && !g.ranked && !g.matchmaking,
        "Bots are available in unranked multiplayer rooms.",
      );
      const bot = player(
        crypto.randomUUID(),
        `Bot ${g.players.filter((seat) => seat.bot).length + 1}`,
      );
      bot.bot = true;
      bot.ready = true;
      addPlayer(g, bot);
      return;
    }
    if (a.type === "remove") {
      requireRule(
        Number.isInteger(a.id) && a.id! > 0 && a.id! < g.players.length,
        "Choose a player to remove.",
      );
      g.players.splice(a.id!, 1);
      refreshLobbyBoard(g, g.players.length + 1);
      return;
    }
    if (a.type === "settings") {
      const nextMode = a.mode ?? g.mode;
      requireRule(
        AVAILABLE_GAME_MODES.includes(nextMode),
        "Choose an available game mode.",
      );
      const switching = nextMode !== g.mode;
      const nextScenario = a.scenario ?? (switching ? "newShores" : g.scenario);
      requireRule(
        SEAFARERS_SCENARIOS.includes(nextScenario) &&
          (a.scenario === undefined || usesSeafarers(nextMode)),
        "Choose an available Voyages scenario.",
      );
      const scenarioSwitching = nextScenario !== g.scenario;
      const nextCapacity =
        a.capacity ??
        (switching
          ? nextMode === "solo"
            ? 1
            : nextMode === "duel"
              ? 2
              : 4
          : g.capacity);
      const nextMap =
        a.map ??
        (switching || !baseMapAvailable(g.map, nextMode, nextCapacity)
          ? defaultBaseMap(nextMode)
          : g.map);
      requireRule(
        a.map !== null && baseMapAvailable(nextMap, nextMode, nextCapacity),
        "Choose an available map for this mode and player count.",
      );
      const mapSwitching = nextMap !== g.map;
      requireRule(
        Number.isInteger(nextCapacity) &&
          nextCapacity >= g.players.length &&
          (nextMode === "solo"
            ? nextCapacity === 1
            : nextMode === "duel"
              ? nextCapacity === 2
              : nextCapacity >= (nextMode === "base" ? 2 : 3) &&
                nextCapacity <=
                  (usesSeafarers(nextMode) || usesCitiesKnights(nextMode)
                    ? 6
                    : MAX_PLAYERS)),
        "Choose one seat for Solo Practice, two seats for 1v1, 2–12 for Base, 3–12 for Rush, or 3–6 for expansions, enough for everyone seated.",
      );
      if (a.diceMode !== undefined)
        requireRule(
          a.diceMode === "random" || a.diceMode === "balanced",
          "Choose random or balanced dice.",
        );
      if (a.target !== undefined)
        requireRule(
          Number.isInteger(a.target) && a.target >= 3 && a.target <= 20,
          "Choose 3–20 victory points.",
        );
      if (a.discardLimit !== undefined)
        requireRule(
          Number.isInteger(a.discardLimit) &&
            a.discardLimit >= 5 &&
            a.discardLimit <= 20,
          "Choose a discard limit from 5–20.",
        );
      if (a.turnSeconds !== undefined)
        requireRule(
          nextMode === "rush" ? RUSH_SPEEDS.includes(a.turnSeconds) : validTurnSeconds(a.turnSeconds),
          "Choose an available turn timer.",
        );
      if (a.text !== undefined)
        requireRule(
          typeof a.text === "string" &&
            a.text.trim().length > 0 &&
            a.text.length <= 40,
          "Choose a room name with 1–40 characters.",
        );
      for (const field of ["public", "friendlyRobber", "hideBank"] as const)
        if (a[field] !== undefined)
          requireRule(typeof a[field] === "boolean", "Invalid room setting.");
      const before = JSON.stringify([
        g.mode,
        g.scenario,
        g.map,
        g.diceMode,
        g.target,
        g.capacity,
        g.discardLimit,
        g.friendlyRobber,
        g.hideBank,
        g.turnSeconds,
      ]);
      if (switching) {
        g.mode = nextMode;
        g.target =
          nextMode === "duel"
            ? 15
            : usesSeafarers(nextMode)
              ? scenarioTarget(nextScenario, usesCitiesKnights(nextMode))
              : usesCitiesKnights(nextMode)
                ? 13
                : 10;
        g.discardLimit = ["duel", "rush"].includes(nextMode) ? 9 : 7;
        g.friendlyRobber = false;
        g.turnSeconds =
          nextMode === "solo"
            ? 0
            : nextMode === "rush"
              ? 5
              : nextMode === "duel"
                ? 30
                : 60;
        g.diceMode = nextMode === "duel" ? "balanced" : "random";
      }
      g.scenario = nextScenario;
      g.map = nextMap;
      if (scenarioSwitching && usesSeafarers(nextMode))
        g.target = scenarioTarget(nextScenario, usesCitiesKnights(nextMode));
      if (a.diceMode !== undefined) g.diceMode = a.diceMode;
      if (a.target !== undefined) g.target = a.target;
      if (a.discardLimit !== undefined) g.discardLimit = a.discardLimit;
      if (a.turnSeconds !== undefined) g.turnSeconds = a.turnSeconds;
      if (a.friendlyRobber !== undefined) g.friendlyRobber = a.friendlyRobber;
      if (a.hideBank !== undefined) g.hideBank = a.hideBank;
      if (a.public !== undefined) g.public = a.public;
      if (a.text !== undefined) g.title = a.text.trim();
      if (
        switching ||
        scenarioSwitching ||
        mapSwitching ||
        nextCapacity !== g.capacity
      ) {
        g.capacity = nextCapacity;
        refreshLobbyBoard(g);
      }
      if (
        before !==
        JSON.stringify([
          g.mode,
          g.scenario,
          g.map,
          g.diceMode,
          g.target,
          g.capacity,
          g.discardLimit,
          g.friendlyRobber,
          g.hideBank,
          g.turnSeconds,
        ])
      ) {
        g.players.forEach((seat) => (seat.ready = seat.bot === true));
        log(g, "The host changed the rules. Please ready up again.");
      }
      return;
    }
    if (a.type === "start") {
      start(g, now, rng);
      return;
    }
    throw new Error("That action is unavailable in the lobby.");
  }
  requireRule(g.phase !== "finished", "This game is finished.");
  if (
    performCitiesAction(
      g,
      p,
      a,
      {
        awards,
        checkWin,
        beginRobber: (game, resume, kind) => beginRobber(game, resume, kind, rng),
        endTurn,
        points,
        legalRobberTiles,
        legalPirateTiles,
        discoverFog,
      },
      rng,
    )
  )
    return;
  if (a.type === "gold") {
    requireRule(
      g.phase === "gold" && g.goldClaims[p] > 0,
      "You do not need to choose gold resources.",
    );
    const h = validateHand(a.resources, g),
      amount = Math.min(g.goldClaims[p], resourceTotal(g.bank));
    requireRule(
      resourceTotal(h) === amount &&
        GOODS.every((r) => RESOURCES.includes(r as Resource) || !h[r]) &&
        RESOURCES.every((r) => h[r] <= g.bank[r]),
      `Choose exactly ${amount} available resources.`,
    );
    for (const r of RESOURCES) {
      g.bank[r] -= h[r];
      g.players[p].hand[r] += h[r];
    }
    delete g.goldClaims[p];
    appendResourceReceipt(g, p, h, "gold");
    if (!resourceTotal(g.bank)) g.goldClaims = {};
    if (!Object.keys(g.goldClaims).length) g.phase = g.goldResume;
    checkWin(g);
    return;
  }
  if (a.type === "discard") {
    requireRule(
      g.phase === "discard" && g.discards[p] > 0,
      "You do not need to discard.",
    );
    const h = validateHand(a.resources, g);
    requireRule(
      total(h) === g.discards[p],
      "Discard exactly half your cards, rounded down.",
    );
    requireRule(
      gameGoods(g).every((r) => (h[r] ?? 0) <= (g.players[p].hand[r] ?? 0)),
      "You do not own those cards.",
    );
    pay(g, p, h);
    delete g.discards[p];
    log(g, `${g.players[p].name} discarded ${total(h)} resources.`);
    if (!Object.keys(g.discards).length) beginRobber(g, "action", undefined, rng);
    return;
  }
  if (
    ["accept", "reject", "prepareCounter", "completeTrade"].includes(a.type)
  ) {
    requireRule(g.phase === "action", "Trading is available after rolling.");
    const offer = g.offers.find((o) => o.id === a.id);
    requireRule(offer, "This offer is unavailable.");
    const executor = tradeExecutor(offer, g.active);
    if (a.type === "completeTrade") {
      requireRule(
        p === executor,
        "Only the offer's executor can confirm a trade.",
      );
      const partner =
        a.to ?? (executor !== offer.from ? offer.from : undefined);
      requireRule(
        typeof partner === "number" &&
          partner !== p &&
          tradePartners(g, offer).includes(partner) &&
          ((executor !== offer.from && partner === offer.from) ||
            offer.accepted.includes(partner)),
        "Choose a player who accepted this offer.",
      );
      requireRule(
        !tradeBlocked(g, p, partner),
        "Trading with this player is blocked.",
      );
      requireRule(
        g.rush ||
          offer.from === g.active ||
          partner === g.active ||
          executor === g.active,
        "A trade must involve the active player.",
      );
      requireRule(
        total(offer.give) > 0 && total(offer.want) > 0,
        "Set both sides of an open-ended offer before trading.",
      );
      const recipient = executor === offer.from ? partner : executor;
      const sender = executor === offer.from ? offer.from : partner;
      requireRule(
        affordable(g, sender, offer.give) &&
          affordable(g, recipient, offer.want),
        "Someone no longer has the offered cards.",
      );
      for (const r of gameGoods(g)) {
        const difference = (offer.want[r] ?? 0) - (offer.give[r] ?? 0);
        g.players[sender].hand[r] =
          (g.players[sender].hand[r] ?? 0) + difference;
        g.players[recipient].hand[r] =
          (g.players[recipient].hand[r] ?? 0) - difference;
      }
      recordCardFeedback(g, "trade", gameGoods(g).flatMap(card => [
        { card, amount: offer.give[card] ?? 0, from: { type: "player", seat: sender }, to: { type: "player", seat: recipient } },
        { card, amount: offer.want[card] ?? 0, from: { type: "player", seat: recipient }, to: { type: "player", seat: sender } },
      ]));
      log(
        g,
        `${g.players[sender].name} traded ${formatResourceCards(offer.give)} for ${formatResourceCards(offer.want)} with ${g.players[recipient].name}.`,
      );
      if (g.rush) closeTradeOffer(g, offer.id);
      else g.offers = [];
      checkWin(g);
      return;
    }
    requireRule(tradeEligible(g, offer, p), "This offer is unavailable.");
    const partner = p === executor ? offer.from : executor;
    requireRule(
      !tradeBlocked(g, p, partner),
      "Trading with this player is blocked.",
    );
    if (a.type === "prepareCounter") {
      requireRule(
        typeof a.preparing === "boolean",
        "Choose a counteroffer status.",
      );
      if (a.preparing) {
        requireRule(
          total(g.players[p].hand) > 0,
          "You need cards in hand to propose a counteroffer.",
        );
      }
      offer.preparing = offer.preparing.filter((id) => id !== p);
      if (a.preparing) {
        offer.preparing.push(p);
        offer.preparingUntil[p] = now + 45000;
        offer.accepted = offer.accepted.filter((id) => id !== p);
        offer.rejected = offer.rejected.filter((id) => id !== p);
        offer.expired = offer.expired.filter((id) => id !== p);
        offer.closeAt = null;
      } else {
        delete offer.preparingUntil[p];
        if (p !== executor && !offer.accepted.includes(p))
          offer.responseDeadlines[p] = initializeTrade(g, offer, p, now, rng);
      }
      return;
    }
    if (a.type === "reject" && p === executor && offer.from !== p) {
      closeTradeOffer(g, offer.id);
      return;
    }
    requireRule(
      p !== executor,
      "Confirm this counteroffer to complete the trade.",
    );
    if (a.type === "reject") {
      offer.preparing = offer.preparing.filter((id) => id !== p);
      offer.accepted = offer.accepted.filter((id) => id !== p);
      offer.expired = offer.expired.filter((id) => id !== p);
      delete offer.responseDeadlines[p];
      delete offer.preparingUntil[p];
      if (!offer.rejected.includes(p)) offer.rejected.push(p);
      return;
    }
    requireRule(
      g.rush ||
        offer.from === g.active ||
        p === g.active ||
        executor === g.active,
      "A trade must involve the active player.",
    );
    requireRule(
      executor === offer.from
        ? affordable(g, executor, offer.give) && affordable(g, p, offer.want)
        : affordable(g, executor, offer.want) && affordable(g, p, offer.give),
      "Someone no longer has the offered cards.",
    );
    requireRule(
      total(offer.give) > 0 && total(offer.want) > 0,
      "Make a counteroffer to fill the open side of this trade.",
    );
    offer.preparing = offer.preparing.filter((id) => id !== p);
    offer.rejected = offer.rejected.filter((id) => id !== p);
    offer.expired = offer.expired.filter((id) => id !== p);
    delete offer.responseDeadlines[p];
    delete offer.preparingUntil[p];
    if (!offer.accepted.includes(p)) offer.accepted.push(p);
    return;
  }
  if (["offer", "editOffer", "counterOffer"].includes(a.type)) {
    requireRule(g.phase === "action", "Trading is available after rolling.");
    requireRule(
      g.rush || a.type !== "offer" || p === g.active,
      "Only the active player can initiate player trades. Respond to their offer instead.",
    );
    const give = validateHand(a.give, g),
      want = validateHand(a.want, g);
    requireRule(
      total(give) > 0 || total(want) > 0,
      "Choose at least one resource for your offer.",
    );
    requireRule(
      affordable(g, p, give),
      "You do not own the offered resources.",
    );
    requireRule(
      total(g.players[p].hand) > 0,
      "You need cards in hand to offer a trade.",
    );
    const previous = g.offers.find((o) => o.id === a.id);
    let replyTo: number | null = null;
    let targets =
      p === g.active
        ? a.targets === undefined
          ? a.to === undefined || a.to === null
            ? null
            : [a.to]
          : a.targets
        : [g.active];
    if (a.type === "editOffer") {
      requireRule(previous?.from === p, "You can only edit your own offer.");
      requireRule(
        g.rush || p === g.active || previous.replyTo !== null,
        "Only the active player can initiate player trades. Respond to their offer instead.",
      );
      replyTo = previous.replyTo;
      targets =
        previous.replyTo !== null ||
        p !== g.active ||
        (a.targets === undefined && a.to === undefined)
          ? previous.targets
          : a.targets === undefined
            ? a.to === null
              ? null
              : [a.to!]
            : a.targets;
    } else if (a.type === "counterOffer") {
      requireRule(
        previous && tradeEligible(g, previous, p),
        "This offer is unavailable.",
      );
      requireRule(
        g.rush ||
          previous.from === g.active ||
          p === g.active ||
          tradeExecutor(previous, g.active) === g.active,
        "A counteroffer must involve the active player.",
      );
      replyTo = previous.id;
      targets =
        g.rush || tradeExecutor(previous, g.active) === g.active
          ? previous.targets
          : [previous.from];
      const executor = g.rush
        ? tradeExecutor(previous, g.active)
        : p === g.active
          ? p
          : g.active;
      requireRule(
        !tradeBlocked(g, p, executor === p ? previous.from : executor),
        "Trading with this player is blocked.",
      );
    }
    requireRule(
      targets === null ||
        (Array.isArray(targets) &&
          targets.length > 0 &&
          targets.length < g.players.length &&
          new Set(targets).size === targets.length &&
          targets.every(
            (i) =>
              Number.isInteger(i) &&
              i >= 0 &&
              i < g.players.length &&
              i !==
                (g.rush && replyTo !== null
                  ? tradeExecutor(previous!, g.active)
                  : replyTo !== null && p !== g.active
                    ? g.active
                    : p),
          )),
      "Choose a valid trading partner.",
    );
    requireRule(
      g.offers.length < 24 || a.type === "editOffer",
      "Close an offer before making another.",
    );
    const next: Offer = {
      ...(g.rush
        ? {
            executor: replyTo !== null ? tradeExecutor(previous!, g.active) : p,
          }
        : {}),
      id: g.offerSeq + 1,
      from: p,
      to:
        replyTo !== null && p !== g.active
          ? g.active
          : targets?.length === 1
            ? targets[0]
            : null,
      give: { ...give },
      want: { ...want },
      rejected: [],
      accepted: [],
      preparing: [],
      replyTo,
      targets: targets === null ? null : [...targets],
      blocked: [],
      expired: [],
      responseDeadlines: {},
      preparingUntil: {},
      closeAt: null,
      pausedAt: null,
    };
    requireRule(
      tradePartners(g, next).some(
        (i) => !tradeBlocked(g, tradeExecutor(next, g.active), i),
      ),
      "No trading partners are available. Unblock a player to trade.",
    );
    for (const i of tradePartners(g, next))
      if (i !== p && !tradeBlocked(g, tradeExecutor(next, g.active), i))
        next.responseDeadlines[i] = initializeTrade(g, next, i, now, rng);
    if (a.type === "editOffer") closeTradeOffer(g, previous!.id);
    if (a.type === "counterOffer") {
      previous!.preparing = previous!.preparing.filter((id) => id !== p);
      delete previous!.preparingUntil[p];
    }
    g.offerSeq++;
    g.offers.push(next);
    if (replyTo === null && (g.players[p].bot || g.botPlayers.includes(p))) {
      const memory = g.botTradeMemory?.[p];
      const signatures = memory?.turn === g.turn ? memory.signatures : [];
      const signature = JSON.stringify([next.give, next.want, next.targets]);
      g.botTradeMemory ??= {};
      g.botTradeMemory[p] = {
        turn: g.turn,
        attempts: (memory?.turn === g.turn ? memory.attempts : 0) + 1,
        signatures: [...signatures, signature],
        startedAt: now,
      };
    }
    return;
  }
  if (a.type === "cancelOffer") {
    requireRule(
      g.offers.some((o) => o.id === a.id && o.from === p),
      "You can only close your own offer.",
    );
    closeTradeOffer(g, a.id!);
    return;
  }
  requireRule(p === actor(g), "It is another player’s turn.");
  if (a.type === "settlement") {
    const setup = g.phase === "setupSettlement";
    requireRule(
      setup || ["action", "special"].includes(g.phase),
      "You cannot build a settlement now.",
    );
    requireRule(
      legalSettlements(g, p, setup).includes(a.id!),
      "Choose a highlighted legal intersection.",
    );
    if (!setup) pay(g, p, COSTS.settlement);
    const v = g.board.vertices[a.id!];
    if (usesSeafarers(g.mode) && g.scenario !== "fogIslands") {
      const island = v.tiles
        .map((id) => g.board.tiles[id])
        .find((t) => t.resource !== "sea" && t.resource !== "desert")?.island;
      if (island !== undefined && !g.players[p].islands.includes(island)) {
        g.players[p].islands.push(island);
        if (
          !setup &&
          (g.scenario === "fourIslands" ||
            !v.tiles.some((id) => g.board.tiles[id].home))
        ) {
          g.players[p].islandBonus += 2;
          log(
            g,
            `${g.players[p].name} reached a new ${g.scenario === "throughDesert" ? "region" : "island"} for 2 bonus points.`,
          );
        }
      }
    }
    v.owner = p;
    if (setup && g.cities && g.setupStep >= g.players.length) v.city = true;
    log(g, `${g.players[p].name} built a ${v.city ? "city" : "settlement"}.`);
    if (setup) {
      g.setupVertex = v.id;
      g.phase = "setupRoad";
      if (g.setupStep >= g.players.length) {
        const startingCards: CardTransfer[] = [];
        const received = emptyHand();
        for (const tid of v.tiles) {
          const r = g.board.tiles[tid].resource;
          if (r === "gold") g.goldClaims[p] = (g.goldClaims[p] ?? 0) + 1;
          else if (RESOURCES.includes(r as Resource) && g.bank[r as Resource]) {
            g.bank[r as Resource]--;
            g.players[p].hand[r as Resource]++;
            received[r as Resource]++;
            startingCards.push({ card: r as Resource, amount: 1, from: { type: "tile", tile: tid }, to: { type: "player", seat: p } });
          }
        }
        appendResourceReceipt(g, p, received);
        recordCardFeedback(g, "setup", startingCards);
      }
      if (Object.keys(g.goldClaims).length && resourceTotal(g.bank) > 0) {
        g.goldResume = "setupRoad";
        g.phase = "gold";
      }
    }
    awards(g);
    checkWin(g);
    return;
  }
  if (a.type === "moveShip") {
    requireRule(
      Number.isInteger(a.id) &&
        Number.isInteger(a.to) &&
        shipDestinations(g, p, a.id!).includes(a.to!),
      "Choose an open ship from a previous turn and a legal destination.",
    );
    g.board.edges[a.to!].owner = p;
    g.board.edges[a.to!].kind = "ship";
    g.board.edges[a.to!].built = g.turn;
    g.board.edges[a.id!].owner = null;
    delete g.board.edges[a.id!].kind;
    delete g.board.edges[a.id!].built;
    g.shipMoved = true;
    log(g, `${g.players[p].name} moved a ship.`);
    discoverFog(g, p, a.to!);
    awards(g);
    checkWin(g);
    return;
  }
  if (a.type === "road" || a.type === "ship") {
    const ship = a.type === "ship";
    const setup = g.phase === "setupRoad",
      free = g.phase === "roadBuilding";
    requireRule(
      setup || free || ["action", "special"].includes(g.phase),
      "You cannot build a route now.",
    );
    requireRule(
      (ship ? legalShips(g, p, setup) : legalRoads(g, p, setup)).includes(
        a.id!,
      ),
      "Choose a highlighted legal route.",
    );
    if (!setup && !free) pay(g, p, ship ? COSTS.ship : COSTS.road);
    g.board.edges[a.id!].owner = p;
    g.board.edges[a.id!].kind = ship ? "ship" : "road";
    g.board.edges[a.id!].built = g.turn;
    log(g, `${g.players[p].name} built a ${ship ? "ship" : "road"}.`);
    if (setup) {
      g.setupStep++;
      g.setupVertex = null;
      if (g.setupStep === g.players.length * 2) {
        g.active = seatsInTurnOrder(g)[0];
        g.turn = 1;
        g.phase = "roll";
      } else {
        g.active = seatsInTurnOrder(g)[
          g.setupStep < g.players.length
            ? g.setupStep
            : 2 * g.players.length - 1 - g.setupStep];
        g.phase = "setupSettlement";
      }
    }
    if (free) {
      g.freeRoads--;
      if (!g.freeRoads) g.phase = g.resume;
    }
    discoverFog(g, p, a.id!);
    if (
      free &&
      g.freeRoads &&
      !legalRoads(g, p).length &&
      !legalShips(g, p).length
    ) {
      g.freeRoads = 0;
      if (g.phase === "gold") g.goldResume = g.resume;
      else g.phase = g.resume;
    }
    awards(g);
    checkWin(g);
    return;
  }
  if (a.type === "city") {
    requireRule(
      ["action", "special"].includes(g.phase),
      "You cannot build a city now.",
    );
    requireRule(
      legalCities(g, p).includes(a.id!),
      "Choose one of your settlements to upgrade.",
    );
    pay(g, p, COSTS.city);
    g.board.vertices[a.id!].city = true;
    log(g, `${g.players[p].name} built a city.`);
    checkWin(g);
    return;
  }
  if (a.type === "buyDev") {
    requireRule(
      ["action", "special"].includes(g.phase),
      "You cannot buy a development card now.",
    );
    requireRule(g.deck.length, "The development deck is empty.");
    pay(g, p, COSTS.development);
    g.players[p].dev.push({ kind: g.deck.pop()!, bought: g.turn });
    recordCardFeedback(g, "purchase", [{ card: "development", amount: 1, from: { type: "bank" }, to: { type: "player", seat: p } }]);
    log(g, `${g.players[p].name} bought a development card.`);
    checkWin(g);
    return;
  }
  if (a.type === "roll") {
    requireRule(g.phase === "roll", "You have already rolled.");
    g.dice =
      g.diceMode === "balanced"
        ? drawBalancedDice(g.diceState, p, g.players.length, rng)
        : [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
    const sum = g.dice[0] + g.dice[1];
    g.rollCounts[sum] = (g.rollCounts[sum] ?? 0) + 1;
    log(g, `${g.players[p].name} rolled ${sum}.`);
    if (sum === 7) {
      log(g, "No resources produced on a seven.");
      g.discards = {};
      g.players.forEach((pl, i) => {
        if (total(pl.hand) > g.discardLimit)
          g.discards[i] = Math.floor(total(pl.hand) / 2);
      });
      if (Object.keys(g.discards).length) g.phase = "discard";
      else beginRobber(g, "action", undefined, rng);
    } else {
      distribute(g, sum);
      g.goldResume = "action";
      if (!resourceTotal(g.bank)) g.goldClaims = {};
      g.phase = Object.keys(g.goldClaims).length ? "gold" : "action";
    }
    return;
  }
  if (a.type === "robber") {
    requireRule(g.phase === "robber", "You do not need to move the robber.");
    requireRule(
      Number.isInteger(a.id) && legalRobberTiles(g).includes(a.id!),
      g.friendlyRobber
        ? "Friendly robber protects tiles next to players with two or fewer visible points."
        : "Move the robber to another tile.",
    );
    moveRobber(g, a.id!, rng);
    return;
  }
  if (a.type === "pirate") {
    requireRule(
      g.phase === "robber" &&
        Number.isInteger(a.id) &&
        legalPirateTiles(g).includes(a.id!),
      "Move the pirate to another legal sea tile.",
    );
    movePirate(g, a.id!, rng);
    return;
  }
  if (a.type === "steal") {
    requireRule(
      g.phase === "steal" && g.victims.includes(a.id!),
      "Choose a player next to the robber.",
    );
    stealCard(g, a.id!, rng);
    return;
  }
  if (a.type === "bankTrade") {
    requireRule(
      g.phase === "action",
      "Bank trading is available on your normal turn after rolling.",
    );
    const give = validateHand(a.give, g),
      want = validateHand(a.want, g);
    requireRule(
      total(want) === 1 &&
        gameGoods(g).filter((r) => (give[r] ?? 0) > 0).length === 1,
      "Trade one resource type for one card.",
    );
    const from = gameGoods(g).find((r) => (give[r] ?? 0) > 0)!,
      to = gameGoods(g).find((r) => (want[r] ?? 0) > 0)!;
    requireRule(
      from !== to && give[from] === bankRate(g, p, from),
      "Use the exchange rate from your ports.",
    );
    requireRule((g.bank[to] ?? 0) >= 1, "The bank has none of that resource.");
    pay(g, p, give);
    g.bank[to] = (g.bank[to] ?? 0) - 1;
    g.players[p].hand[to] = (g.players[p].hand[to] ?? 0) + 1;
    recordCardFeedback(g, "bank", [
      { card: from, amount: give[from] ?? 0, from: { type: "player", seat: p }, to: { type: "bank" } },
      { card: to, amount: 1, from: { type: "bank" }, to: { type: "player", seat: p } },
    ]);
    log(g, `${g.players[p].name} traded ${give[from]} ${from} for ${to}.`);
    return;
  }
  if (["knight", "roadBuilding", "plenty", "monopoly"].includes(a.type)) {
    requireRule(
      ["roll", "action"].includes(g.phase),
      "Play development cards only on your normal turn.",
    );
    const resume = g.phase as "roll" | "action";
    if (a.type === "plenty") {
      const h = validateHand(a.resources);
      requireRule(
        total(h) === 2 && RESOURCES.every((r) => h[r] <= g.bank[r]),
        "Choose two available resources from the bank.",
      );
      spendDev(g, p, "plenty");
      for (const r of RESOURCES) {
        g.bank[r] -= h[r];
        g.players[p].hand[r] += h[r];
      }
      log(
        g,
        `${g.players[p].name} picked ${RESOURCES.filter((r) => h[r])
          .map((r) => `${h[r]} ${r}`)
          .join(" and ")} with Year of Plenty.`,
      );
    }
    if (a.type === "monopoly") {
      requireRule(RESOURCES.includes(a.resource!), "Choose a resource.");
      spendDev(g, p, "monopoly");
      let n = 0;
      g.players.forEach((pl, i) => {
        if (i !== p) {
          n += pl.hand[a.resource!];
          pl.hand[a.resource!] = 0;
        }
      });
      g.players[p].hand[a.resource!] += n;
      log(
        g,
        `${g.players[p].name} chose ${a.resource} with Monopoly and collected ${n} ${a.resource}.`,
      );
    }
    if (a.type === "knight") {
      spendDev(g, p, "knight");
      g.players[p].knights++;
      awards(g);
      beginRobber(g, resume, undefined, rng);
    }
    if (a.type === "roadBuilding") {
      requireRule(
        legalRoads(g, p).length || legalShips(g, p).length,
        "There are no legal routes available.",
      );
      spendDev(g, p, "roadBuilding");
      g.freeRoads = Math.min(
        2,
        15 -
          pieces(g, p).road +
          (usesSeafarers(g.mode) ? 15 - pieces(g, p).ship : 0),
      );
      g.resume = resume;
      g.phase = "roadBuilding";
    }
    log(
      g,
      `${g.players[p].name} played ${a.type === "plenty" ? "Year of Plenty" : a.type === "roadBuilding" ? "Road Building" : a.type}.`,
    );
    checkWin(g);
    return;
  }
  if (a.type === "skipRoads") {
    requireRule(g.phase === "roadBuilding", "You are not placing free roads.");
    requireRule(
      !legalRoads(g, p).length && !legalShips(g, p).length,
      "Place your remaining free routes before continuing.",
    );
    g.freeRoads = 0;
    g.phase = g.resume;
    return;
  }
  if (a.type === "end") {
    requireRule(
      g.phase === "action",
      "Finish the current action before ending your turn.",
    );
    endTurn(g);
    return;
  }
  if (a.type === "pass") {
    requireRule(
      g.phase === "special",
      "You are not in the special building phase.",
    );
    nextSpecial(g);
    return;
  }
  throw new Error("Unknown action.");
}
export const TURN_SPEEDS = [0, 15, 30, 60, 120, 200];
export function moveContext(
  g: Pick<Game, "phase" | "turn" | "active" | "specialPlayer" | "setupStep"> & {
    citiesChoiceSeq?: number;
    rush?: RushState | null;
    me?: number;
    pause?: TablePause;
  },
  seat = g.me,
) {
  if (
    g.rush &&
    !g.phase.startsWith("setup") &&
    !["lobby", "finished"].includes(g.phase)
  ) {
    const personalPhase =
      g.phase === "discard"
        ? "discard"
        : seat === g.rush.robberOwner
          ? g.rush.robberStep
          : g.rush.seats[seat ?? -1]?.freeRoads
            ? "roadBuilding"
            : "action";
    return `${g.turn}:rush:${personalPhase}:${seat ?? "-"}:${g.rush.seats[seat ?? -1]?.sequence ?? 0}${g.pause?.sequence ? `:pause:${g.pause.sequence}` : ""}`;
  }
  return `${g.turn}:${g.phase}:${g.active}:${g.specialPlayer ?? "-"}:${g.setupStep}${g.phase === "citiesChoice" ? `:${g.citiesChoiceSeq}` : ""}${g.pause?.sequence ? `:pause:${g.pause.sequence}` : ""}`;
}
// Existing published rooms keep their original rules and untimed behavior.
export function normalizeGame(g: Game) {
  g.replaySequence ??= 0;
  g.replayComplete ??= false;
  g.cities ??= null;
  g.citiesFlow ??= null;
  g.citiesChoiceSeq ??= 0;
  g.scenario ??= "newShores";
  g.mode ??= g.capacity === 2 ? "duel" : "base";
  g.botPlayers ??= [];
  g.botDueAt ??= 0;
  g.botFastForward = g.botFastForward === true && isBotPracticeGame(g);
  g.logDetails ??= g.log.map(() => null);
  g.boardPlayers ??= g.phase === "lobby" ? boardPlayerCount(g) : g.capacity;
  if (g.statistics === undefined) {
    g.statistics =
      g.phase === "lobby" ? null : createMatchStatistics(g, g.updated, false);
    if (g.phase === "finished" && g.statistics)
      g.statistics.finishedAt = g.updated;
  }
  g.map ??= "base";
  g.rush ??= null;
  g.diceMode ??= "random";
  g.diceState ??= createBalancedDice();
  g.resignedBy ??= null;
  g.specialRequests ??= g.specialPlayer !== null ? [...g.specialQueue] : [];
  g.shipMoved ??= false;
  g.goldClaims ??= {};
  g.goldResume ??= "action";
  g.fogDeck ??= [];
  g.fogNumbers ??= [];
  g.discardLimit ??= 7;
  g.friendlyRobber ??= false;
  g.hideBank ??= false;
  g.turnSeconds ??= 0;
  g.deadline ??= null;
  g.clockKey ??= null;
  g.clockResume ??= null;
  g.pause ??= createTablePause();
  g.pause.until = null;
  g.pauseCooldowns ??= {};
  g.offers.forEach((o) => {
    o.accepted ??= [];
    o.preparing ??= [];
    o.replyTo ??= null;
    if (o.targets === undefined)
      o.targets =
        o.replyTo !== null && o.from !== g.active
          ? null
          : o.to === null
            ? null
            : [o.to];
    o.blocked ??= [];
    o.expired ??= [];
    o.responseDeadlines ??= {};
    o.preparingUntil ??= {};
    o.closeAt ??= null;
    o.pausedAt ??= null;
  });
  g.players.forEach((seat, i) => {
    seat.color ??= i;
    seat.avatar = normalizeAvatar(seat.avatar);
    seat.islandBonus ??= 0;
    seat.islands ??= [];
    seat.embargoes ??= [];
    seat.autoRejectTrades ??= true;
  });
  return g;
}
function phaseClockKey(g: Game) {
  if (!g.turnSeconds || g.phase === "lobby" || g.phase === "finished")
    return null;
  if (g.phase.startsWith("setup")) return `setup:${g.setupStep}:${g.phase}`;
  return `${g.turn}:${g.phase}:${actor(g)}${g.phase === "citiesChoice" ? `:${g.citiesChoiceSeq}` : ""}`;
}
function phaseSeconds(g: Game) {
  const speed = g.turnSeconds;
  if (g.rush) return RUSH_CHOICE_SECONDS;
  if (g.phase === "setupRoad")
    return ({15: 8, 30: 15, 60: 30, 120: 45, 200: 75, 240: 90, 9000: 4500, 12000: 4500} as Record<number, number>)[speed] ?? Math.max(8, Math.round(speed / 2));
  if (g.phase === "setupSettlement")
    return (
      {
        15: 30,
        30: 60,
        60: 120,
        120: 180,
        200: 300,
        240: 360,
        9000: 18000,
        12000: 18000,
      } as Record<number, number>
    )[speed] ?? Math.round(speed * 2);
  if (g.phase === "roll")
    return (
      {
        15: 5,
        30: 10,
        60: 10,
        120: 20,
        200: 30,
        240: 60,
        9000: 3000,
        12000: 3000,
      } as Record<number, number>
    )[speed] ?? Math.max(5, Math.round(speed / 6));
  if (["action", "special"].includes(g.phase)) return speed;
  if (g.phase === "roadBuilding") return actionBonusSeconds(speed);
  if (g.phase === "discard" && speed === 30) return 15;
  if (speed === 200) return 60;
  return speed >= 9000 ? 3000 : speed / 3;
}
function actionBonusSeconds(speed: number) {
  return ({15: 3, 30: 5, 60: 10, 120: 20, 200: 30, 240: 60, 9000: 3000, 12000: 3000} as Record<number, number>)[speed] ?? Math.max(3, Math.round(speed / 6));
}
function refreshClock(g: Game, now: number) {
  const key = phaseClockKey(g);
  if (!key) {
    g.clockKey = null;
    g.deadline = null;
    g.clockResume = null;
  } else if (g.clockKey !== key || g.deadline === null) {
    g.clockKey = key;
    if (g.clockResume?.phase === g.phase) {
      g.deadline = now + g.clockResume.remaining;
      g.clockResume = null;
    } else g.deadline = now + phaseSeconds(g) * 1000;
  }
}
export function applyAction(
  g: Game,
  p: number,
  a: Action,
  rng = secureRandom,
  now = Date.now(),
) {
  // Expansion effects may replace board/hand references and create choices for
  // several players. Commit the whole room only after the action validates.
  if (g.cities || g.mode === "rush") {
    const draft = structuredClone(g);
    forkReplayCapture(g, draft);
    applyActionInternal(draft, p, a, rng, now);
    Object.assign(g, draft);
    commitReplayCapture(draft, g);
    return;
  }
  applyActionInternal(g, p, a, rng, now);
}
function applyActionInternal(
  g: Game,
  p: number,
  a: Action,
  rng: () => number,
  now: number,
) {
  normalizeGame(g);
  advancePause(g, now);
  requireRule(a && typeof a.type === "string", "Invalid move.");
  if (isPauseAction(a)) {
    performPauseAction(g, p, a, now);
    recordReplayFrame(g, p, a, now);
    return;
  }
  if (g.pause.pausedAt !== null) {
    requireRule(
      a.type === "chat" || a.type === "resign",
      "The game is paused. Vote to resume before making a move.",
    );
    performTrackedAction(g, p, a, rng, now);
    advancePause(g, now);
    if (g.phase === "finished") refreshClock(g, now);
    recordReplayFrame(g, p, a, now);
    return;
  }
  if (a.type === "botSpeed") {
    requireRule(p === 0 && isBotPracticeGame(g), "Only the player in a private bot game can change bot speed.");
    requireRule(!["lobby", "finished"].includes(g.phase), "Bot speed is available during a game.");
    requireRule(typeof a.enabled === "boolean", "Choose whether to fast forward the bots.");
    if (g.botFastForward !== a.enabled) {
      g.botFastForward = a.enabled;
      g.botDueAt = now + botMoveInterval(g);
    }
    recordReplayFrame(g, p, a, now);
    return;
  }
  advanceTrades(g, now, rng);
  if (g.rush && !g.phase.startsWith("setup") && g.phase !== "lobby") {
    performRushAction(g, p, a, rushRules, rng, now);
    advancePause(g, now);
    advanceTrades(g, now, rng);
    refreshRushClock(g);
    recordReplayFrame(g, p, a, now);
    return;
  }
  const beforePhase = g.phase,
    beforeDeadline = g.deadline;
  performTrackedAction(g, p, a, rng, now);
  advancePause(g, now);
  if (g.rush && beforePhase.startsWith("setup") && g.phase === "roll") {
    startRushPlay(g, now);
    recordReplayFrame(g, p, a, now);
    return;
  }
  advanceTrades(g, now, rng);
  if (
    g.turnSeconds &&
    beforeDeadline !== null &&
    ["roll", "action", "special"].includes(beforePhase) &&
    ((["robber", "steal", "roadBuilding"].includes(g.phase) &&
      g.resume === beforePhase) ||
      (g.phase === "gold" && g.goldResume === beforePhase)) &&
    !g.clockResume
  )
    g.clockResume = {
      phase: beforePhase as "roll" | "action" | "special",
      remaining: Math.max(0, beforeDeadline - now),
    };
  if (
    g.turnSeconds &&
    beforeDeadline !== null &&
    ["action", "special"].includes(beforePhase) &&
    g.phase === "citiesChoice" &&
    g.citiesFlow?.kind === "resume" &&
    g.citiesFlow.phase === beforePhase &&
    !g.clockResume
  )
    g.clockResume = {
      phase: beforePhase as "roll" | "action" | "special",
      remaining: Math.max(0, beforeDeadline - now),
    };
  refreshClock(g, now);
  if (g.turnSeconds && beforeDeadline !== null && beforePhase === "action" && g.phase === "action" &&
      ["road", "ship", "settlement", "city", "buyDev", "completeTrade", "bankTrade"].includes(a.type))
    g.deadline = Math.max(g.deadline ?? now, now) + actionBonusSeconds(g.turnSeconds) * 1000;
  recordReplayFrame(g, p, a, now);
}
// Resolve expired mandatory choices, or end/pass an expired turn. Robber choices
// use the bot's strategy; normal turn timeouts never trade or buy/build.
// Conservative read-only gate: trade and Rapid Play maintenance can also
// change state without an expired turn. Keep their existing advance path.
export function needsClockAdvance(g: Game, now = Date.now()) {
  if (needsPauseUpdate(g, now)) return true;
  if (g.pause.pausedAt !== null) return false;
  if (g.offers.length || g.rush) return true;
  const key = phaseClockKey(g);
  if (!key)
    return g.clockKey !== null || g.deadline !== null || g.clockResume !== null;
  return g.clockKey !== key || g.deadline === null || g.deadline <= now;
}
export function advanceClock(g: Game, now = Date.now(), rng = secureRandom) {
  normalizeGame(g);
  advancePause(g, now);
  if (g.pause.pausedAt !== null) return;
  advanceTrades(g, now, rng);
  if (g.rush && !g.phase.startsWith("setup") && g.phase !== "lobby") {
    advanceRush(g, rushRules, rng, now);
    advanceTrades(g, now, rng);
    return;
  }
  refreshClock(g, now);
  if (g.deadline === null || g.deadline > now) return;
  const choose = <T>(items: T[]) => items[Math.floor(rng() * items.length)];
  const p = actor(g);
  log(g, "Time expired; the table resolved the pending action.");
  if (g.phase === "citiesChoice") {
    applyAction(g, p, citiesTimeoutChoice(g, rng), rng, now);
  } else if (g.phase === "robber" || g.phase === "steal") {
    const move = timeoutRobberMove(g, p);
    if (move) applyAction(g, p, move, rng, now);
  } else if (g.phase === "gold") {
    for (const id of Object.keys({ ...g.goldClaims })) {
      if (g.phase !== "gold") break;
      const seat = Number(id),
        h = emptyHand();
      const amount = Math.min(g.goldClaims[seat], resourceTotal(g.bank));
      for (let i = 0; i < amount; i++)
        h[choose(RESOURCES.filter((r) => h[r] < g.bank[r]))]++;
      applyAction(g, seat, { type: "gold", resources: h }, rng, now);
    }
  } else if (g.phase === "discard") {
    for (const [id, amount] of Object.entries({ ...g.discards })) {
      const seat = Number(id),
        discarded: GameHand = g.cities
          ? (Object.fromEntries(GOODS.map((r) => [r, 0])) as CitiesHand)
          : emptyHand();
      const bag = gameGoods(g).flatMap(
        (r) => Array(g.players[seat].hand[r] ?? 0).fill(r) as Good[],
      );
      for (let i = 0; i < amount; i++) {
        const r = bag.splice(Math.floor(rng() * bag.length), 1)[0];
        discarded[r] = (discarded[r] ?? 0) + 1;
      }
      applyAction(g, seat, { type: "discard", resources: discarded }, rng, now);
    }
  } else if (g.phase === "setupSettlement") {
    applyAction(
      g,
      p,
      { type: "settlement", id: choose(legalSettlements(g, p, true)) },
      rng,
      now,
    );
    if ((g.phase as string) === "setupRoad")
      applyAction(
        g,
        p,
        legalRoads(g, p, true).length
          ? { type: "road", id: choose(legalRoads(g, p, true)) }
          : { type: "ship", id: choose(legalShips(g, p, true)) },
        rng,
        now,
      );
  } else if (g.phase === "roadBuilding") {
    for (let i = 0; i < 2 && g.phase === "roadBuilding"; i++)
      applyAction(g, p, timeoutRoadMove(g, p), rng, now);
  } else {
    const move: Action | null =
      g.phase === "setupRoad"
        ? legalRoads(g, p, true).length
          ? { type: "road", id: choose(legalRoads(g, p, true)) }
          : { type: "ship", id: choose(legalShips(g, p, true)) }
        : g.phase === "roll"
          ? { type: "roll" }
          : g.phase === "action"
            ? { type: "end" }
            : g.phase === "special"
              ? { type: "pass" }
              : null;
    if (move) applyAction(g, p, move, rng, now);
  }
}
export type PublicOffer = Omit<
  Offer,
  "responseDeadlines" | "responseDurations" | "preparingUntil"
> & { responseDeadline: number | null; responseDuration: number | null };
const rushRules = {
  perform: performTrackedAction,
  beginRobber,
  distribute,
  timeoutRobberMove,
  timeoutRoadMove,
  scores: (g: Game) => g.players.map((_, i) => points(g, i)),
};
function timeoutRoadMove(g: Game, p: number): Action {
  const road = legalRoads(g, p)[0];
  if (road !== undefined) return { type: "road", id: road };
  const ship = legalShips(g, p)[0];
  return ship !== undefined ? { type: "ship", id: ship } : { type: "skipRoads" };
}
function timeoutRobberMove(g: Game, p: number): Action | null {
  return robberCandidates(view(g, g.players[p].id))[0] ?? null;
}
function performTrackedAction(
  g: Game,
  p: number,
  a: Action,
  rng: () => number,
  now: number,
) {
  trackStatistics(
    g,
    p,
    a,
    now,
    () => performAction(g, p, a, rng, now),
    rushRules.scores,
  );
}
export type PublicPlayer = Omit<
  Player,
  "id" | "hand" | "dev" | "autoRejectTrades"
> & {
  autoRejectTrades?: boolean;
  hand?: GameHand;
  dev?: Dev[];
  resources: number;
  development: number;
  score: number;
  publicScore: number;
  roadLength: number;
  pieces: ReturnType<typeof pieces>;
};
export type View = Omit<
  Game,
  | "players"
  | "deck"
  | "receipts"
  | "bank"
  | "clockKey"
  | "clockResume"
  | "pauseCooldowns"
  | "diceState"
  | "fogDeck"
  | "fogNumbers"
  | "offers"
  | "cities"
  | "citiesFlow"
  | "statistics"
  | "replaySequence"
  | "replayComplete"
  | "specialRequests"
  | "specialQueue"
  | "ranked"
  | "logDetails"
  | "botTradeMemory"
> & {
  ranked?: import("./ranked-types").RankedView;
  specialRequested: boolean;
  statistics: MatchStatistics | null;
  cities: ReturnType<typeof citiesView> | null;
  citiesLegal: ReturnType<typeof citiesLegal> | null;
  offers: PublicOffer[];
  bank: GameHand | null;
  serverTime: number;
  players: PublicPlayer[];
  deckCount: number;
  me: number;
  goldAmount: number;
  legal: {
    settlement: number[];
    road: number[];
    city: number[];
    robber: number[];
    pirate: number[];
    ship: number[];
    moveShips: number[];
    shipDestinations: Record<number, number[]>;
  };
  rates: GameHand;
};
export function view(g: Game, id: string | null): View {
  normalizeGame(g);
  const me = id ? g.players.findIndex((p) => p.id === id) : -1;
  const {
    players,
    deck,
    receipts,
    bank,
    clockKey,
    clockResume,
    pauseCooldowns,
    diceState,
    fogDeck,
    fogNumbers,
    offers,
    cities,
    citiesFlow,
    statistics,
    replaySequence,
    replayComplete,
    specialRequests,
    specialQueue,
    ranked,
    logDetails,
    botTradeMemory,
    cardFeedback,
    ...rest
  } = g;
  const personalPhase = rushPhase(g, me);
  const mine = me >= 0 && ((g.rush && g.phase === "action") || actor(g) === me);
  const visibleOffers =
    g.rush && me >= 0
      ? offers.filter(
          (o) =>
            o.from === me ||
            tradeExecutor(o, g.active) === me ||
            (tradeEligible(g, o, me) &&
              !o.rejected.includes(me) &&
              affordable(
                g,
                me,
                tradeExecutor(o, g.active) === o.from ? o.want : o.give,
              )),
        )
      : offers;
  return {
    ...rest,
    cardFeedback: cardFeedbackForViewer(cardFeedback, me),
    log: g.log.map((line, i) =>
      logDetails[i]?.seats.includes(me) ? logDetails[i]!.text : line,
    ),
    ...(ranked
      ? { ranked: rankedView(ranked, g.winner, g.phase === "finished") }
      : {}),
    specialRequested: me >= 0 && specialRequests.includes(me),
    statistics:
      g.phase === "finished" && statistics ? structuredClone(statistics) : null,
    phase: personalPhase,
    ...(g.rush && g.phase === "action" && me >= 0
      ? {
          active: me,
          freeRoads: g.rush.seats[me].freeRoads,
          victims:
            g.rush.robberOwner === me
              ? g.rush.robberVictims.filter((p) => total(g.players[p].hand) > 0)
              : [],
          deadline:
            personalPhase === "roadBuilding"
              ? g.rush.seats[me].until
              : ["robber", "steal"].includes(personalPhase)
                ? g.rush.robberUntil
                : g.rush.rollAt,
        }
      : {}),
    cities: cities ? citiesView(citiesTable(g), me) : null,
    citiesLegal: cities && me >= 0 ? citiesLegal(g, me) : null,
    offers: visibleOffers.map((offer) => {
      const { responseDeadlines, responseDurations, preparingUntil, ...o } = offer;
      return { ...o, ...tradeResponseTimer(offer, me) };
    }),
    bank:
      g.hideBank && g.phase !== "lobby" && g.phase !== "finished"
        ? null
        : { ...bank },
    serverTime: Date.now(),
    players: players.map((p, i) => {
      const { id, hand, dev, autoRejectTrades, ...publicP } = p;
      return {
        ...publicP,
        ...(i === me
          ? {
              hand: { ...hand },
              dev: dev.map((d) => ({ ...d })),
              autoRejectTrades,
            }
          : g.phase === "finished"
            ? { dev: dev.filter((d) => d.kind === "victory") }
            : {}),
        resources: total(hand),
        development: dev.length,
        score: points(g, i, i === me || g.phase === "finished"),
        publicScore: points(g, i, false),
        roadLength: roadLength(g, i),
        pieces: pieces(g, i),
      };
    }),
    deckCount: deck.length,
    me,
    goldAmount:
      me >= 0 ? Math.min(g.goldClaims[me] ?? 0, resourceTotal(g.bank)) : 0,
    legal: {
      robber: mine && personalPhase === "robber" ? legalRobberTiles(g) : [],
      pirate: mine && personalPhase === "robber" ? legalPirateTiles(g) : [],
      ship:
        mine &&
        ["action", "special", "setupRoad", "roadBuilding"].includes(g.phase)
          ? legalShips(g, me, g.phase === "setupRoad")
          : [],
      moveShips: mine ? legalMoveShips(g, me) : [],
      shipDestinations: mine
        ? Object.fromEntries(
            legalMoveShips(g, me).map((id) => [
              id,
              shipDestinations(g, me, id),
            ]),
          )
        : {},
      settlement:
        mine && ["action", "special", "setupSettlement"].includes(personalPhase)
          ? legalSettlements(g, me, g.phase === "setupSettlement")
          : [],
      road:
        mine &&
        ["action", "special", "setupRoad", "roadBuilding"].includes(
          personalPhase,
        )
          ? legalRoads(g, me, g.phase === "setupRoad")
          : [],
      city:
        mine && ["action", "special"].includes(personalPhase)
          ? legalCities(g, me)
          : [],
    },
    rates: Object.fromEntries(
      gameGoods(g).map((r) => [r, me >= 0 ? bankRate(g, me, r) : 4]),
    ) as GameHand,
  };
}
