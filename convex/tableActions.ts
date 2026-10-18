import { mutation, type MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireStorageServer } from "./access";
import { accountById, aliases, playerOwner, sessionValid } from "./accounts";
import {
  normalizeGame,
  advanceClock,
  needsClockAdvance,
  view,
  type Game,
  type View,
} from "../lib/game";
import {
  beginReplayCapture,
  takeReplayCapture,
  recordReplayFrame,
} from "../lib/match-replay";
import {
  applyRoomOperation,
  type RoomOperationBody,
} from "../lib/room-operation";
import { normalizeAvatar } from "../lib/avatars";
import { saveRoomState } from "./rooms";
import { fail } from "./errors";
async function table(ctx: MutationCtx, code: string) {
  const row = await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
  if (!row) fail("Room not found. Check the code and try again.", 404);
  return { row, g: normalizeGame(JSON.parse(row.state) as Game) };
}
async function change(
  ctx: MutationCtx,
  g: Game,
  revision: number,
  perform: () => void,
) {
  const before = JSON.stringify(g);
  beginReplayCapture(g);
  let replay;
  try {
    perform();
    recordReplayFrame(g, null, { type: "system" }, Date.now());
    replay = takeReplayCapture(g);
  } finally {
    takeReplayCapture(g);
  }
  if (JSON.stringify(g) === before) return;
  g.revision = revision + 1;
  g.updated = Date.now();
  if (
    !(await saveRoomState(ctx, {
      state: JSON.stringify(g),
      expectedRevision: revision,
      ...(replay ? { replay: JSON.stringify(replay) } : {}),
    }))
  )
    fail("The table changed while saving. Please try your move again.", 409);
}
// Keep timeout commits separate from user-action validation. An invalid user
// move cannot roll back a timeout, nor cause its random fallback to repeat.
export const advance = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<null> => {
    await requireStorageServer(ctx);
    const { row, g } = await table(ctx, code);
    await change(ctx, g, row.revision, () => advanceClock(g));
    return null;
  },
});
export const act = mutation({
  args: {
    code: v.string(),
    player: v.string(),
    account: v.union(v.string(), v.null()),
    session: v.union(v.string(), v.null()),
    avatar: v.string(),
    body: v.any(),
    checkClock: v.optional(v.boolean()),
  },
  handler: async (ctx, a): Promise<View | null> => {
    await requireStorageServer(ctx);
    const { row, g } = await table(ctx, a.code);
    // No writes or random choices here. The server commits overdue maintenance
    // separately before retrying, so rejected moves cannot undo a timeout.
    if (a.checkClock && needsClockAdvance(g)) return null;
    const account = a.account ? await accountById(ctx, a.account) : null;
    if (
      a.account
        ? !account ||
          account.player_id !== a.player ||
          !(await sessionValid(ctx, a.session, a.account, Date.now()))
        : !!(await playerOwner(ctx, a.player))
    )
      fail("Your session changed. Reconnect to the table.", 401);
    const ids = account
        ? (await aliases(ctx, account.id)).map((p) => p.player_id)
        : [],
      ident = {
        id: a.player,
        aliases: ids,
        account: account ? { id: account.id, color: account.color } : null,
      };
    try {
      await change(ctx, g, row.revision, () =>
        applyRoomOperation(
          g,
          ident,
          a.body as RoomOperationBody,
          normalizeAvatar(a.avatar),
        ),
      );
    } catch (e) {
      if (e instanceof ConvexError) throw e;
      if (e instanceof Error) fail(e.message);
      throw e;
    }
    const player =
      g.players.find((p) => p.id === a.player) ??
      g.players.find((p) => ids.includes(p.id));
    return view(g, player?.id ?? a.player);
  },
});
