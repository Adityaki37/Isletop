import { storageOperation } from "./account-store";
import { api, storageClient } from "./convex-client";
import { rankedSeason, ratingSeats, rankedMode, seasonById } from "./ranked";
import { regionFilter } from "./regions";
import type {
  RankedMode,
  RankedSeed,
  RankedSnapshot,
  Season,
  LeaderboardData,
  RankedProfileData,
} from "./ranked-types";
import type { identity } from "./session";
export const RANKED_UNLOCK_GAMES = 5;
type Ident = Awaited<ReturnType<typeof identity>>;
export async function rankedEligibility(ident: Ident) {
  return ident.account
    ? (storageClient().query(api.rankings.read, {
        op: "eligibility",
        data: { players: [ident.id, ...ident.aliases] },
      }) as Promise<{ played: number; required: number }>)
    : null;
}
export async function rankedSeeds(
  ids: string[],
  mode: RankedMode,
  now = Date.now(),
): Promise<RankedSeed[]> {
  return storageOperation(() =>
    storageClient().query(api.rankings.read, {
      op: "seeds",
      data: { ids, mode, now },
    }),
  ) as Promise<RankedSeed[]>;
}
export async function rankedSnapshot(
  ids: string[],
  mode: RankedMode,
  now = Date.now(),
): Promise<RankedSnapshot> {
  return {
    season: rankedSeason(now),
    mode,
    seats: ratingSeats(await rankedSeeds(ids, mode, now)),
  };
}
export async function rankedProfile(
  username: string,
  season: Season,
): Promise<RankedProfileData> {
  return storageOperation(() =>
    storageClient().query(api.rankings.read, {
      op: "profile",
      data: { username, season },
    }),
  ) as Promise<RankedProfileData>;
}
export async function leaderboard(
  query: URLSearchParams,
  ident: Ident,
): Promise<LeaderboardData | RankedProfileData> {
  rankedMode(query.get("mode") ?? "base4");
  if (query.has("season")) seasonById(query.get("season")!);
  regionFilter(query);
  return storageOperation(() =>
    storageClient().query(api.rankings.read, {
      op: "leaderboard",
      data: { query: query.toString(), account: ident.account?.id ?? null },
    }),
  ) as Promise<LeaderboardData | RankedProfileData>;
}
