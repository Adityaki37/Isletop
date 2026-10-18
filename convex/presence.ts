import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { requireStorageServer } from "./access";
import { playerOwner, sessionValid, aliases, accountById } from "./accounts";
import { fail } from "./errors";
import type { Game } from "../lib/game";
import { scheduleTable } from "./tableTimers";
import { BOT_DISCONNECT_GRACE } from "../lib/table-presence";
async function schedulePresence(ctx: MutationCtx, code: string) {
  const r = await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
  if (r) await scheduleTable(ctx, r._id, JSON.parse(r.state));
}
type Ctx = QueryCtx | MutationCtx;
export async function roomGame(ctx: Ctx, code: string) {
  const r = await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
  return r ? (JSON.parse(r.state) as Game) : null;
}
async function validLease(
  ctx: Ctx,
  l: {
    player_id: string;
    account_id: string | null;
    session_hash: string | null;
    expires_at: number;
  },
  now: number,
) {
  if (l.expires_at <= now) return false;
  return l.account_id
    ? sessionValid(ctx, l.session_hash, l.account_id, now)
    : !(await playerOwner(ctx, l.player_id));
}
export const expiries = query({
  args: { code: v.string(), created: v.number(), players: v.array(v.string()) },
  handler: async (ctx, a) => {
    await requireStorageServer(ctx);
    const rows = await ctx.db
      .query("tableConnections")
      .withIndex("by_room", (q) =>
        q.eq("room_code", a.code).eq("room_created", a.created),
      )
      .collect();
    return a.players.map((id) => {
      const xs = rows.filter((r) => r.player_id === id);
      return xs.length ? Math.max(...xs.map((r) => r.expires_at)) : null;
    });
  },
});
export const seats = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    await requireStorageServer(ctx);
    const g = await roomGame(ctx, code);
    if (!g) fail("Room not found.", 404);
    const now = Date.now(),
      active = new Set<string>();
    for (const l of await ctx.db
      .query("tableConnections")
      .withIndex("by_room", (q) =>
        q.eq("room_code", code).eq("room_created", g.created),
      )
      .collect()) {
      if (!(await validLease(ctx, l, now))) continue;
      if (
        l.account_id &&
        (await playerOwner(ctx, l.player_id))?.account_id !== l.account_id
      )
        continue;
      active.add(l.player_id);
    }
    return {
      created: g.created,
      connected: g.players.map((p) => active.has(p.id)),
    };
  },
});
export const connection = mutation({
  args: { data: v.any() },
  handler: async (ctx, { data: d }) => {
    await requireStorageServer(ctx);
    const now = Date.now(),
      old = await ctx.db
        .query("tableConnections")
        .withIndex("by_token", (q) => q.eq("token", d.token))
        .unique();
    if (d.op === "release") {
      if (
        old &&
        old.room_code === d.code &&
        old.room_created === d.created &&
        (old.player_id === d.player ||
          (d.account &&
            old.account_id === d.account &&
            (await playerOwner(ctx, old.player_id))?.account_id === d.account))
      )
        await ctx.db.patch(old._id, {
          expires_at: Math.min(old.expires_at, now),
        });
      await schedulePresence(ctx, d.code);
      return true;
    }
    const g = await roomGame(ctx, d.code);
    if (!g) fail("Room not found.", 404);
    if (g.created !== d.created)
      fail("The table restarted. Reconnect to the new game.", 409);
    if (!g.players.some((p) => p.id === d.player))
      fail("Only seated players can announce a connection.", 403);
    const owner = await playerOwner(ctx, d.player);
    if (
      d.account
        ? owner?.account_id !== d.account ||
          !(await sessionValid(ctx, d.hash, d.account, now))
        : !!owner
    )
      fail("Sign in again to reconnect.", 401);
    if (
      old &&
      (old.player_id !== d.player ||
        old.room_code !== d.code ||
        old.room_created !== d.created)
    )
      fail("Use a new connection for this seat and table.", 403);
    const value = {
      token: d.token,
      room_code: d.code,
      room_created: d.created,
      player_id: d.player,
      account_id: d.account,
      session_hash: d.hash,
      // A hidden tab yields immediately. A visible lease in another tab still
      // keeps the same seat under human control through the maximum expiry.
      expires_at: d.op === "away" ? now - BOT_DISCONNECT_GRACE : now + d.ttl,
    };
    if (old) await ctx.db.patch(old._id, value);
    else await ctx.db.insert("tableConnections", value);
    for (const r of await ctx.db
      .query("tableConnections")
      .withIndex("by_expiry", (q) => q.lte("expires_at", now - 86400000))
      .take(100))
      await ctx.db.delete(r._id);
    await schedulePresence(ctx, d.code);
    return true;
  },
});
export const spectators = query({
  args: { code: v.string(), cursor: v.number() },
  handler: async (ctx, { code, cursor }) => {
    await requireStorageServer(ctx);
    const g = await roomGame(ctx, code);
    if (!g) fail("Room not found.", 404);
    const now = Date.now(),
      grouped = new Map<
        string,
        {
          id: string;
          name: string;
          username: string | null;
          color: number | null;
          avatar: string | null;
          first: number;
          expires: number;
        }
      >();
    for (const l of await ctx.db
      .query("spectatorLeases")
      .withIndex("by_room", (q) =>
        q.eq("room_code", code).eq("room_created", g.created),
      )
      .collect()) {
      if (!(await validLease(ctx, l, now))) continue;
      const ids = l.account_id
        ? (await aliases(ctx, l.account_id)).map((x) => x.player_id)
        : [l.player_id];
      if (g.players.some((p) => ids.includes(p.id))) continue;
      const a = l.account_id ? await accountById(ctx, l.account_id) : null,
        prev = grouped.get(l.viewer_key);
      const value = {
        id: l.public_id,
        name: a?.display_name ?? l.guest_name,
        username: a?.username ?? null,
        color: a?.color ?? null,
        avatar: a?.avatar ?? null,
        first: Math.min(l.joined_at, prev?.first ?? Infinity),
        expires: l.expires_at,
      };
      if (
        !prev ||
        value.expires > prev.expires ||
        (value.expires === prev.expires && value.id < prev.id)
      )
        grouped.set(l.viewer_key, value);
      else prev.first = value.first;
    }
    const rows = [...grouped.values()].sort(
      (a, b) => a.first - b.first || a.id.localeCompare(b.id),
    );
    return {
      count: rows.length,
      spectators: rows
        .slice(cursor, cursor + 100)
        .map(({ first, expires, ...data }) => data),
      next: rows.length > cursor + 100 ? cursor + 100 : null,
    };
  },
});
export const spectator = mutation({
  args: { data: v.any() },
  handler: async (ctx, { data: d }) => {
    await requireStorageServer(ctx);
    const now = Date.now();
    let old = await ctx.db
      .query("spectatorLeases")
      .withIndex("by_token", (q) => q.eq("token", d.token))
      .unique();
    if (d.op === "unwatch") {
      if (
        old &&
        old.room_code === d.code &&
        old.room_created === d.created &&
        [d.viewer, d.guest].includes(old.viewer_key)
      )
        await ctx.db.delete(old._id);
      return { ok: true };
    }
    // A revoked or expired account lease no longer owns a viewer connection.
    // It may become a fresh guest connection without retaining account data.
    if (old && !(await validLease(ctx, old, now))) {
      await ctx.db.delete(old._id);
      old = null;
    }
    const g = await roomGame(ctx, d.code);
    if (!g) fail("Room not found.", 404);
    if (g.created !== d.created)
      fail("The table restarted. Reconnecting…", 409);
    if (old && (old.room_code !== d.code || old.room_created !== g.created))
      fail("Use a new connection for this table.", 409);
    if (old && old.viewer_key !== d.viewer) {
      if (!d.account || old.viewer_key !== d.guest)
        fail("This connection belongs to another viewer.", 403);
      await ctx.db.delete(old._id);
      old = null;
    }
    if (d.account && !(await sessionValid(ctx, d.hash, d.account, now)))
      fail("Sign in again to reconnect.", 401);
    const claimed = await playerOwner(ctx, d.player),
      ids = d.account
        ? (await aliases(ctx, d.account)).map((x) => x.player_id)
        : [d.player];
    if ((!d.account && claimed) || g.players.some((p) => ids.includes(p.id)))
      return { ok: true, viewerId: d.publicId, name: null, username: null };
    const previous = await ctx.db
      .query("spectatorLeases")
      .withIndex("by_viewer", (q) =>
        q
          .eq("viewer_key", d.viewer)
          .eq("room_code", d.code)
          .eq("room_created", g.created),
      )
      .collect();
    previous.sort((a, b) => b.expires_at - a.expires_at);
    const name =
      d.name ??
      old?.guest_name ??
      previous[0]?.guest_name ??
      `Guest ${d.publicId.slice(0, 4).toUpperCase()}`;
    const value = {
      token: d.token,
      public_id: d.publicId,
      room_code: d.code,
      room_created: g.created,
      viewer_key: d.viewer,
      player_id: d.player,
      account_id: d.account,
      session_hash: d.hash,
      guest_name: name,
      joined_at: old?.joined_at ?? now,
      expires_at: now + d.ttl,
    };
    if (old) await ctx.db.patch(old._id, value);
    else await ctx.db.insert("spectatorLeases", value);
    if (d.name && !d.account)
      for (const r of previous)
        await ctx.db.patch(r._id, { guest_name: d.name });
    for (const r of await ctx.db
      .query("spectatorLeases")
      .withIndex("by_expiry", (q) => q.lte("expires_at", now))
      .take(100))
      await ctx.db.delete(r._id);
    const a = d.account ? await accountById(ctx, d.account) : null;
    return {
      ok: true,
      viewerId: d.publicId,
      name: a?.display_name ?? name,
      username: a?.username ?? null,
    };
  },
});
