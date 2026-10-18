import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { requireStorageServer } from "./access";
import { DEFAULT_AVATAR } from "../lib/avatars";
type Ctx = QueryCtx | MutationCtx;
export const accountById = (ctx: Ctx, id: string) =>
  ctx.db
    .query("accounts")
    .withIndex("by_account_id", (q) => q.eq("id", id))
    .unique();
export const playerOwner = (ctx: Ctx, id: string) =>
  ctx.db
    .query("accountPlayers")
    .withIndex("by_player", (q) => q.eq("player_id", id))
    .unique();
export const aliases = (ctx: Ctx, id: string) =>
  ctx.db
    .query("accountPlayers")
    .withIndex("by_account", (q) => q.eq("account_id", id))
    .collect();
export async function sessionValid(
  ctx: Ctx,
  hash: string | null,
  id: string | null,
  now: number,
) {
  if (!hash || !id) return false;
  const s = await ctx.db
    .query("accountSessions")
    .withIndex("by_token", (q) => q.eq("token_hash", hash))
    .unique();
  return !!s && s.account_id === id && s.expires_at > now;
}
const cleanRow = <T extends { _id: unknown; _creationTime: number }>(
  row: T | null,
) => {
  if (!row) return null;
  const { _id, _creationTime, ...data } = row;
  return data;
};
export const read = query({
  args: { op: v.string(), data: v.any() },
  handler: async (ctx, { op, data: d }) => {
    await requireStorageServer(ctx);
    if (op === "byUsername")
      return cleanRow(
        await ctx.db
          .query("accounts")
          .withIndex("by_username", (q) =>
            q.eq("username", String(d.username).toLowerCase()),
          )
          .unique(),
      );
    if (op === "byId") return cleanRow(await accountById(ctx, d.id));
    if (op === "owner") return cleanRow(await playerOwner(ctx, d.player));
    if (op === "aliases")
      return (await aliases(ctx, d.id)).map((x) => x.player_id);
    if (op === "sessionCount")
      return (
        await ctx.db
          .query("accountSessions")
          .withIndex("by_account", (q) => q.eq("account_id", d.id))
          .collect()
      ).length;
    if (op === "historyAliases") {
      // Match the prior store: only an account's primary player identity can
      // authorize all of its imported histories.
      const a = await ctx.db
        .query("accounts")
        .withIndex("by_player", (q) => q.eq("player_id", d.player))
        .unique();
      return a
        ? [d.player, ...(await aliases(ctx, a.id)).map((x) => x.player_id)]
        : [d.player];
    }
    if (op === "session") {
      const s = await ctx.db
        .query("accountSessions")
        .withIndex("by_token", (q) => q.eq("token_hash", d.hash))
        .unique();
      return s && s.expires_at > d.now
        ? cleanRow(await accountById(ctx, s.account_id))
        : null;
    }
    if (op === "overview") {
      const games = await ctx.db
        .query("matchPlayers")
        .withIndex("by_player", (q) => q.eq("playerId", d.player))
        .collect();
      const sessions = d.account
        ? (
            await ctx.db
              .query("accountSessions")
              .withIndex("by_account", (q) => q.eq("account_id", d.account))
              .collect()
          ).filter((x) => x.expires_at > d.now)
        : [];
      const rooms = await ctx.db.query("rooms").collect();
      return {
        guestGames: games.length,
        sessions: sessions.length,
        guestSeats: rooms.filter((r) => {
          const g = JSON.parse(r.state);
          return (
            g.phase !== "finished" &&
            g.players.some((p: { id: string }) => p.id === d.player)
          );
        }).length,
      };
    }
    if (op === "stats") {
      const players = await aliases(ctx, d.id),
        found = new Map<string, { id: string; mode: string; won: number }>();
      for (const p of players)
        for (const r of await ctx.db
          .query("matchPlayers")
          .withIndex("by_player", (q) => q.eq("playerId", p.player_id))
          .collect()) {
          const m = await ctx.db
            .query("matches")
            .withIndex("by_match", (q) => q.eq("matchId", r.matchId))
            .unique();
          if (m) {
            const old = found.get(m.matchId);
            found.set(m.matchId, {
              id: m.matchId,
              mode: JSON.parse(m.summary).mode,
              won: Math.max(old?.won ?? 0, r.won ? 1 : 0),
            });
          }
        }
      return [...found.values()];
    }
    throw new Error("Unknown account read.");
  },
});
export const write = mutation({
  args: { op: v.string(), data: v.any() },
  handler: async (ctx, { op, data: d }) => {
    await requireStorageServer(ctx);
    if (op === "register") {
      if (
        (await accountById(ctx, d.id)) ||
        (await playerOwner(ctx, d.player_id)) ||
        (await ctx.db
          .query("accounts")
          .withIndex("by_username", (q) => q.eq("username", d.username))
          .unique())
      )
        throw new Error("UNIQUE constraint: account identity");
      await ctx.db.insert("accounts", {
        ...d,
        bio: "",
        color: 0,
        avatar: DEFAULT_AVATAR,
        continent_code: "",
        country_code: "",
        region_code: "",
      });
      await ctx.db.insert("accountPlayers", {
        player_id: d.player_id,
        account_id: d.id,
      });
      return true;
    }
    if (op === "limit") {
      const row = await ctx.db
          .query("authLimits")
          .withIndex("by_key", (q) => q.eq("key", d.key))
          .unique(),
        count = row && row.window === d.window ? row.count + 1 : 1;
      if (row) await ctx.db.patch(row._id, { window: d.window, count });
      else
        await ctx.db.insert("authLimits", {
          key: d.key,
          window: d.window,
          count,
        });
      return count;
    }
    if (op === "cleanup") {
      for (const r of await ctx.db
        .query("authLimits")
        .withIndex("by_window", (q) => q.lt("window", d.window - 1))
        .take(100))
        await ctx.db.delete(r._id);
      for (const r of await ctx.db
        .query("accountSessions")
        .withIndex("by_expiry", (q) => q.lte("expires_at", d.now))
        .take(100))
        await ctx.db.delete(r._id);
      return true;
    }
    if (op === "issueSession") {
      const a = await accountById(ctx, d.id);
      if (!a || a.password_hash !== d.expected) return false;
      if (
        await ctx.db
          .query("accountSessions")
          .withIndex("by_token", (q) => q.eq("token_hash", d.hash))
          .unique()
      )
        throw new Error("Duplicate session.");
      await ctx.db.insert("accountSessions", {
        token_hash: d.hash,
        account_id: d.id,
        expires_at: d.expires,
      });
      return true;
    }
    if (op === "logout") {
      const rows = d.all
        ? await ctx.db
            .query("accountSessions")
            .withIndex("by_account", (q) => q.eq("account_id", d.id))
            .collect()
        : [
            await ctx.db
              .query("accountSessions")
              .withIndex("by_token", (q) => q.eq("token_hash", d.hash))
              .unique(),
          ];
      for (const r of rows) if (r) await ctx.db.delete(r._id);
      return true;
    }
    if (op === "profile" || op === "region") {
      const a = await accountById(ctx, d.id);
      if (!a) return false;
      const patch =
        op === "profile"
          ? {
              display_name: d.name,
              bio: d.bio,
              color: d.color,
              avatar: d.avatar,
            }
          : {
              continent_code: d.continentCode,
              country_code: d.countryCode,
              region_code: d.regionCode,
            };
      await ctx.db.patch(a._id, patch);
      return true;
    }
    if (op === "recovery") {
      const a = await accountById(ctx, d.id);
      if (!a || a.password_hash !== d.expected) return false;
      await ctx.db.patch(a._id, { recovery_hash: d.hash });
      return true;
    }
    if (op === "credentials") {
      if (d.column !== "password_hash" && d.column !== "recovery_hash")
        throw new Error("Invalid credential guard.");
      const a = await accountById(ctx, d.id);
      if (!a || a[d.column as "password_hash" | "recovery_hash"] !== d.expected)
        return false;
      for (const s of await ctx.db
        .query("accountSessions")
        .withIndex("by_account", (q) => q.eq("account_id", d.id))
        .collect())
        await ctx.db.delete(s._id);
      await ctx.db.patch(a._id, {
        password_hash: d.password,
        recovery_hash: d.recovery,
      });
      await ctx.db.insert("accountSessions", {
        token_hash: d.hash,
        account_id: d.id,
        expires_at: d.expires,
      });
      return true;
    }
    if (op === "import") {
      const owner = await playerOwner(ctx, d.player);
      if (owner) return owner.account_id === d.id;
      const players = await aliases(ctx, d.id);
      if (players.length >= 64 || !(await accountById(ctx, d.id))) return false;
      const ids = new Set(players.map((x) => x.player_id));
      for (const r of await ctx.db.query("rooms").collect()) {
        const g = JSON.parse(r.state);
        if (
          g.phase !== "finished" &&
          g.players.some((p: { id: string }) => p.id === d.player) &&
          g.players.some((p: { id: string }) => ids.has(p.id))
        )
          return false;
      }
      await ctx.db.insert("accountPlayers", {
        player_id: d.player,
        account_id: d.id,
      });
      return true;
    }
    throw new Error("Unknown account write.");
  },
});
