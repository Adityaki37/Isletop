import { MAX_PLAYERS } from "@/lib/player-colors";
import {
  AVAILABLE_GAME_MODES,
  advanceClock,
  applyAction,
  createGame,
  Game,
  needsTradeUpdate,
  player,
  view,
} from "@/lib/game";
import { insertRoom, listRooms, loadRoom, saveRoom } from "@/lib/room-store";
import { identity } from "@/lib/session";
import {
  accountPlayerId,
  authenticatedAccount,
  storageOperation,
  AuthError,
} from "@/lib/account-store";
import { api, storageMutation } from "@/lib/convex-client";
import { normalizeAvatar, selectAvatar } from "@/lib/avatars";
import { applyRoomCreationOptions } from "@/lib/room-creation";
import { needsPauseUpdate } from "@/lib/table-pause";
import { connectionExpiries } from "@/lib/table-presence-store";
import { advanceBots, botSeats, needsBotUpdate } from "@/lib/disconnect-bots";
import {
  beginReplayCapture,
  takeReplayCapture,
  recordReplayFrame,
} from "@/lib/match-replay";
import {
  limitNetwork,
  limitPlayer,
  RequestLimitError,
} from "@/lib/request-limits";
import { requestObservation } from "@/lib/request-observability";
function roomCode(raw: unknown) {
  if (typeof raw !== "string" || !/^[A-Z2-9]{6}$/.test(raw))
    throw new AuthError("Enter a valid six-character room code.");
  return raw;
}
async function mutate(code: string, fn: (g: Game) => void | Promise<void>) {
  // Eight simultaneous Rush seats can each consume a revision. Give every
  // accepted request enough retries to survive that burst without losing it.
  for (let i = 0; i < 12; i++) {
    const g = await loadRoom(code);
    if (!g) throw new Error("Room not found. Check the code and try again.");
    const revision = g.revision,
      before = JSON.stringify(g);
    beginReplayCapture(g);
    let replay;
    try {
      await fn(g);
      recordReplayFrame(g, null, { type: "system" }, Date.now());
      replay = takeReplayCapture(g);
    } finally {
      takeReplayCapture(g);
    }
    if (JSON.stringify(g) === before) return g;
    if (await saveRoom(g, revision, JSON.parse(before) as Game, replay))
      return g;
  }
  throw new Error(
    "The table changed while saving. Please try your move again.",
  );
}
export async function GET(req: Request) {
  const result = requestObservation("rooms").respond;
  try {
    await limitNetwork(req, "read");
    const code = new URL(req.url).searchParams.get("code");
    if (!code) return result(await listRooms());
    const ident = await identity(req);
    const { cookie } = ident;
    const found = await loadRoom(roomCode(code));
    if (!found) return result({ error: "Room not found." }, cookie, 404);
    const now = Date.now(),
      seats = botSeats(found, await connectionExpiries(found), now);
    const g =
      (found.pause?.pausedAt == null &&
        found.deadline !== null &&
        found.deadline <= Date.now()) ||
      needsPauseUpdate(found) ||
      needsTradeUpdate(found) ||
      needsBotUpdate(found, seats, now)
        ? await mutate(code, async (room) => {
            advanceClock(room);
            advanceBots(
              room,
              botSeats(room, await connectionExpiries(room), Date.now()),
            );
          })
        : found;
    return result({ game: view(g, accountPlayerId(ident, g)) }, cookie);
  } catch (e) {
    if (e instanceof RequestLimitError)
      return result({ error: e.message }, null, 429, e.retryAfter);
    return result(
      {
        error:
          e instanceof AuthError
            ? e.message
            : "Unable to load the table. Try reconnecting.",
      },
      null,
      e instanceof AuthError ? e.status : 503,
    );
  }
}
export async function POST(req: Request) {
  const observation = requestObservation("rooms"),
    result = observation.respond;
  observation.operation("write");
  let cookie: string | null = null;
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin)
      return result({ error: "Invalid request origin." }, null, 403);
    await limitNetwork(req, "write");
    if (Number(req.headers.get("content-length")) > 10000)
      return result({ error: "Request is too large." }, null, 413);
    const text = await req.text();
    if (text.length > 10000)
      return result({ error: "Request is too large." }, null, 413);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AuthError("Choose a valid room operation.");
    if (!["create", "join", "action", "leave", "rematch"].includes(body.op))
      throw new AuthError("Unknown room operation.");
    observation.operation(body.op);
    if (body.op === "create" || body.op === "join")
      await limitNetwork(req, body.op);
    const ident = await identity(req);
    cookie = ident.cookie;
    const id = ident.id;
    await limitPlayer(
      id,
      body.op === "create" ? "create" : body.op === "join" ? "join" : "action",
    );
    let avatar;
    try {
      avatar = ident.account
        ? normalizeAvatar(ident.account.avatar)
        : body.avatar === undefined
          ? "player"
          : selectAvatar(body.avatar);
    } catch {
      throw new AuthError("Choose a valid avatar.");
    }
    if (body.op === "create") {
      if (body.practice !== undefined && body.practice !== "botDuel" && body.practice !== "bots")
        throw new AuthError("Choose an available practice mode.");
      const botDuel = body.practice === "botDuel";
      const botPractice = botDuel || body.practice === "bots";
      const botCount = botDuel ? 1 : body.botCount;
      if (body.practice === "bots" &&
          (!Number.isInteger(botCount) || Number(botCount) < 1 || Number(botCount) >= MAX_PLAYERS))
        throw new AuthError("Choose between 1 and 11 bots.");
      if (body.mode !== undefined && !AVAILABLE_GAME_MODES.includes(body.mode))
        throw new AuthError("Choose an available game mode.");
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 24
      )
        throw new AuthError("Choose a name with 1–24 characters.");
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      const code = Array.from(bytes, (n) => alphabet[n % alphabet.length]).join(
        "",
      );
      let g: Game;
      try {
        g = createGame(
          code,
          player(id, body.name, avatar),
          botPractice ? Number(botCount) + 1 : (body.capacity ?? 4),
          !botPractice && body.public === true,
          botPractice ? (botCount === 1 ? "duel" : "base") : body.mode,
          botPractice ? undefined : body.scenario,
          body.map,
        );
      } catch (e) {
        throw new AuthError(
          e instanceof Error ? e.message : "Choose valid game settings.",
        );
      }
      if (ident.account) g.players[0].color = ident.account.color;
      if (!botPractice) {
        try { applyRoomCreationOptions(g, body); }
        catch (e) { throw new AuthError(e instanceof Error ? e.message : "Choose valid room settings."); }
      }
      if (botPractice) {
        for (let i = 0; i < Number(botCount); i++) applyAction(g, 0, { type: "addBot" });
        try {
          applyAction(g, 0, { type: "settings", turnSeconds: body.turnSeconds ?? 60 });
        } catch (e) {
          throw new AuthError(e instanceof Error ? e.message : "Choose a valid turn timer.");
        }
        applyAction(g, 0, { type: "start" });
      }
      await insertRoom(g);
      return result({ game: view(g, id) }, cookie);
    }
    const code = roomCode(body.code);
    const session = ident.account ? await authenticatedAccount(req) : null;
    const args = {
      code,
      player: ident.id,
      account: ident.account?.id ?? null,
      session: session?.hash ?? null,
      avatar,
      body,
    };
    let game = await storageOperation(() =>
      storageMutation(api.tableActions.act, { ...args, checkClock: true }),
    );
    if (game === null) {
      await storageOperation(() =>
        storageMutation(api.tableActions.advance, { code }),
      );
      game = await storageOperation(() =>
        storageMutation(api.tableActions.act, args),
      );
    }
    return result({ game }, cookie);
  } catch (e) {
    if (e instanceof RequestLimitError)
      return result({ error: e.message }, cookie, 429, e.retryAfter);
    return result(
      {
        error:
          e instanceof AuthError
            ? e.message
            : e instanceof SyntaxError
              ? "Enter a valid request."
              : "Unable to save your move. Try reconnecting.",
      },
      cookie,
      e instanceof AuthError ? e.status : e instanceof SyntaxError ? 400 : 503,
    );
  }
}
