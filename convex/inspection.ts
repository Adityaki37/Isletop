// Trusted-server diagnostics; no browser or anonymous access.
import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireStorageServer } from "./access";
export const read = query({
  args: { op: v.string(), key: v.string(), after: v.optional(v.number()) },
  handler: async (ctx, { op, key, after }) => {
    await requireStorageServer(ctx);
    if (op === "deployment") {
      const timers = await ctx.db.query("roomTimers").collect();
      let pendingTimers = 0;
      for (const timer of timers) {
        if (
          timer.wakeId &&
          (await ctx.db.system.get(timer.wakeId))?.state.kind === "pending"
        )
          pendingTimers++;
      }
      return {
        sourceCommit: process.env.SOURCE_COMMIT ?? null,
        sourceDigest: process.env.SOURCE_DIGEST ?? null,
        timers: timers.length,
        pendingTimers,
      };
    }
    if (op === "rooms")
      return (await ctx.db.query("rooms").collect()).map((r) => {
        const g = JSON.parse(r.state);
        return {
          code: r.code,
          created: g.created,
          host: g.players[0]?.name,
          phase: g.phase,
          updated: r.updated,
          ranked: !!g.ranked,
        };
      });
    if (op === "spectatorLease")
      return ctx.db
        .query("spectatorLeases")
        .withIndex("by_room", (q) => q.eq("room_code", key))
        .first();
    if (op === "notice")
      return ctx.db
        .query("socialNotifications")
        .withIndex("by_notice", (q) => q.eq("id", key))
        .unique();
    if (op === "replay")
      return {
        header: await ctx.db
          .query("replays")
          .withIndex("by_match", (q) => q.eq("matchId", key))
          .unique(),
        frames: await ctx.db
          .query("replayEvents")
          .withIndex("by_match_sequence", (q) =>
            q.eq("matchId", key).gt("sequence", after ?? -1),
          )
          .order("asc")
          .collect(),
      };
    if (op === "ratings")
      return {
        result: await ctx.db
          .query("rankedResults")
          .withIndex("by_match", (q) => q.eq("matchId", key))
          .unique(),
        ratings: await ctx.db.query("ratings").collect(),
      };
    throw new Error("Unknown inspection.");
  },
});

// CLI-only disposal of explicitly enumerated development QA generations.
// It is disabled in production and preserves every ranked table and archive.
export const cleanupDevelopmentRooms = internalMutation({
  args: { rooms: v.array(v.object({ code: v.string(), created: v.number() })) },
  handler: async (ctx, { rooms }) => {
    if (process.env.QA_CLEANUP_ALLOWED !== "local-development-only")
      throw new Error("Development cleanup is not enabled on this deployment.");
    if (rooms.length > 25) throw new Error("Cleanup batch is too large.");
    for (const expected of rooms) {
      const row = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", expected.code))
        .unique();
      if (!row) continue;
      const g = JSON.parse(row.state);
      if (g.created !== expected.created || g.ranked)
        throw new Error("A protected table generation cannot be deleted.");
      const timer = await ctx.db
        .query("roomTimers")
        .withIndex("by_code", (q) => q.eq("code", expected.code))
        .unique();
      for (const id of [row.wakeId, timer?.wakeId])
        if (id) {
          const job = await ctx.db.system.get(id);
          if (job?.state.kind === "pending") await ctx.scheduler.cancel(id);
        }
      for (const table of ["tableConnections", "spectatorLeases"] as const)
        for (const lease of await ctx.db
          .query(table)
          .withIndex("by_room", (q) => q.eq("room_code", expected.code))
          .collect())
          await ctx.db.delete(lease._id);
      if (timer) await ctx.db.delete(timer._id);
      await ctx.db.delete(row._id);
    }
    return { deleted: rooms.length };
  },
});

// Deletes only explicitly identified disposable load-test or hosted queue tables.
// Results and immutable replay archives are retained. No fixture grants exist.
export const cleanupLoadRooms = mutation({
  args: { rooms: v.array(v.object({ code: v.string(), created: v.number() })) },
  handler: async (ctx, { rooms }) => {
    await requireStorageServer(ctx);
    if (rooms.length > 20) throw new Error("Cleanup batch is too large.");
    for (const expected of rooms) {
      const row = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", expected.code))
        .unique();
      if (!row) continue;
      const g = JSON.parse(row.state);
      const privateLoad =
        !g.public && /^Live QA \d+\/0$/.test(g.players[0]?.name ?? "");
      const hostedQueue =
        g.mode === "duel" &&
        !g.ranked &&
        g.players.length === 2 &&
        g.players.every((p: { name: string }) =>
          /^Hosted Queue QA \d{1,2}$/.test(p.name),
        );
      if (g.created !== expected.created || (!privateLoad && !hostedQueue))
        throw new Error(
          "Cleanup is restricted to an exact disposable QA generation.",
        );
      const timer = await ctx.db
        .query("roomTimers")
        .withIndex("by_code", (q) => q.eq("code", expected.code))
        .unique();
      for (const wakeId of [row.wakeId, timer?.wakeId])
        if (wakeId) {
          const job = await ctx.db.system.get(wakeId);
          if (job?.state.kind === "pending") await ctx.scheduler.cancel(wakeId);
        }
      for (const lease of await ctx.db
        .query("tableConnections")
        .withIndex("by_room", (q) => q.eq("room_code", expected.code))
        .collect())
        await ctx.db.delete(lease._id);
      for (const lease of await ctx.db
        .query("spectatorLeases")
        .withIndex("by_room", (q) => q.eq("room_code", expected.code))
        .collect())
        await ctx.db.delete(lease._id);
      if (timer) await ctx.db.delete(timer._id);
      await ctx.db.delete(row._id);
    }
    return null;
  },
});
