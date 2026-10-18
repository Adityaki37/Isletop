import {
  accountPlayerId,
  authenticatedAccount,
  AuthError,
  storageOperation,
} from "./account-store";
import { identity } from "./session";
import { loadRoom } from "./room-store";
import { spectatorCode } from "./spectator-store";
import { TABLE_CONNECTION_TTL, type TablePresence } from "./table-presence";
import type { Game } from "./game";
import { api, storageClient, storageMutation } from "./convex-client";
export async function connectionExpiries(room: Game) {
  return storageClient().query(api.presence.expiries, {
    code: room.code,
    created: room.created,
    players: room.players.map((p) => p.id),
  });
}
export async function tablePresence(code: string): Promise<TablePresence> {
  return storageOperation(() =>
    storageClient().query(api.presence.seats, { code }),
  );
}
export async function tablePresenceAction(
  req: Request,
  body: Record<string, unknown>,
) {
  const code = spectatorCode(body.code);
  if (
    !["beat", "away", "release"].includes(String(body.op)) ||
    typeof body.token !== "string" ||
    !/^[a-f0-9-]{36}$/.test(body.token) ||
    !Number.isSafeInteger(body.created) ||
    Number(body.created) <= 0
  )
    throw new AuthError("Invalid table connection.");
  const ident = await identity(req),
    announcing = body.op !== "release",
    room = announcing ? await loadRoom(code) : null;
  if (announcing && !room) throw new AuthError("Room not found.", 404);
  const session = ident.account ? await authenticatedAccount(req) : null;
  if (announcing && ident.account && !session)
    throw new AuthError("Sign in again to reconnect.", 401);
  await storageOperation(() =>
    storageMutation(api.presence.connection, {
      data: {
        op: body.op,
        token: body.token,
        code,
        created: body.created,
        player: room ? accountPlayerId(ident, room) : ident.id,
        account: ident.account?.id ?? null,
        hash: session?.hash ?? null,
        ttl: TABLE_CONNECTION_TTL,
      },
    }),
  );
  return {
    cookie: ident.cookie,
    data: body.op === "release" ? { ok: true } : await tablePresence(code),
  };
}
