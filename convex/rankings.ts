import { query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireStorageServer } from "./access";
import { accountById } from "./accounts";
import { allowed, relation } from "./social";
import { fail } from "./errors";
import { normalizeAvatar } from "../lib/avatars";
import { storedRegion } from "../lib/regions";
import {
  rankedSeason,
  resetRating,
  ratingSeats,
  division,
  seasonById,
  rankedMode,
} from "../lib/ranked";
import {
  PLACEMENT_GAMES,
  RANKED_MODES,
  type RankedMode,
  type RankedSeed,
  type Season,
  type LeaderboardPlayer,
} from "../lib/ranked-types";
import { regionFilter } from "../lib/regions";
import type { Doc } from "./_generated/dataModel";
type Ctx = QueryCtx | MutationCtx;
export async function eligibility(ctx: Ctx, players: string[]) {
  const ids = new Set<string>();
  for (const p of players)
    for (const m of await ctx.db
      .query("matchPlayers")
      .withIndex("by_player", (q) => q.eq("playerId", p))
      .collect())
      ids.add(m.matchId);
  return { played: ids.size, required: 5 };
}
export async function seeds(
  ctx: Ctx,
  ids: string[],
  mode: RankedMode,
  now: number,
): Promise<RankedSeed[]> {
  const season = rankedSeason(now);
  return Promise.all(
    ids.map(async (id) => {
      const a = await accountById(ctx, id);
      if (!a) fail("A Ranked account is no longer available.", 409);
      const current = await ctx.db
        .query("ratings")
        .withIndex("by_account_season_mode", (q) =>
          q.eq("accountId", id).eq("season", season.id).eq("mode", mode),
        )
        .unique();
      const prev = current
        ? null
        : await ctx.db
            .query("ratings")
            .withIndex("by_account_mode_season", (q) =>
              q.eq("accountId", id).eq("mode", mode).lt("season", season.id),
            )
            .order("desc")
            .first();
      return {
        accountId: id,
        username: a.username,
        rating: current?.rating ?? resetRating(prev?.rating ?? null),
        games: current?.games ?? 0,
        wins: current?.wins ?? 0,
      };
    }),
  );
}
export async function snapshot(
  ctx: Ctx,
  ids: string[],
  mode: RankedMode,
  now: number,
) {
  return {
    season: rankedSeason(now),
    mode,
    seats: ratingSeats(await seeds(ctx, ids, mode, now)),
  };
}
async function rows(ctx: Ctx, season: string, mode: string) {
  return ctx.db
    .query("ratings")
    .withIndex("by_season_mode_rating", (q) =>
      q.eq("season", season).eq("mode", mode),
    )
    .order("desc")
    .collect();
}
function projection(
  a: Doc<"accounts">,
  r: { rating: number; games: number; wins: number; rank: number | null },
): LeaderboardPlayer {
  return {
    rank: r.games >= PLACEMENT_GAMES ? r.rank : null,
    username: a.username,
    displayName: a.display_name,
    avatar: normalizeAvatar(a.avatar),
    rating: r.games >= PLACEMENT_GAMES ? r.rating : null,
    games: r.games,
    wins: r.wins,
    division: r.games >= PLACEMENT_GAMES ? division(r.rating) : null,
    region: storedRegion(a),
  };
}
async function profile(ctx: Ctx, username: string, season: Season) {
  const a = await ctx.db
    .query("accounts")
    .withIndex("by_username", (q) => q.eq("username", username.toLowerCase()))
    .unique();
  if (!a) fail("Player not found.", 404);
  const ratings = [];
  for (const mode of RANKED_MODES) {
    const r = await ctx.db
      .query("ratings")
      .withIndex("by_account_season_mode", (q) =>
        q.eq("accountId", a.id).eq("season", season.id).eq("mode", mode),
      )
      .unique();
    const rank = r
      ? (await rows(ctx, season.id, mode)).filter(
          (x) => x.games >= PLACEMENT_GAMES && x.rating > r.rating,
        ).length + 1
      : null;
    ratings.push({
      ...projection(
        a,
        r ? { ...r, rank } : { rating: 1000, games: 0, wins: 0, rank: null },
      ),
      mode,
    });
  }
  return { username: a.username, season, ratings };
}
export const read = query({
  args: { op: v.string(), data: v.any() },
  handler: async (ctx, { op, data: d }) => {
    await requireStorageServer(ctx);
    if (op === "eligibility") return eligibility(ctx, d.players);
    if (op === "seeds") return seeds(ctx, d.ids, d.mode, d.now);
    if (op === "profile") return profile(ctx, d.username, d.season);
    if (op !== "leaderboard") fail("Unknown ranking query.");
    const q = new URLSearchParams(d.query),
      mode = rankedMode(q.get("mode") ?? "base4"),
      now = Date.now(),
      current = rankedSeason(now),
      season = q.has("season") ? seasonById(q.get("season")!) : current;
    if (season.startsAt > now) fail("That Ranked season has not started.");
    const username = q.get("profile");
    if (username) {
      if (!/^[a-zA-Z0-9_]{3,24}$/.test(username))
        fail("Choose a valid player.");
      return profile(ctx, username, season);
    }
    const offset = Number(q.get("offset") ?? 0),
      search = (q.get("search") ?? "").trim().toLowerCase(),
      friends = q.get("friends") === "1",
      region = regionFilter(q);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 10000 ||
      search.length > 32
    )
      fail("Invalid leaderboard page.");
    if (friends && !d.account)
      fail("Sign in to view your friends leaderboard.", 401);
    if (friends && region.continentCode)
      fail("Choose Friends or a regional leaderboard.");
    const ranked: { a: Doc<"accounts">; r: Doc<"ratings"> }[] = [];
    for (const r of await rows(ctx, season.id, mode)) {
      if (r.games < PLACEMENT_GAMES) continue;
      const a = await accountById(ctx, r.accountId);
      if (!a) continue;
      if (
        (region.continentCode && a.continent_code !== region.continentCode) ||
        (region.countryCode && a.country_code !== region.countryCode) ||
        (region.regionCode && a.region_code !== region.regionCode)
      )
        continue;
      ranked.push({ a, r });
    }
    ranked.sort(
      (a, b) =>
        b.r.rating - a.r.rating || a.a.username.localeCompare(b.a.username),
    );
    const ranks = new Map<number, number>();
    ranked.forEach((x, i) => {
      if (!ranks.has(x.r.rating)) ranks.set(x.r.rating, i + 1);
    });
    const indexed = ranked.map((x) => ({ ...x, rank: ranks.get(x.r.rating)! })),
      filtered = [];
    for (const x of indexed) {
      if (
        !x.a.username.toLowerCase().includes(search) &&
        !x.a.display_name.toLowerCase().includes(search)
      )
        continue;
      if (friends && x.a.id !== d.account) {
        if (
          (await relation(ctx, d.account, x.a.id))?.status !== "accepted" ||
          !(await allowed(ctx, d.account, x.a.id))
        )
          continue;
      }
      filtered.push(x);
    }
    const a = d.account ? await accountById(ctx, d.account) : null,
      me = a
        ? (await profile(ctx, a.username, season)).ratings.find(
            (r) => r.mode === mode,
          )!
        : null;
    if (me && region.continentCode)
      me.rank = indexed.find((x) => x.a.id === d.account)?.rank ?? null;
    const all = await ctx.db.query("ratings").collect(),
      seasons = [
        ...new Set([
          current.id,
          ...all.filter((r) => r.games > 0).map((r) => r.season),
        ]),
      ]
        .sort()
        .reverse()
        .slice(0, 80)
        .map(seasonById);
    return {
      mode,
      season,
      seasons,
      rows: filtered
        .slice(offset, offset + 50)
        .map((x) => projection(x.a, { ...x.r, rank: x.rank })),
      me,
      next: filtered.length > offset + 50 ? offset + 50 : null,
      total: filtered.length,
      serverTime: now,
      region,
    };
  },
});
