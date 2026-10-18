import { normalizeAvatar } from "./avatars";
import { storedRegion } from "./regions";
import {
  cookieValue,
  tokenHash,
  randomToken,
  sessionCookie,
} from "./account-crypto";
import type { AccountProfile, ProfileStats } from "./account-types";
import { api, storageClient, storageMutation } from "./convex-client";
import { ConvexError } from "convex/values";
export type AccountRow = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  recovery_hash: string;
  player_id: string;
  bio: string;
  color: number;
  avatar: string;
  continent_code: string;
  country_code: string;
  region_code: string;
  created_at: number;
};
export const accountRead = (op: string, data: Record<string, unknown>) =>
  storageClient().query(api.accounts.read, { op, data });
export const accountWrite = (op: string, data: Record<string, unknown>) =>
  storageMutation(api.accounts.write, { op, data });
export const publicProfile = (row: AccountRow): AccountProfile => ({
  username: row.username,
  displayName: row.display_name,
  bio: row.bio,
  color: row.color,
  avatar: normalizeAvatar(row.avatar),
  region: storedRegion(row),
  createdAt: row.created_at,
});
export async function authenticatedAccount(req: Request) {
  const token = cookieValue(req, "island_account");
  if (!token) return null;
  const hash = await tokenHash(token),
    row = (await accountRead("session", {
      hash,
      now: Date.now(),
    })) as AccountRow | null;
  return row ? { row, hash } : null;
}
export async function guestIdentity(req: Request, forceNew = false) {
  let token = forceNew ? null : cookieValue(req, "island_session"),
    id = token ? await tokenHash(token) : null;
  if (id && (await accountRead("owner", { player: id }))) {
    token = null;
    id = null;
  }
  const fresh = !token;
  token ??= randomToken();
  id ??= await tokenHash(token);
  return {
    id,
    cookie: fresh
      ? sessionCookie(req, token, 31536000, "island_session")
      : null,
  };
}
export const accountAliases = (row: AccountRow) =>
  accountRead("aliases", { id: row.id }) as Promise<string[]>;
export function accountPlayerId(
  ident: { id: string; aliases?: string[] },
  g: { players: { id: string }[] },
) {
  return (
    g.players.find((p) => p.id === ident.id)?.id ??
    g.players.find((p) => ident.aliases?.includes(p.id))?.id ??
    ident.id
  );
}
export async function authLimit(
  req: Request,
  operation: string,
  username: string,
) {
  const now = Date.now(),
    window = Math.floor(now / 900000);
  // Vercel overwrites x-real-ip. Client X-Forwarded-For cannot
  // grant a fresh authentication rate-limit bucket.
  const ip = process.env.VERCEL
    ? req.headers.get("x-real-ip")
    : req.headers.get("CF-Connecting-IP");
  const network = await tokenHash(ip ?? "local-runtime");
  for (const item of [
    { key: `network:${network}`, max: 120 },
    { key: `${operation}:${await tokenHash(username)}`, max: 20 },
  ]) {
    const count = await accountWrite("limit", { key: item.key, window });
    if (typeof count !== "number" || count > item.max)
      throw new AuthError(
        "Too many attempts. Try again in fifteen minutes.",
        429,
      );
  }
  await accountWrite("cleanup", { now, window });
}
export class AuthError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function storageOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (e) {
    if (
      e instanceof ConvexError &&
      e.data &&
      typeof e.data === "object" &&
      "message" in e.data &&
      "status" in e.data
    )
      throw new AuthError(String(e.data.message), Number(e.data.status));
    throw e;
  }
}
export async function issueSession(req: Request, row: AccountRow) {
  const token = randomToken(),
    hash = await tokenHash(token);
  if (
    !(await accountWrite("issueSession", {
      id: row.id,
      hash,
      expires: Date.now() + 2592000000,
      expected: row.password_hash,
    }))
  )
    throw new AuthError("Your credentials changed. Sign in again.", 401);
  return { hash, cookie: sessionCookie(req, token) };
}
export async function profileStats(row: AccountRow): Promise<ProfileStats> {
  const results = (await accountRead("stats", { id: row.id })) as {
      id: string;
      mode: string;
      won: number | null;
    }[],
    modes = new Map<string, ProfileStats["modes"][number]>();
  for (const r of results) {
    const m = modes.get(r.mode) ?? {
      mode: r.mode,
      games: 0,
      wins: 0,
      trackedGames: 0,
    };
    m.games++;
    m.wins += r.won === 1 ? 1 : 0;
    m.trackedGames += r.won === null ? 0 : 1;
    modes.set(r.mode, m);
  }
  return {
    games: results.length,
    wins: results.filter((r) => r.won === 1).length,
    trackedGames: results.filter((r) => r.won !== null).length,
    modes: [...modes.values()],
  };
}
