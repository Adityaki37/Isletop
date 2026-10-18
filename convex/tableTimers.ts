import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { Game } from "../lib/game";
import {
  botSeats,
  botPendingSeats,
  BOT_DISCONNECT_GRACE,
} from "../lib/disconnect-bots";
import { needsTradeUpdate } from "../lib/trading";
export async function connectionTimes(ctx: MutationCtx, g: Game) {
  const rows = await ctx.db
    .query("tableConnections")
    .withIndex("by_room", (q) =>
      q.eq("room_code", g.code).eq("room_created", g.created),
    )
    .collect();
  return g.players.map((p) => {
    const times = rows
      .filter((r) => r.player_id === p.id)
      .map((r) => r.expires_at);
    return times.length ? Math.max(...times) : null;
  });
}
// Replacing the pending job and its guard is atomic with every game change.
// The running job clears its ID before rearming, so it cannot cancel itself.
export async function scheduleTable(
  ctx: MutationCtx,
  id: Id<"rooms">,
  g: Game,
): Promise<void> {
  const row = await ctx.db.get(id);
  if (!row) return;
  if (row.wakeId) {
    const job = await ctx.db.system.get(row.wakeId);
    if (job?.state.kind === "pending") await ctx.scheduler.cancel(row.wakeId);
    await ctx.db.patch(id, {
      wakeId: undefined,
      wakeToken: undefined,
      wakeAt: undefined,
    });
  }
  let timer = await ctx.db
    .query("roomTimers")
    .withIndex("by_code", (q) => q.eq("code", g.code))
    .unique();
  if (!timer) {
    const timerId = await ctx.db.insert("roomTimers", {
      code: g.code,
      created: g.created,
    });
    timer = await ctx.db.get(timerId);
  }
  if (!timer) return;
  if (timer.wakeId) {
    const job = await ctx.db.system.get(timer.wakeId);
    if (job?.state.kind === "pending") await ctx.scheduler.cancel(timer.wakeId);
  }
  const now = Date.now(),
    events: number[] = [];
  if (!["lobby", "finished"].includes(g.phase)) {
    if (g.pause.vote) events.push(g.pause.vote.endsAt);
    if (g.pause.pausedAt === null) {
      if (g.deadline !== null) events.push(g.deadline);
      if (needsTradeUpdate(g, now)) events.push(now + 10);
      if (g.phase === "action")
        for (const offer of g.offers) {
          if (offer.closeAt !== null) events.push(offer.closeAt);
          for (const t of Object.values(offer.responseDeadlines))
            if (t !== null && t > now) events.push(t);
          for (const t of Object.values(offer.preparingUntil))
            if (t > now) events.push(t);
        }
      const times = await connectionTimes(ctx, g),
        seats = botSeats(g, times, now);
      for (const t of times)
        if (t !== null && t + BOT_DISCONNECT_GRACE > now)
          events.push(t + BOT_DISCONNECT_GRACE);
      if (JSON.stringify(seats) !== JSON.stringify(g.botPlayers))
        events.push(now + 1);
      if (botPendingSeats(g).some((p) => seats.includes(p)))
        events.push(Math.max(now + 10, g.botDueAt));
      if (g.rush) {
        for (const t of [
          g.rush.rollAt,
          g.rush.discardUntil,
          g.rush.robberUntil,
          ...g.rush.seats.map((s) => s.until),
        ])
          if (t !== null && t > now) events.push(t);
      }
    }
  }
  if (!events.length) {
    await ctx.db.patch(timer._id, {
      created: g.created,
      wakeId: undefined,
      wakeToken: undefined,
      wakeAt: undefined,
    });
    return;
  }
  const at = Math.max(now + 10, Math.min(...events)),
    token = crypto.randomUUID();
  const wakeId = await ctx.scheduler.runAt(at, internal.clock.tick, {
    code: g.code,
    created: g.created,
    token,
  });
  await ctx.db.patch(timer._id, {
    created: g.created,
    wakeId,
    wakeToken: token,
    wakeAt: at,
  });
}
