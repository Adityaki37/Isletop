import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireStorageServer } from "./access";
import { playerOwner, sessionValid, aliases, accountById } from "./accounts";
import { roomGame } from "./presence";
import { directory } from "./rooms";
import { fail } from "./errors";
import { scheduleTable } from "./tableTimers";
import { eligibility, seeds, snapshot } from "./rankings";
import { rankedRange } from "../lib/ranked";
import { normalizeAvatar, selectAvatar } from "../lib/avatars";
import {
  MATCHMAKING_QUEUES,
  RANKED_QUEUES,
  isRankedQueue,
  matchmakingQueue,
  matchmakingMap,
  matchedGame,
  MATCHMAKING_ASSIGNED_MS,
  MATCHMAKING_LEASE_MS,
  type MatchmakingQueue,
  type MatchmakingStatus,
} from "../lib/matchmaking";
import { BASE_MAPS, type BaseMap } from "../lib/base-maps";
type Entry = Doc<"matchmakingEntries">;
type Ctx = MutationCtx | QueryCtx;
async function eligible(ctx: Ctx, e: Entry, now: number) {
  return e.account_id
    ? sessionValid(ctx, e.session_hash, e.account_id, now)
    : !(await playerOwner(ctx, e.player_id));
}
async function assigned(ctx: Ctx, e: Entry) {
  if (!e.room_code) return false;
  const g = await roomGame(ctx, e.room_code);
  return (
    !!g &&
    g.created === e.room_created &&
    !["lobby", "finished"].includes(g.phase)
  );
}
async function cleanup(ctx: MutationCtx, now: number, player: string) {
  for (const c of await ctx.db
    .query("matchmakingCancellations")
    .withIndex("by_expiry", (q) => q.lte("expires_at", now))
    .take(100))
    await ctx.db.delete(c._id);
  const own = await ctx.db
    .query("matchmakingEntries")
    .withIndex("by_player", (q) => q.eq("player_id", player))
    .unique();
  const expired = await ctx.db
    .query("matchmakingEntries")
    .withIndex("by_expiry", (q) => q.lte("expires_at", now))
    .take(100);
  for (const e of [
    ...new Map(
      [...(own ? [own] : []), ...expired].map((e) => [e._id, e]),
    ).values(),
  ])
    if (
      e.room_code
        ? !(await assigned(ctx, e))
        : e.expires_at <= now || !(await eligible(ctx, e, now))
    )
      await ctx.db.delete(e._id);
}
async function pending(ctx: Ctx, e: Entry, now: number) {
  if (
    e.room_code ||
    e.expires_at <= now ||
    !(await eligible(ctx, e, now)) ||
    (await ctx.db
      .query("matchmakingCancellations")
      .withIndex("by_player_ticket", (q) =>
        q.eq("player_id", e.player_id).eq("ticket", e.ticket),
      )
      .unique())
  )
    return false;
  const ids = e.account_id
    ? (await aliases(ctx, e.account_id)).map((x) => x.player_id)
    : [e.player_id];
  for (const id of ids) {
    const m = await ctx.db
      .query("matchmakingEntries")
      .withIndex("by_player", (q) => q.eq("player_id", id))
      .unique();
    if (m && (await assigned(ctx, m))) return false;
  }
  return true;
}
async function match(ctx: MutationCtx, queue: MatchmakingQueue, now: number, map: BaseMap = "baseRandom") {
  const needed = MATCHMAKING_QUEUES[queue].players,
    candidates: Entry[] = [];
  // Retain old clients' map-less tickets in the default randomized queue.
  const groups = await Promise.all((map === "baseRandom" ? [map, undefined] : [map]).map(value => ctx.db
    .query("matchmakingEntries")
    .withIndex("by_queue_map_pending", q => q.eq("queue", queue).eq("map", value).eq("room_code", null))
    .collect()));
  for (const e of groups.flat().sort((a, b) => a.joined_at - b.joined_at || a.ticket.localeCompare(b.ticket)))
    if (await pending(ctx, e, now)) {
      candidates.push(e);
      if (candidates.length >= (isRankedQueue(queue) ? 64 : needed)) break;
    }
  if (candidates.length < needed) return;
  let selected = candidates;
  if (isRankedQueue(queue)) {
    selected = candidates.filter((e) => e.account_id);
    if (selected.length < needed) return;
    const rs = await seeds(
        ctx,
        selected.map((e) => e.account_id!),
        RANKED_QUEUES[queue].rankedMode,
        now,
      ),
      ratings = new Map(rs.map((r) => [r.accountId, r.rating])),
      anchor = selected[0],
      rating = ratings.get(anchor.account_id!)!,
      range = rankedRange(anchor.joined_at, now);
    selected = [
      anchor,
      ...selected
        .slice(1)
        .filter((e) => Math.abs(ratings.get(e.account_id!)! - rating) <= range)
        .sort(
          (a, b) =>
            Math.abs(ratings.get(a.account_id!)! - rating) -
              Math.abs(ratings.get(b.account_id!)! - rating) ||
            a.joined_at - b.joined_at ||
            a.ticket.localeCompare(b.ticket),
        )
        .slice(0, needed - 1),
    ];
    if (selected.length !== needed) return;
  }
  const ranked = isRankedQueue(queue)
    ? await snapshot(
        ctx,
        selected.map((e) => e.account_id!),
        RANKED_QUEUES[queue].rankedMode,
        now,
      )
    : undefined;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let n = 0; n < 5; n++) {
    const candidate = Array.from(
      crypto.getRandomValues(new Uint8Array(6)),
      (x) => alphabet[x % alphabet.length],
    ).join("");
    if (!(await roomGame(ctx, candidate))) {
      code = candidate;
      break;
    }
  }
  if (!code) fail("Unable to allocate a table. Retry.", 503);
  const { game: g, replay } = matchedGame(
    code,
    queue,
    selected.map((e) => ({
      id: e.player_id,
      name: e.name,
      avatar: normalizeAvatar(e.avatar),
      color: e.color,
    })),
    now,
    ranked,
    map,
  );
  const roomId = await ctx.db.insert("rooms", {
    code,
    state: JSON.stringify(g),
    revision: g.revision,
    updated: g.updated,
    public: g.public,
    directory: directory(g),
  });
  await scheduleTable(ctx, roomId, g);
  await ctx.db.insert("replays", {
    matchId: replay.id!,
    initial: JSON.stringify(replay.initial),
    initialSequence: replay.initialSequence,
    complete: replay.complete,
    lastSequence: replay.initialSequence,
  });
  if (g.ranked)
    for (const s of g.ranked.seats) {
      if (
        !(await ctx.db
          .query("ratings")
          .withIndex("by_account_season_mode", (q) =>
            q
              .eq("accountId", s.accountId)
              .eq("season", g.ranked!.season.id)
              .eq("mode", g.ranked!.mode),
          )
          .unique())
      )
        await ctx.db.insert("ratings", {
          accountId: s.accountId,
          season: g.ranked.season.id,
          mode: g.ranked.mode,
          rating: s.rating,
          games: s.games,
          wins: s.wins,
          updated: g.updated,
        });
    }
  for (const e of selected)
    await ctx.db.patch(e._id, {
      room_code: code,
      room_created: g.created,
      expires_at: now + MATCHMAKING_ASSIGNED_MS,
      session_hash: null,
    });
}
async function status(
  ctx: Ctx,
  player: string,
  account: string | null,
  now: number,
  includeCounts = true,
  requestedMap: BaseMap = "baseRandom",
): Promise<MatchmakingStatus> {
  const own = await ctx.db
      .query("matchmakingEntries")
      .withIndex("by_player", (q) => q.eq("player_id", player))
      .unique(),
    counts = Object.fromEntries(
      Object.keys(MATCHMAKING_QUEUES).map((k) => [k, 0]),
    ) as Record<MatchmakingQueue, number>;
  if (includeCounts)
    for (const e of await ctx.db
      .query("matchmakingEntries")
      .withIndex("by_waiting", (q) =>
        q.eq("room_code", null).gt("expires_at", now),
      )
      .collect())
      if (e.queue in counts && (e.map ?? "baseRandom") === (own ? own.map ?? "baseRandom" : requestedMap) && (await pending(ctx, e, now)))
        counts[e.queue as MatchmakingQueue]++;
  const ids = account
      ? [player, ...(await aliases(ctx, account)).map((x) => x.player_id)]
      : [player],
    found: Entry[] = [];
  for (const id of ids) {
    const e = await ctx.db
      .query("matchmakingEntries")
      .withIndex("by_player", (q) => q.eq("player_id", id))
      .unique();
    if (e && (await assigned(ctx, e))) found.push(e);
  }
  found.sort((a, b) => a.joined_at - b.joined_at);
  const recovered = found[0],
    common = { serverTime: now, counts };
  if (recovered)
    return {
      ...common,
      status: "matched",
      ticket: own?.room_code === recovered.room_code ? own.ticket : null,
      queue: recovered.queue as MatchmakingQueue,
      code: recovered.room_code!,
    };
  if (!own) return { ...common, status: "idle" };
  if (own.room_code)
    return {
      ...common,
      status: "matched",
      ticket: own.ticket,
      queue: own.queue as MatchmakingQueue,
      code: own.room_code,
    };
  return {
    ...common,
    status: "waiting",
    ticket: own.ticket,
    queue: own.queue as MatchmakingQueue,
    map: (own.map ?? "baseRandom") as BaseMap,
    joinedAt: own.joined_at,
    expiresAt: own.expires_at,
    waiting: counts[own.queue as MatchmakingQueue],
  };
}
export const action = mutation({
  args: { data: v.any() },
  handler: async (ctx, { data: d }) => {
    await requireStorageServer(ctx);
    const now = Date.now();
    await cleanup(ctx, now, d.player);
    if (!["read", "join", "heartbeat", "cancel"].includes(d.op))
      fail("Unknown matchmaking action.");
    if (
      d.op !== "read" &&
      (typeof d.ticket !== "string" || !/^[a-f0-9-]{36}$/.test(d.ticket))
    )
      fail("Invalid queue ticket.");
    const own = await ctx.db
      .query("matchmakingEntries")
      .withIndex("by_player", (q) => q.eq("player_id", d.player))
      .unique();
    const account = d.account ? await accountById(ctx, d.account) : null,
      ids = account
        ? [
            d.player,
            ...(await aliases(ctx, account.id)).map((x) => x.player_id),
          ]
        : [d.player];
    if (d.op === "join") {
      const existing = await status(
        ctx,
        d.player,
        d.account,
        now,
        !d.deferStatus,
      );
      if (existing.status === "matched")
        return {
          ...existing,
          rankedEligibility: account ? await eligibility(ctx, ids) : null,
        };
      const queue = matchmakingQueue(d.queue);
      let map: BaseMap;
      try { map = matchmakingMap(queue, d.map); }
      catch { return fail("Choose an available map for this game mode."); }
      if (isRankedQueue(queue)) {
        if (!account) fail("Sign in to play Ranked games.", 401);
        const e = await eligibility(ctx, ids);
        if (e.played < e.required)
          fail(`Complete ${e.required} games to unlock Ranked play.`, 403);
      }
      if (own && (own.ticket !== d.ticket || own.queue !== queue || (own.map ?? "baseRandom") !== map))
        fail("You are already queued. Cancel that queue first.", 409);
      const name = account?.display_name ?? d.name;
      if (typeof name !== "string" || !name.trim() || name.length > 24)
        fail("Choose a name with 1–24 characters.");
      const avatar = account
          ? normalizeAvatar(account.avatar)
          : selectAvatar(d.avatar ?? "player"),
        owner = await playerOwner(ctx, d.player);
      if (
        account
          ? !(await sessionValid(ctx, d.hash, account.id, now)) ||
            owner?.account_id !== account.id
          : !!owner
      )
        fail("Your session changed. Sign in again.", 401);
      if (
        await ctx.db
          .query("matchmakingCancellations")
          .withIndex("by_player_ticket", (q) =>
            q.eq("player_id", d.player).eq("ticket", d.ticket),
          )
          .unique()
      )
        fail("The queue changed. Reload before joining again.", 409);
      if (own)
        await ctx.db.patch(own._id, {
          expires_at: now + MATCHMAKING_LEASE_MS,
          session_hash: d.hash,
        });
      else {
        if (
          await ctx.db
            .query("matchmakingEntries")
            .withIndex("by_ticket", (q) => q.eq("ticket", d.ticket))
            .unique()
        )
          fail("Use a new queue ticket.", 409);
        await ctx.db.insert("matchmakingEntries", {
          player_id: d.player,
          ticket: d.ticket,
          queue,
          map,
          name: name.trim(),
          avatar,
          color: account?.color ?? -1,
          account_id: account?.id ?? null,
          session_hash: d.hash,
          joined_at: now,
          expires_at: now + MATCHMAKING_LEASE_MS,
          room_code: null,
          room_created: null,
        });
      }
      await match(ctx, queue, now, map);
    } else if (d.op === "heartbeat") {
      if (!own || own.ticket !== d.ticket)
        fail("Your queue expired or changed. Join again.", 409);
      if (!own.room_code) {
        await ctx.db.patch(own._id, {
          expires_at: now + MATCHMAKING_LEASE_MS,
          session_hash: d.hash,
        });
        await match(ctx, own.queue as MatchmakingQueue, now, (own.map ?? "baseRandom") as BaseMap);
      }
    } else if (d.op === "cancel") {
      const c = await ctx.db
        .query("matchmakingCancellations")
        .withIndex("by_player_ticket", (q) =>
          q.eq("player_id", d.player).eq("ticket", d.ticket),
        )
        .unique();
      if (c) await ctx.db.patch(c._id, { expires_at: now + 900000 });
      else
        await ctx.db.insert("matchmakingCancellations", {
          player_id: d.player,
          ticket: d.ticket,
          expires_at: now + 900000,
        });
      if (own && own.ticket === d.ticket && !own.room_code)
        await ctx.db.delete(own._id);
    }
    if (d.deferStatus) return null;
    return {
      ...(await status(ctx, d.player, d.account, Date.now())),
      rankedEligibility: account ? await eligibility(ctx, ids) : null,
    };
  },
});

// Queue counts are read after the allocation commits. Their broad predicate
// must not make unrelated joins and heartbeats conflict with one another.
export const read = query({
  args: { player: v.string(), account: v.union(v.string(), v.null()), map: v.optional(v.string()) },
  handler: async (ctx, { player, account, map }) => {
    await requireStorageServer(ctx);
    if (map !== undefined && !BASE_MAPS.includes(map as BaseMap)) fail("Choose an available map for this game mode.");
    const ids = account
      ? [player, ...(await aliases(ctx, account)).map((a) => a.player_id)]
      : [player];
    return {
      ...(await status(ctx, player, account, Date.now(), true, map as BaseMap | undefined)),
      rankedEligibility: account ? await eligibility(ctx, ids) : null,
    };
  },
});
