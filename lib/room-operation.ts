import {
  addPlayer,
  AVAILABLE_GAME_MODES,
  applyAction,
  createGame,
  refreshLobbyBoard,
  moveContext,
  player,
  type Game,
  type Action,
  type GameMode,
} from "./game";
import { isPauseAction } from "./table-pause";
import type { AvatarId } from "./avatars";
import type { AccountRow } from "./account-store";
type Ident = {
  id: string;
  aliases: string[];
  account: Pick<AccountRow, "id" | "color"> | null;
};
function accountPlayerId(ident: Ident, g: Game) {
  return (
    g.players.find((p) => p.id === ident.id)?.id ??
    g.players.find((p) => ident.aliases.includes(p.id))?.id ??
    ident.id
  );
}
export type RoomOperationBody = {
  op?: unknown;
  name?: unknown;
  expectedCreated?: unknown;
  nonce?: unknown;
  context?: unknown;
  action?: Action & { mode?: GameMode };
};
export function applyRoomOperation(
  g: Game,
  ident: Ident,
  body: RoomOperationBody,
  avatar: AvatarId,
) {
  const id = ident.id;

  const p = g.players.findIndex((p) => p.id === accountPlayerId(ident, g));
  if (body.op === "join") {
    if (
      body.expectedCreated !== undefined &&
      body.expectedCreated !== g.created
    )
      throw new Error(
        "This invitation belongs to an earlier game. Ask for a new invitation.",
      );
    if (p >= 0) return;
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.length > 24
    )
      throw new Error("Choose a name with 1–24 characters.");
    addPlayer(g, player(id, body.name, avatar));
    if (
      ident.account &&
      !g.players.slice(0, -1).some((pl) => pl.color === ident.account!.color)
    )
      g.players.at(-1)!.color = ident.account.color;
    return;
  }
  if (p < 0) throw new Error("Join this room before making a move.");
  if (body.op === "leave") {
    if (g.phase === "lobby") {
      g.players.splice(p, 1);
      if (!g.players.length) {
        g.phase = "finished";
        g.public = false;
      } else refreshLobbyBoard(g, g.players.length + 1);
    }
    return;
  }
  if (body.op === "rematch") {
    if (p !== 0 || g.phase !== "finished")
      throw new Error("Only the host can start a rematch after the game.");
    const fresh = createGame(
      g.code,
      player(g.players[0].id, g.players[0].name),
      g.capacity,
      g.public,
      g.mode,
      g.scenario,
      g.map,
    );
    fresh.players = g.players.map((pl) => ({
      ...player(pl.id, pl.name),
      color: pl.color,
      avatar: pl.avatar,
      bot: pl.bot,
      ready: pl.bot === true,
    }));
    refreshLobbyBoard(fresh);
    fresh.matchmaking = g.ranked ? undefined : g.matchmaking;
    fresh.ranked = undefined;
    fresh.target = g.target;
    fresh.title = g.ranked ? `Unranked rematch · ${g.title}` : g.title;
    fresh.discardLimit = g.discardLimit;
    fresh.friendlyRobber = g.friendlyRobber;
    fresh.hideBank = g.hideBank;
    fresh.turnSeconds = g.turnSeconds;
    fresh.diceMode = g.diceMode;
    fresh.revision = g.revision;
    // Object.assign cannot remove an optional field missing from a fresh game.
    // The rematch lobby has no turn order until its own start shuffles it.
    delete g.turnOrder;
    Object.assign(g, fresh);
    return;
  }
  if (body.op !== "action") throw new Error("Unknown room operation.");
  if (
    body.action?.mode !== undefined &&
    !AVAILABLE_GAME_MODES.includes(body.action.mode)
  )
    throw new Error("Choose an available game mode.");
  if (
    typeof body.nonce !== "string" ||
    !/^[a-zA-Z0-9-]{10,80}$/.test(body.nonce)
  )
    throw new Error("Invalid move identifier.");
  const receipt = `${g.players[p].id}:${body.nonce}`;
  if (body.expectedCreated !== undefined && body.expectedCreated !== g.created)
    throw new Error(
      "This move belongs to an earlier game. Reconnect to the table.",
    );
  if (g.receipts.includes(receipt)) return;
  if (
    body.action?.type !== "chat" &&
    body.action?.type !== "botSpeed" &&
    !isPauseAction(body.action) &&
    body.context !== undefined &&
    body.context !== moveContext(g, p)
  )
    throw new Error(
      "The turn has changed. Wait for the table to update and choose your move again.",
    );
  if (!body.action || typeof body.action !== "object")
    throw new Error("Choose a valid game action.");
  applyAction(g, p, body.action);
  g.receipts.push(receipt);
  g.receipts = g.receipts.slice(-100);
}
