import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireStorageServer } from "./access";
import { normalizeGame, type Game } from "../lib/game";
import { archivedMatch } from "../lib/match-history";
import { rankedView } from "../lib/ranked";
import type { ReplayCapture } from "../lib/match-replay";
import { scheduleTable } from "./tableTimers";

function parseState(state: string) {
  if (state.length > 800_000) throw new Error("The saved table is too large.");
  const g = normalizeGame(JSON.parse(state) as Game);
  if (
    !/^[A-Z2-9]{6}$/.test(g.code) ||
    !Number.isInteger(g.revision) ||
    g.revision < 0
  )
    throw new Error("Invalid saved table.");
  return g;
}
export function directory(g: Game) {
  return JSON.stringify({
    code: g.code,
    title: g.title,
    players: g.players.length,
    capacity: g.capacity,
    boardPlayers: g.boardPlayers,
    mode: g.mode,
    map: g.map,
    scenario: g.scenario,
    turnSeconds: g.turnSeconds,
    target: g.target,
    turn: g.turn,
    phase: g.phase,
  });
}
const roomByCode = (ctx: MutationCtx, code: string) =>
  ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();

export const load = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    await requireStorageServer(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    return room ? { state: room.state, revision: room.revision } : null;
  },
});
export const list = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    await requireStorageServer(ctx);
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_public_updated", (q) =>
        q.eq("public", true).gt("updated", since),
      )
      .order("desc")
      .take(100);
    return rooms.map((r) => r.directory);
  },
});
export const insert = mutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    await requireStorageServer(ctx);
    const g = parseState(state);
    if (await roomByCode(ctx, g.code))
      throw new Error("Room code already exists.");
    const id = await ctx.db.insert("rooms", {
      code: g.code,
      state: JSON.stringify(g),
      revision: g.revision,
      updated: g.updated,
      public: g.public,
      directory: directory(g),
    });
    await scheduleTable(ctx, id, g);
  },
});

// Convex commits these writes in one transaction. A stale room or rating
// snapshot exits before writing any room, replay frame, result or rating.
export const save = mutation({
  args: {
    state: v.string(),
    expectedRevision: v.number(),
    replay: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireStorageServer(ctx);
    return saveRoomState(ctx, args);
  },
});
export async function saveRoomState(
  ctx: MutationCtx,
  args: { state: string; expectedRevision: number; replay?: string },
): Promise<boolean> {
  const g = parseState(args.state),
    row = await roomByCode(ctx, g.code);
  if (!row || row.revision !== args.expectedRevision) return false;
  const previous = parseState(row.state);
  g.revision = args.expectedRevision + 1;
  g.updated = Date.now();
  if (
    g.ranked &&
    g.phase === "finished" &&
    g.winner !== null &&
    g.statistics &&
    previous.phase !== "finished"
  ) {
    const r = g.ranked;
    const settled = await ctx.db
      .query("rankedResults")
      .withIndex("by_match", (q) => q.eq("matchId", g.statistics!.id))
      .unique();
    if (settled) return false;
    const ratings = await Promise.all(
      r.seats.map((s) =>
        ctx.db
          .query("ratings")
          .withIndex("by_account_season_mode", (q) =>
            q
              .eq("accountId", s.accountId)
              .eq("season", r.season.id)
              .eq("mode", r.mode),
          )
          .unique(),
      ),
    );
    if (
      ratings.some(
        (rating, i) =>
          !rating ||
          rating.rating !== r.seats[i].rating ||
          rating.games !== r.seats[i].games ||
          rating.wins !== r.seats[i].wins,
      )
    )
      return false;
    await ctx.db.insert("rankedResults", {
      matchId: g.statistics.id,
      season: r.season.id,
      mode: r.mode,
      finishedAt: g.statistics.finishedAt ?? g.updated,
      result: JSON.stringify(rankedView(r, g.winner, true)),
    });
    for (let i = 0; i < ratings.length; i++) {
      const s = r.seats[i],
        won = i === g.winner;
      await ctx.db.patch(ratings[i]!._id, {
        rating: s.rating + (won ? s.win : s.loss),
        games: s.games + 1,
        wins: s.wins + (won ? 1 : 0),
        updated: g.updated,
      });
    }
  }
  const replay = args.replay
    ? (JSON.parse(args.replay) as ReplayCapture)
    : undefined;
  if (
    replay?.id &&
    replay.initial &&
    (replay.frames.length || previous.statistics?.id !== replay.id)
  ) {
    let saved = await ctx.db
      .query("replays")
      .withIndex("by_match", (q) => q.eq("matchId", replay.id!))
      .unique();
    if (!saved) {
      const id = await ctx.db.insert("replays", {
        matchId: replay.id,
        initial: JSON.stringify(replay.initial),
        initialSequence: replay.initialSequence,
        complete: replay.complete,
        lastSequence: replay.initialSequence,
      });
      saved = await ctx.db.get(id);
    }
    for (const frame of replay.frames) {
      const old = await ctx.db
        .query("replayEvents")
        .withIndex("by_match_sequence", (q) =>
          q.eq("matchId", replay.id!).eq("sequence", frame.sequence),
        )
        .unique();
      if (!old)
        await ctx.db.insert("replayEvents", {
          matchId: replay.id,
          sequence: frame.sequence,
          frame: JSON.stringify(frame),
        });
    }
    if (saved && replay.frames.length)
      await ctx.db.patch(saved._id, {
        lastSequence: replay.frames.at(-1)!.sequence,
      });
  }
  const archive = archivedMatch(g) ?? archivedMatch(previous);
  if (archive) {
    const { summary, result, participants } = archive;
    const old = await ctx.db
      .query("matches")
      .withIndex("by_match", (q) => q.eq("matchId", summary.id))
      .unique();
    if (!old) {
      await ctx.db.insert("matches", {
        matchId: summary.id,
        code: g.code,
        finishedAt: summary.finishedAt,
        summary: JSON.stringify(summary),
        result: JSON.stringify(result),
        participants,
      });
      const finished = g.phase === "finished" ? g : previous;
      for (const playerId of participants)
        await ctx.db.insert("matchPlayers", {
          matchId: summary.id,
          playerId,
          won: finished.players[summary.winner].id === playerId,
          finishedAt: summary.finishedAt,
        });
    }
  }
  await ctx.db.patch(row._id, {
    state: JSON.stringify(g),
    revision: g.revision,
    updated: g.updated,
    public: g.public,
    directory: directory(g),
  });
  await scheduleTable(ctx, row._id, g);
  return true;
}
