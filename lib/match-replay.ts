import type { Action, Dev, Game, View } from "./game";
import { points, view } from "./game";
import { GOODS, type CitiesHand, type ProgressCard } from "./cities-knights";

// Deliberately enumerate historical state. No credentials, receipts, future
// deck order, balanced-dice state, hidden fog contents or chat are recorded.
export type ReplayState = Pick<
  View,
  | "board"
  | "cities"
  | "phase"
  | "active"
  | "turn"
  | "dice"
  | "winner"
  | "longest"
  | "army"
  | "specialPlayer"
  | "discards"
  | "freeRoads"
  | "deckCount"
> &
  Partial<
    Pick<
      Game,
      | "mode"
      | "map"
      | "scenario"
      | "target"
      | "friendlyRobber"
      | "goldClaims"
      | "goldResume"
      | "shipMoved"
      | "turnOrder"
    >
  > & {
    pause?: Pick<Game["pause"], "pausedAt" | "until" | "vote">;
    bank: CitiesHand;
    players: {
      name: string;
      color: number;
      avatar?: import("./avatars").AvatarId;
      hand: CitiesHand;
      dev: Dev[];
      progress: ProgressCard[];
      score: number;
      publicScore: number;
      resources: number;
      development: number;
      roadLength: number;
      knights: number;
      islandBonus?: number;
      islands?: number[];
    }[];
    offers: Pick<
      View["offers"][number],
      "id" | "from" | "give" | "want" | "accepted" | "rejected"
    >[];
    rush: {
      robberOwner: number | null;
      robberStep: string;
      freeRoads: number[];
      votes: number[];
    } | null;
  };
export type ReplayPatch = {
  path: (string | number)[];
  value?: unknown;
  remove?: true;
};
export type ReplayFrame = {
  sequence: number;
  at: number;
  seat: number | null;
  action: string;
  messages: string[];
  patch: ReplayPatch[];
};
export type ReplayCapture = {
  id: string | null;
  initial: ReplayState | null;
  initialSequence: number;
  complete: boolean;
  frames: ReplayFrame[];
  last: ReplayState | null;
  log: string[];
};
export type ReplayPage = {
  id: string;
  version: 1;
  complete: boolean;
  initialSequence: number;
  initial: ReplayState;
  lastSequence: number;
  frames: ReplayFrame[];
  next: number | null;
};
const collectors = new WeakMap<Game, ReplayCapture>();
const hand = (h: Game["bank"]) =>
  Object.fromEntries(GOODS.map((good) => [good, h[good] ?? 0])) as CitiesHand;
export function replayState(g: Game): ReplayState {
  const v = view(g, null);
  return structuredClone({
    mode: g.mode,
    map: g.map,
    scenario: g.scenario,
    target: g.target,
    friendlyRobber: g.friendlyRobber,
    goldClaims: g.goldClaims,
    goldResume: g.goldResume,
    shipMoved: g.shipMoved,
    turnOrder: g.turnOrder,
    board: v.board,
    cities: v.cities,
    phase: g.phase,
    active: g.active,
    turn: g.turn,
    dice: g.dice,
    pause: {
      pausedAt: g.pause.pausedAt,
      until: g.pause.until,
      vote: g.pause.vote,
    },
    winner: g.winner,
    longest: g.longest,
    army: g.army,
    specialPlayer: g.specialPlayer,
    discards: g.discards,
    freeRoads: g.freeRoads,
    deckCount: v.deckCount,
    bank: hand(g.bank),
    players: g.players.map((p, seat) => ({
      name: p.name,
      color: p.color,
      avatar: p.avatar,
      hand: hand(p.hand),
      dev: p.dev,
      progress: g.cities?.players[seat].progress ?? [],
      score: points(g, seat),
      publicScore: points(g, seat, false),
      resources: v.players[seat].resources,
      development: p.dev.length,
      roadLength: v.players[seat].roadLength,
      knights: p.knights,
      islandBonus: p.islandBonus,
      islands: p.islands,
    })),
    offers: v.offers.map(({ id, from, give, want, accepted, rejected }) => ({
      id,
      from,
      give,
      want,
      accepted,
      rejected,
    })),
    rush: g.rush
      ? {
          robberOwner: g.rush.robberOwner,
          robberStep: g.rush.robberStep,
          freeRoads: g.rush.seats.map((s) => s.freeRoads),
          votes: g.rush.votes,
        }
      : null,
  });
}
export function replayDiff(
  before: unknown,
  after: unknown,
  path: (string | number)[] = [],
): ReplayPatch[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    Array.isArray(before) === Array.isArray(after) &&
    (!Array.isArray(before) || before.length === (after as unknown[]).length)
  ) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(
      (key) => {
        const next = [...path, Array.isArray(before) ? Number(key) : key];
        return !(key in b)
          ? [{ path: next, remove: true as const }]
          : replayDiff(a[key], b[key], next);
      },
    );
  }
  return [{ path, value: structuredClone(after) }];
}
export function applyReplayPatch(
  state: ReplayState,
  patches: ReplayPatch[],
): ReplayState {
  let result = state;
  for (const patch of patches) {
    if (!patch.path.length) {
      result = structuredClone(patch.value) as ReplayState;
      continue;
    }
    // An ongoing pre-update game can first emit a nested gold-claim patch
    // after this field was introduced. Its immutable opening has no container.
    // Keep old recordings playable without replacing their historical state.
    if (patch.path.length > 1 && patch.path[0] === "goldClaims")
      result.goldClaims ??= {};
    let target: Record<string | number, unknown> = result as unknown as Record<
      string,
      unknown
    >;
    for (const key of patch.path.slice(0, -1)) {
      if (["__proto__", "constructor", "prototype"].includes(String(key)))
        throw new Error("Invalid replay path.");
      target = target[key] as typeof target;
    }
    const key = patch.path.at(-1)!;
    if (["__proto__", "constructor", "prototype"].includes(String(key)))
      throw new Error("Invalid replay path.");
    if (patch.remove) delete target[key];
    else target[key] = structuredClone(patch.value);
  }
  return result;
}
export function beginReplayCapture(g: Game) {
  if (g.phase === "finished") return;
  const initial = g.statistics && g.phase !== "lobby" ? replayState(g) : null;
  collectors.set(g, {
    id: g.statistics?.id ?? null,
    initial,
    initialSequence: g.replaySequence,
    complete: g.replayComplete,
    last: initial,
    log: [...g.log],
    frames: [],
  });
}
export function takeReplayCapture(g: Game) {
  const capture = collectors.get(g);
  collectors.delete(g);
  return capture;
}
// Expansion draft actions get an isolated recording buffer, committed only
// after the action validates. Failed moves cannot leave replay events behind.
export function forkReplayCapture(g: Game, draft: Game) {
  const capture = collectors.get(g);
  if (capture) collectors.set(draft, { ...capture, frames: [] });
}
export function commitReplayCapture(draft: Game, g: Game) {
  const capture = takeReplayCapture(draft),
    previous = collectors.get(g);
  if (capture && previous)
    collectors.set(g, {
      ...capture,
      frames: [...previous.frames, ...capture.frames],
    });
}
function appendedLog(before: string[], after: string[]) {
  for (let n = Math.min(before.length, after.length); n > 0; n--)
    if (before.slice(-n).every((line, i) => line === after[i]))
      return after.slice(n);
  return after;
}
export function recordReplayFrame(
  g: Game,
  seat: number | null,
  action: Pick<Action, "type">,
  now: number,
) {
  const capture = collectors.get(g);
  if (!capture || !g.statistics || g.phase === "lobby") return;
  const state = replayState(g);
  if (capture.id !== g.statistics.id || !capture.initial) {
    capture.id = g.statistics.id;
    capture.initial = state;
    capture.last = state;
    capture.initialSequence = g.replaySequence;
    capture.complete = g.replayComplete;
    capture.log = [...g.log];
    capture.frames = [];
    return;
  }
  const patch = replayDiff(capture.last, state),
    messages = appendedLog(capture.log, g.log);
  if (!patch.length && !messages.length) return;
  g.replaySequence++;
  capture.frames.push({
    sequence: g.replaySequence,
    at: now,
    seat,
    action: action.type,
    messages,
    patch,
  });
  capture.last = state;
  capture.log = [...g.log];
}

// Keep a small number of checkpoints, rather than retaining a cloned full
// board for every action. Seeking applies at most 49 patches after a checkpoint.
export class ReplayTimeline {
  private checkpoints = new Map<number, ReplayState>();
  constructor(
    readonly initial: ReplayState,
    readonly frames: ReplayFrame[],
  ) {
    this.checkpoints.set(0, structuredClone(initial));
    let state = structuredClone(initial);
    frames.forEach((frame, i) => {
      state = applyReplayPatch(state, frame.patch);
      if ((i + 1) % 50 === 0)
        this.checkpoints.set(i + 1, structuredClone(state));
    });
  }
  stateAt(index: number) {
    if (!Number.isInteger(index) || index < 0 || index > this.frames.length)
      throw new Error("Choose a valid replay action.");
    const checkpoint = Math.floor(index / 50) * 50;
    let state = structuredClone(this.checkpoints.get(checkpoint)!);
    for (let i = checkpoint; i < index; i++)
      state = applyReplayPatch(state, this.frames[i].patch);
    return state;
  }
}
