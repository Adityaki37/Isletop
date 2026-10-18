import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireStorageServer } from "./access";
import { requestQuota, reserveQuota } from "../lib/request-limit-policy";
export const reserve = mutation({
  args: {
    kind: v.union(
      v.literal("create"),
      v.literal("join"),
      v.literal("action"),
      v.literal("session"),
      v.literal("read"),
      v.literal("write"),
    ),
    scope: v.union(v.literal("network"), v.literal("player")),
    subject: v.string(),
  },
  handler: async (ctx, { kind, scope, subject }) => {
    await requireStorageServer(ctx);
    if (!/^[a-f0-9]{64}$/.test(subject))
      throw new Error("Invalid limiter identity.");
    const key = kind + ":" + scope + ":" + subject,
      now = Date.now(),
      policy = requestQuota(kind, scope);
    const row = await ctx.db
      .query("requestLimits")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const grant = reserveQuota(
      row,
      policy.max,
      policy.batch,
      policy.windowMs,
      now,
    );
    if (grant.granted) {
      const data = {
        key,
        window: grant.window,
        count: grant.count,
        expires: now + grant.validForMs + policy.windowMs,
      };
      if (row) await ctx.db.patch(row._id, data);
      else await ctx.db.insert("requestLimits", data);
      // Only disposable counters expire. Never touch rooms, accounts or replays.
      for (const stale of await ctx.db
        .query("requestLimits")
        .withIndex("by_expiry", (q) => q.lt("expires", now))
        .take(16))
        await ctx.db.delete(stale._id);
    }
    return { granted: grant.granted, validForMs: grant.validForMs };
  },
});
