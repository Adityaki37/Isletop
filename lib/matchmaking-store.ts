import { storageOperation } from "./account-store";
import { identity } from "./session";
import { cookieValue, tokenHash } from "./account-crypto";
import { api, storageClient, storageMutation } from "./convex-client";
import { matchmakingQueue, matchmakingMap } from "./matchmaking";
import { BASE_MAPS, type BaseMap } from "./base-maps";
import { selectAvatar } from "./avatars";
async function request(req: Request, body: Record<string, unknown>) {
  const ident = await identity(req),
    hash = ident.account
      ? await tokenHash(cookieValue(req, "island_account")!)
      : null;
  if (body.op === "join") {
    matchmakingMap(matchmakingQueue(body.queue), body.map);
    if (!ident.account) selectAvatar(body.avatar ?? "player");
  }
  if (body.map !== undefined && !BASE_MAPS.includes(body.map as BaseMap))
    throw Error("Choose an available map for this game mode.");
  await storageOperation(() =>
    storageMutation(api.matchmaking.action, {
      data: {
        ...body,
        player: ident.id,
        account: ident.account?.id ?? null,
        hash,
        deferStatus: true,
      },
    }),
  );
  const data = await storageOperation(() =>
    storageClient().query(api.matchmaking.read, {
      player: ident.id,
      account: ident.account?.id ?? null,
      ...(body.map !== undefined ? { map: body.map as string } : {}),
    }),
  );
  return { data, cookie: ident.cookie };
}
export const matchmakingRead = (req: Request) => request(req, { op: "read", map: new URL(req.url).searchParams.get("map") ?? "baseRandom" });
export const matchmakingAction = (
  req: Request,
  body: Record<string, unknown>,
) => request(req, body);
