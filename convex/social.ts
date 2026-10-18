import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireStorageServer } from "./access";
import { accountById, aliases, playerOwner } from "./accounts";
import { publicProfile } from "./profiles";
import { roomGame } from "./presence";
import { fail } from "./errors";
import type { Game } from "../lib/game";
import type { SocialOverview, SocialLookup } from "../lib/social-types";
type Ctx = QueryCtx | MutationCtx;
const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]);
const block = (ctx: Ctx, a: string, b: string) =>
  ctx.db
    .query("socialBlocks")
    .withIndex("by_pair", (q) => q.eq("owner", a).eq("target", b))
    .unique();
export const allowed = async (ctx: Ctx, a: string, b: string) =>
  !(await block(ctx, a, b)) && !(await block(ctx, b, a));
export const relation = (ctx: Ctx, a: string, b: string) => {
  const [low, high] = pair(a, b);
  return ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("low", low).eq("high", high))
    .unique();
};
const relations = async (ctx: Ctx, id: string) => [
  ...(await ctx.db
    .query("friendships")
    .withIndex("by_low", (q) => q.eq("low", id))
    .collect()),
  ...(await ctx.db
    .query("friendships")
    .withIndex("by_high", (q) => q.eq("high", id))
    .collect()),
];
const isFriend = async (ctx: Ctx, a: string, b: string) =>
  (await relation(ctx, a, b))?.status === "accepted" &&
  (await allowed(ctx, a, b));
async function target(ctx: Ctx, value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_]{3,24}$/.test(value.trim()))
    fail("Choose a valid username.");
  const a = await ctx.db
    .query("accounts")
    .withIndex("by_username", (q) =>
      q.eq("username", value.trim().toLowerCase()),
    )
    .unique();
  if (!a) fail("Player profile not found.", 404);
  return a;
}
async function ownedRoom(
  ctx: Ctx,
  owner: string,
  code: string,
  created?: number | null,
) {
  const g = await roomGame(ctx, code);
  if (
    !g ||
    g.phase === "finished" ||
    (created != null && g.created !== created)
  )
    return null;
  const ids = (await aliases(ctx, owner)).map((x) => x.player_id);
  return g.players.some((p) => ids.includes(p.id)) ? g : null;
}
const summary = (g: Game) => ({
  code: g.code,
  title: g.title,
  mode: g.mode,
  created: g.created,
  phase: g.phase === "lobby" ? ("lobby" as const) : ("playing" as const),
  players: g.players.length,
  capacity: g.capacity,
  joinable: g.phase === "lobby" && g.players.length < g.capacity,
});
const notes = (ctx: Ctx, id: string) =>
  ctx.db
    .query("socialNotifications")
    .withIndex("by_recipient", (q) => q.eq("recipient", id))
    .order("desc")
    .collect();
export const lookup = query({
  args: { owner: v.string(), username: v.string() },
  handler: async (ctx, { owner, username }): Promise<SocialLookup> => {
    await requireStorageServer(ctx);
    const a = await target(ctx, username),
      out: SocialLookup = {
        profile: publicProfile(a),
        relationship: "none",
        id: null,
      };
    if (owner === a.id) return { ...out, relationship: "self" };
    if (await block(ctx, owner, a.id))
      return { ...out, relationship: "blocked" };
    if (!(await allowed(ctx, owner, a.id)))
      return { ...out, relationship: "unavailable" };
    const r = await relation(ctx, owner, a.id);
    return r
      ? {
          ...out,
          id: r.id,
          relationship:
            r.status === "accepted"
              ? "friends"
              : r.requester === owner
                ? "outgoing"
                : "incoming",
        }
      : out;
  },
});
export const overview = query({
  args: { owner: v.string(), code: v.union(v.string(), v.null()) },
  handler: async (ctx, { owner, code }): Promise<SocialOverview> => {
    await requireStorageServer(ctx);
    const now = Date.now(),
      presence = await ctx.db
        .query("socialPresence")
        .withIndex("by_account", (q) => q.eq("account_id", owner))
        .unique();
    const out: SocialOverview = {
      friends: [],
      incoming: [],
      outgoing: [],
      blocked: [],
      notifications: [],
      showPresence: presence?.show_presence ?? true,
      unread: 0,
      roomPlayers: [],
    };
    for (const b of await ctx.db
      .query("socialBlocks")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .collect()) {
      const a = await accountById(ctx, b.target);
      if (a) out.blocked.push(publicProfile(a));
    }
    out.blocked.sort((a, b) => a.username.localeCompare(b.username));
    const rs = await relations(ctx, owner),
      rows = [];
    for (const r of rs) {
      const other = r.low === owner ? r.high : r.low;
      if (!(await allowed(ctx, owner, other))) continue;
      const a = await accountById(ctx, other);
      if (!a) continue;
      const p = await ctx.db
        .query("socialPresence")
        .withIndex("by_account", (q) => q.eq("account_id", other))
        .unique();
      rows.push({ r, a, p });
    }
    rows.sort(
      (a, b) =>
        (b.p?.show_presence ? b.p.seen_at : 0) -
          (a.p?.show_presence ? a.p.seen_at : 0) ||
        a.a.username.localeCompare(b.a.username),
    );
    for (const { r, a, p } of rows.slice(0, 200)) {
      const accepted = r.status === "accepted",
        sessions =
          accepted && p?.show_presence
            ? await ctx.db
                .query("accountSessions")
                .withIndex("by_account", (q) => q.eq("account_id", a.id))
                .collect()
            : [];
      const visible = accepted && p?.show_presence,
        online =
          !!visible &&
          sessions.some((s) => s.expires_at > now) &&
          p!.seen_at > now - 75000;
      const g =
        online && p?.room_code
          ? await ownedRoom(ctx, a.id, p.room_code, p.room_created)
          : null;
      (accepted
        ? out.friends
        : r.requester === owner
          ? out.outgoing
          : out.incoming
      ).push({
        id: r.id,
        createdAt: r.created_at,
        player: {
          profile: publicProfile(a),
          online,
          lastSeen: visible && p?.seen_at ? p.seen_at : null,
          room: g ? summary(g) : null,
        },
      });
    }
    for (const n of await notes(ctx, owner)) {
      if (n.expires_at <= now || !(await isFriend(ctx, owner, n.sender)))
        continue;
      const a = await accountById(ctx, n.sender);
      if (!a) continue;
      const g =
        n.kind === "invite" && n.room_code
          ? await ownedRoom(ctx, n.sender, n.room_code, n.room_created)
          : null;
      out.notifications.push({
        id: n.id,
        kind: n.kind,
        sender: publicProfile(a),
        createdAt: n.created_at,
        read: n.read,
        room: g ? summary(g) : null,
      });
      if (out.notifications.length >= 200) break;
    }
    out.unread =
      out.incoming.length + out.notifications.filter((n) => !n.read).length;
    const g = code ? await ownedRoom(ctx, owner, code) : null;
    if (g)
      for (let seat = 0; seat < g.players.length; seat++) {
        const id = await playerOwner(ctx, g.players[seat].id),
          a = id ? await accountById(ctx, id.account_id) : null;
        if (a) out.roomPlayers.push({ seat, profile: publicProfile(a) });
      }
    return out;
  },
});
async function limit(
  ctx: MutationCtx,
  owner: string,
  kind: string,
  max: number,
) {
  const key = `social:${kind}:${owner}`,
    window = Math.floor(Date.now() / 900000),
    r = await ctx.db
      .query("authLimits")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique(),
    count = r && r.window === window ? r.count + 1 : 1;
  if (count > max)
    fail("Too many social requests. Try again in fifteen minutes.", 429);
  if (r) await ctx.db.patch(r._id, { window, count });
  else await ctx.db.insert("authLimits", { key, window, count });
}
const codeInput = (raw: unknown) => {
  if (typeof raw !== "string" || !/^[A-Z2-9]{6}$/.test(raw))
    fail("Choose an available room.");
  return raw;
};
const idInput = (raw: unknown) => {
  if (typeof raw !== "string" || !/^[a-f0-9-]{36}$/.test(raw))
    fail("Choose an available request or notification.");
  return raw;
};
async function deleteNotices(ctx: MutationCtx, a: string, b: string) {
  for (const n of [...(await notes(ctx, a)), ...(await notes(ctx, b))])
    if (
      (n.sender === a && n.recipient === b) ||
      (n.sender === b && n.recipient === a)
    )
      await ctx.db.delete(n._id);
}
export const action = mutation({
  args: { owner: v.string(), body: v.any() },
  handler: async (ctx, { owner, body: b }) => {
    await requireStorageServer(ctx);
    if (!(await accountById(ctx, owner)))
      fail("Sign in to manage friends.", 401);
    const now = Date.now(),
      op = b.op;
    if (op === "presence" || op === "preferences") {
      const old = await ctx.db
        .query("socialPresence")
        .withIndex("by_account", (q) => q.eq("account_id", owner))
        .unique();
      if (op === "preferences") {
        await limit(ctx, owner, "mutation", 240);
        if (typeof b.showPresence !== "boolean")
          fail("Choose an online status preference.");
      }
      const code =
          op === "presence" && b.code != null ? codeInput(b.code) : null,
        g = code ? await ownedRoom(ctx, owner, code) : null;
      if (code && !g) fail("Join this room before sharing your presence.", 403);
      const value = {
        account_id: owner,
        seen_at: op === "presence" ? now : (old?.seen_at ?? 0),
        show_presence:
          op === "preferences" ? b.showPresence : (old?.show_presence ?? true),
        room_code: op === "presence" ? code : (old?.room_code ?? null),
        room_created:
          op === "presence"
            ? (g?.created ?? null)
            : (old?.room_created ?? null),
      };
      if (old) await ctx.db.patch(old._id, value);
      else await ctx.db.insert("socialPresence", value);
      return { ok: true };
    }
    await limit(ctx, owner, "mutation", 240);
    if (op === "readAll") {
      for (const n of await notes(ctx, owner))
        await ctx.db.patch(n._id, { read: true });
      return { ok: true };
    }
    if (["read", "dismiss", "openInvite"].includes(op)) {
      const id = idInput(b.id),
        n = await ctx.db
          .query("socialNotifications")
          .withIndex("by_notice", (q) => q.eq("id", id))
          .unique();
      if (!n || n.recipient !== owner) fail("Notification not found.", 404);
      if (op === "openInvite") {
        if (
          n.kind !== "invite" ||
          n.expires_at <= now ||
          !(await isFriend(ctx, owner, n.sender))
        )
          fail("This invitation is no longer available.", 404);
        const g = n.room_code
          ? await ownedRoom(ctx, n.sender, n.room_code, n.room_created)
          : null;
        if (!g) fail("This invitation’s game has ended.", 410);
        await ctx.db.patch(n._id, { read: true });
        return { room: summary(g) };
      }
      if (op === "dismiss") await ctx.db.delete(n._id);
      else await ctx.db.patch(n._id, { read: true });
      return { ok: true };
    }
    if (["accept", "decline", "cancel", "remove"].includes(op)) {
      const id = idInput(b.id),
        f = await ctx.db
          .query("friendships")
          .withIndex("by_friendship", (q) => q.eq("id", id))
          .unique();
      if (!f || (f.low !== owner && f.high !== owner))
        fail("This friend request is no longer available.", 404);
      const other = f.low === owner ? f.high : f.low;
      if (op === "accept") {
        if (f.requester === owner)
          fail("Only the recipient can accept this request.", 403);
        if (f.status === "accepted") return { ok: true };
        if (!(await allowed(ctx, owner, other)))
          fail("This friend request is no longer available.", 404);
        await ctx.db.patch(f._id, { status: "accepted" });
        if (
          !(await ctx.db
            .query("socialNotifications")
            .withIndex("by_notice", (q) => q.eq("id", id))
            .unique())
        )
          await ctx.db.insert("socialNotifications", {
            id,
            recipient: other,
            sender: owner,
            kind: "accepted",
            room_code: null,
            room_created: null,
            created_at: now,
            expires_at: now + 2592000000,
            read: false,
          });
      } else {
        if (
          op === "cancel" &&
          (f.requester !== owner || f.status !== "pending")
        )
          fail("Only the sender can cancel a pending request.", 403);
        if (
          op === "decline" &&
          (f.requester === owner || f.status !== "pending")
        )
          fail("Only the recipient can decline a pending request.", 403);
        if (op === "remove" && f.status !== "accepted")
          fail("This player is not on your friends list.");
        await deleteNotices(ctx, owner, other);
        await ctx.db.delete(f._id);
      }
      return { ok: true };
    }
    if (!["request", "block", "unblock", "invite"].includes(op))
      fail("Unknown social operation.");
    const a = await target(ctx, b.username);
    if (a.id === owner) fail("Choose another player.");
    const [low, high] = pair(owner, a.id),
      f = await relation(ctx, owner, a.id);
    if (op === "block") {
      if (!(await block(ctx, owner, a.id))) {
        if (
          (
            await ctx.db
              .query("socialBlocks")
              .withIndex("by_owner", (q) => q.eq("owner", owner))
              .collect()
          ).length >= 200
        )
          fail("Your blocked list is full.", 409);
        await ctx.db.insert("socialBlocks", { owner, target: a.id });
      }
      if (f) await ctx.db.delete(f._id);
      await deleteNotices(ctx, owner, a.id);
      return { ok: true };
    }
    if (op === "unblock") {
      const r = await block(ctx, owner, a.id);
      if (r) await ctx.db.delete(r._id);
      return { ok: true };
    }
    if (op === "request") {
      await limit(ctx, owner, "request", 30);
      if (!(await allowed(ctx, owner, a.id)))
        fail("A friend request cannot be sent to this player.", 409);
      if (!f) {
        if (
          (await relations(ctx, owner)).length >= 200 ||
          (await relations(ctx, a.id)).length >= 200
        )
          fail("A friend request cannot be sent to this player.", 409);
        await ctx.db.insert("friendships", {
          id: crypto.randomUUID(),
          low,
          high,
          requester: owner,
          status: "pending",
          created_at: now,
        });
      }
      return { ok: true };
    }
    await limit(ctx, owner, "invite", 60);
    const code = codeInput(b.code),
      g = await ownedRoom(ctx, owner, code);
    if (!g) fail("Join this room before inviting friends.", 403);
    if (!(await isFriend(ctx, owner, a.id)))
      fail("Add this player as a friend before inviting them.", 403);
    if (g.phase !== "lobby" || g.players.length >= g.capacity)
      fail("This room is not accepting players.", 409);
    if (await ownedRoom(ctx, a.id, code))
      fail("This friend is already at the table.", 409);
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(`${owner}:${a.id}:${code}:${g.created}`),
        ),
      ),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
    if (
      !(await ctx.db
        .query("socialNotifications")
        .withIndex("by_notice", (q) => q.eq("id", id))
        .unique())
    )
      await ctx.db.insert("socialNotifications", {
        id,
        recipient: a.id,
        sender: owner,
        kind: "invite",
        room_code: code,
        room_created: g.created,
        created_at: now,
        expires_at: now + 3600000,
        read: false,
      });
    const all = await notes(ctx, a.id);
    let active = 0;
    for (const n of all) {
      if (n.expires_at <= now || active >= 200) await ctx.db.delete(n._id);
      else active++;
    }
    return { ok: true };
  },
});
