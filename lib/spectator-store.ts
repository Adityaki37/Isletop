import {
  AuthError,
  authenticatedAccount,
  storageOperation,
} from "./account-store";
import { cookieValue, tokenHash } from "./account-crypto";
import { identity } from "./session";
import { api, storageClient, storageMutation } from "./convex-client";
import type { SpectatorPage } from "./spectator-types";
import { normalizeAvatar } from "./avatars";
export const SPECTATOR_TTL = 90000;
export function spectatorCode(value: unknown) {
  if (typeof value !== "string" || !/^[A-Z2-9]{6}$/.test(value))
    throw new AuthError("Enter a valid six-character room code.");
  return value;
}
export async function spectatorPage(
  code: string,
  cursor = 0,
): Promise<SpectatorPage> {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 1000000)
    throw new AuthError("Invalid spectator page.");
  const page = await storageOperation(() =>
    storageClient().query(api.presence.spectators, { code, cursor }),
  );
  return {
    ...page,
    spectators: page.spectators.map((p) => ({
      ...p,
      avatar: normalizeAvatar(p.avatar),
    })),
  };
}
export async function spectatorAction(
  req: Request,
  body: Record<string, unknown>,
) {
  const code = spectatorCode(body.code);
  if (
    typeof body.token !== "string" ||
    !/^[a-f0-9-]{36}$/.test(body.token) ||
    !Number.isSafeInteger(body.created)
  )
    throw new AuthError("Invalid spectator connection.");
  if (!["watch", "unwatch"].includes(String(body.op)))
    throw new AuthError("Unknown spectator action.");
  let name: string | null = null;
  if (body.name !== undefined) {
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      [...body.name.trim()].length > 24 ||
      /[\u0000-\u001f\u007f]/.test(body.name)
    )
      throw new AuthError("Use a spectator name of 1–24 characters.");
    name = body.name.trim();
  }
  const ident = await identity(req),
    viewer = ident.account ? `a:${ident.account.id}` : `g:${ident.id}`,
    guestToken = cookieValue(req, "island_session"),
    guest = guestToken ? `g:${await tokenHash(guestToken)}` : viewer;
  const session = ident.account ? await authenticatedAccount(req) : null;
  if (body.op === "watch" && ident.account && !session)
    throw new AuthError("Sign in again to reconnect.", 401);
  const publicId = await tokenHash(`${code}:${body.created}:${viewer}`);
  const data = await storageOperation(() =>
    storageMutation(api.presence.spectator, {
      data: {
        op: body.op,
        code,
        created: body.created,
        token: body.token,
        viewer,
        guest,
        player: ident.id,
        account: ident.account?.id ?? null,
        hash: session?.hash ?? null,
        name,
        publicId,
        ttl: SPECTATOR_TTL,
      },
    }),
  );
  return { data, cookie: ident.cookie };
}
