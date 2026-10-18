import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { normalizeGame, advanceClock, type Game } from "../lib/game";
import { advanceBots, botSeats } from "../lib/disconnect-bots";
import {
  beginReplayCapture,
  takeReplayCapture,
  recordReplayFrame,
} from "../lib/match-replay";
import { connectionTimes, scheduleTable } from "./tableTimers";
import { saveRoomState } from "./rooms";
export const tick = internalMutation({
  args: { code: v.string(), created: v.number(), token: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const row = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    const timer = await ctx.db
      .query("roomTimers")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    if (
      !row ||
      !timer ||
      timer.wakeToken !== args.token ||
      timer.created !== args.created
    )
      return null;
    const g = normalizeGame(JSON.parse(row.state) as Game);
    if (g.created !== args.created) return null;
    await ctx.db.patch(timer._id, {
      wakeId: undefined,
      wakeToken: undefined,
      wakeAt: undefined,
    });
    const before = JSON.stringify(g),
      now = Date.now();
    beginReplayCapture(g);
    let replay;
    try {
      advanceClock(g, now);
      advanceBots(g, botSeats(g, await connectionTimes(ctx, g), now), now);
      recordReplayFrame(g, null, { type: "system" }, now);
      replay = takeReplayCapture(g);
    } finally {
      takeReplayCapture(g);
    }
    if (JSON.stringify(g) !== before) {
      if (
        !(await saveRoomState(ctx, {
          state: JSON.stringify(g),
          expectedRevision: row.revision,
          ...(replay ? { replay: JSON.stringify(replay) } : {}),
        }))
      )
        throw new Error(
          "The table rating snapshot changed before its clock action could commit.",
        );
    } else await scheduleTable(ctx, row._id, g);
    return null;
  },
});
