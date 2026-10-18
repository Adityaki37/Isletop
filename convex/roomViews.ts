import { query } from "./_generated/server";
import { v } from "convex/values";
import { normalizeGame, view, type Game } from "../lib/game";
import { playerOwner, sessionValid } from "./accounts";

// Browser subscriptions receive only the same seat-specific projection as the
// existing HTTP endpoint. Seat identity is signed, never supplied as an arg.
export const table = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.role !== "player")
      throw new Error("Sign in to this table session again.");
    const saved = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!saved) return null;
    const g = normalizeGame(JSON.parse(saved.state) as Game);
    const aliases =
      typeof identity.aliases === "string"
        ? (JSON.parse(identity.aliases) as unknown)
        : [];
    const ids = [
      identity.subject,
      ...(Array.isArray(aliases)
        ? aliases.filter((id): id is string => typeof id === "string")
        : []),
    ];
    const account =
        typeof identity.account === "string" ? identity.account : null,
      session = typeof identity.session === "string" ? identity.session : null;
    const valid = account
      ? await sessionValid(ctx, session, account, Date.now())
      : !(await playerOwner(ctx, identity.subject));
    const own = valid ? g.players.find((p) => ids.includes(p.id)) : null;
    return view(g, own?.id ?? null);
  },
});
export const directory = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const rows = await ctx.db
      .query("rooms")
      .withIndex("by_public_updated", (q) =>
        q.eq("public", true).gt("updated", since),
      )
      .order("desc")
      .take(100);
    const games = rows.map((r) => JSON.parse(r.directory));
    return {
      rooms: games
        .filter((g) => g.phase === "lobby" && g.players < g.capacity)
        .slice(0, 20),
      games: games
        .filter((g) => g.phase !== "lobby" && g.phase !== "finished")
        .slice(0, 20),
    };
  },
});
