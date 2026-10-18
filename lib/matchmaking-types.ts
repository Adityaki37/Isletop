import type { AvatarId } from "./avatars";
import { RANKED_ASSETS } from "./ranked-assets";
import { BASE_MAPS, baseMapAvailable, type BaseMap } from "./base-maps";
export const CASUAL_QUEUES = {
  duel: {
    title: "1v1",
    players: 2,
    estimatedMinutes: 10,
    seconds: 30,
    mode: "duel",
    image: "/art/icon_gamemode_1v1.svg",
  },
  base4: {
    title: "4 Player",
    players: 4,
    estimatedMinutes: 30,
    seconds: 60,
    mode: "base",
    image: "/art/base.svg",
  },
} as const;
export type CasualQueue = keyof typeof CASUAL_QUEUES;
export const RANKED_QUEUES = {
  rankedDuel: { ...CASUAL_QUEUES.duel, rankedMode: "duel" },
  rankedBase4: { ...CASUAL_QUEUES.base4, rankedMode: "base4" },
  rankedRush4: {
    title: "Rapid Play",
    players: 4,
    estimatedMinutes: undefined,
    seconds: 5,
    mode: "rush",
    image: RANKED_ASSETS.rush,
    rankedMode: "rush4",
  },
  rankedCities4: {
    title: "Cities & Defenders",
    players: 4,
    estimatedMinutes: undefined,
    seconds: 60,
    mode: "citiesKnights",
    image: RANKED_ASSETS.citiesKnights,
    rankedMode: "cities4",
  },
} as const;
export const MATCHMAKING_QUEUES = { ...CASUAL_QUEUES, ...RANKED_QUEUES };
export type RankedQueue = keyof typeof RANKED_QUEUES;
export type MatchmakingQueue = keyof typeof MATCHMAKING_QUEUES;
export const isRankedQueue = (queue: MatchmakingQueue): queue is RankedQueue =>
  queue in RANKED_QUEUES;
export function matchmakingMap(queue: MatchmakingQueue, value: unknown = "baseRandom"): BaseMap {
  const preset = MATCHMAKING_QUEUES[queue];
  if (!BASE_MAPS.includes(value as BaseMap) || !baseMapAvailable(value, preset.mode, preset.players))
    throw Error("Choose an available map for this game mode.");
  return value as BaseMap;
}
export function matchmakingQueue(value: unknown): MatchmakingQueue {
  if (typeof value !== "string" || !Object.hasOwn(MATCHMAKING_QUEUES, value))
    throw Error("Choose an available matchmaking queue.");
  return value as MatchmakingQueue;
}
export const MATCHMAKING_LEASE_MS = 60000;
export const MATCHMAKING_ASSIGNED_MS = 21600000;
export function casualQueue(value: unknown): CasualQueue {
  if (value !== "duel" && value !== "base4")
    throw new Error("Choose an available Casual queue.");
  return value;
}
export type QueuePlayer = {
  id: string;
  name: string;
  avatar?: AvatarId;
  color: number;
};
export type MatchmakingStatus = {
  serverTime: number;
  counts: Record<MatchmakingQueue, number>;
  rankedEligibility?: { played: number; required: number } | null;
} & (
  | { status: "idle" }
  | {
      status: "waiting";
      ticket: string;
      queue: MatchmakingQueue;
      map?: BaseMap;
      joinedAt: number;
      expiresAt: number;
      waiting: number;
    }
  | {
      status: "matched";
      ticket: string | null;
      queue: MatchmakingQueue | null;
      code: string;
    }
);
