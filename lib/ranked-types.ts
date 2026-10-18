import type { AvatarId } from "./avatars";
export const RANKED_MODES = ["base4", "duel", "cities4", "rush4"] as const;
export type RankedMode = (typeof RANKED_MODES)[number];
export const PLACEMENT_GAMES = 10;
export type Season = {
  id: string;
  label: string;
  startsAt: number;
  endsAt: number;
};
export type Division =
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond"
  | "master"
  | "grandmaster";
export type RankedSeed = {
  accountId: string;
  username: string;
  rating: number;
  games: number;
  wins: number;
};
export type RankedSeat = RankedSeed & { win: number; loss: number };
// Only the server-side room retains account IDs and pre-placement ratings.
export type RankedSnapshot = {
  season: Season;
  mode: RankedMode;
  seats: RankedSeat[];
};
export type RankedPlayerView = {
  username: string;
  rating: number | null;
  after: number | null;
  change: number | null;
  win: number | null;
  loss: number | null;
  games: number;
  division: Division | null;
};
export type RankedView = {
  season: Season;
  mode: RankedMode;
  players: RankedPlayerView[];
  finished: boolean;
};
export type LeaderboardPlayer = {
  rank: number | null;
  username: string;
  displayName: string;
  avatar: AvatarId;
  rating: number | null;
  games: number;
  wins: number;
  division: Division | null;
  region?: import("./regions").PlayerRegion;
};
export type LeaderboardData = {
  mode: RankedMode;
  season: Season;
  seasons: Season[];
  rows: LeaderboardPlayer[];
  me: LeaderboardPlayer | null;
  next: number | null;
  total: number;
  serverTime: number;
  region: import("./regions").PlayerRegion;
};
export type RankedProfileData = {
  username: string;
  season: Season;
  ratings: (LeaderboardPlayer & { mode: RankedMode })[];
};
