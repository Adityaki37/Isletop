import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireStorageServer } from "./access";
import { fail } from "./errors";

export const result = query({
  args: { match: v.string() },
  handler: async (ctx, { match }) => {
    await requireStorageServer(ctx);
    const row = await ctx.db
      .query("matches")
      .withIndex("by_match", (q) => q.eq("matchId", match))
      .unique();
    return row
      ? { summary: JSON.parse(row.summary), game: JSON.parse(row.result) }
      : null;
  },
});
export const list = query({
  args: {
    players: v.array(v.string()),
    before: v.optional(v.object({ at: v.number(), id: v.string() })),
  },
  handler: async (ctx, { players, before }) => {
    await requireStorageServer(ctx);
    const pages = await Promise.all(
      players.map((player) => {
        let q = ctx.db
          .query("matchPlayers")
          .withIndex("by_player_finished", (q) => q.eq("playerId", player));
        if (before)
          q = q.filter((q) =>
            q.or(
              q.lt(q.field("finishedAt"), before.at),
              q.and(
                q.eq(q.field("finishedAt"), before.at),
                q.lt(q.field("matchId"), before.id),
              ),
            ),
          );
        return q.order("desc").take(21);
      }),
    );
    const ids = [...new Set(pages.flat().map((p) => p.matchId))];
    const matches = (
      await Promise.all(
        ids.map((id) =>
          ctx.db
            .query("matches")
            .withIndex("by_match", (q) => q.eq("matchId", id))
            .unique(),
        ),
      )
    )
      .filter((r) => r !== null)
      .sort(
        (a, b) =>
          b.finishedAt - a.finishedAt || b.matchId.localeCompare(a.matchId),
      );
    const page = matches.slice(0, 20),
      last = page.at(-1);
    return {
      matches: page.map((r) => JSON.parse(r.summary)),
      next:
        matches.length > 20 && last
          ? { at: last.finishedAt, id: last.matchId }
          : null,
    };
  },
});
export const shareReplay = mutation({
  args: { match: v.string(), players: v.array(v.string()), share: v.string() },
  handler: async (ctx, { match, players, share }) => {
    await requireStorageServer(ctx);
    const result = await ctx.db
      .query("matches")
      .withIndex("by_match", (q) => q.eq("matchId", match))
      .unique();
    if (!result || !players.some((p) => result.participants.includes(p)))
      return null;
    const replay = await ctx.db
      .query("replays")
      .withIndex("by_match", (q) => q.eq("matchId", match))
      .unique();
    if (!replay) return null;
    if (!replay.shareId) await ctx.db.patch(replay._id, { shareId: share });
    return replay.shareId ?? share;
  },
});
export const replayPage = query({
  args: {
    match: v.union(v.string(), v.null()),
    share: v.union(v.string(), v.null()),
    players: v.array(v.string()),
    after: v.optional(v.number()),
    includeHeader: v.optional(v.boolean()),
  },
  handler: async (ctx, { match, share, players, after, includeHeader }) => {
    await requireStorageServer(ctx);
    const replay = share
      ? await ctx.db
          .query("replays")
          .withIndex("by_share", (q) => q.eq("shareId", share))
          .unique()
      : match
        ? await ctx.db
            .query("replays")
            .withIndex("by_match", (q) => q.eq("matchId", match))
            .unique()
        : null;
    if (!replay) return null;
    const result = await ctx.db
      .query("matches")
      .withIndex("by_match", (q) => q.eq("matchId", replay.matchId))
      .unique();
    if (
      !result ||
      (!share && !players.some((p) => result.participants.includes(p)))
    )
      return null;
    const cursor = after ?? replay.initialSequence;
    if (cursor < replay.initialSequence || cursor > replay.lastSequence)
      fail("Choose a valid replay action.");
    const records = await ctx.db
      .query("replayEvents")
      .withIndex("by_match_sequence", (q) =>
        q.eq("matchId", replay.matchId).gt("sequence", cursor),
      )
      .order("asc")
      .take(201);
    const page = records.slice(0, 200),
      frames = page.map((r) => JSON.parse(r.frame));
    if (
      cursor < replay.lastSequence &&
      (page[0]?.sequence !== cursor + 1 ||
        page.some((r, i) => i > 0 && r.sequence !== page[i - 1].sequence + 1))
    )
      throw new Error("The saved replay is incomplete.");
    return {
      id: replay.matchId,
      version: 1,
      complete: replay.complete,
      initialSequence: replay.initialSequence,
      lastSequence: replay.lastSequence,
      frames,
      next: records.length > 200 ? page.at(-1)!.sequence : null,
      // Existing callers retain the full page contract. The current browser
      // requests only frames after its first page; never suppress that header.
      ...(includeHeader === false && after !== undefined
        ? {}
        : {
            initial: JSON.parse(replay.initial),
            summary: JSON.parse(result.summary),
          }),
    };
  },
});
