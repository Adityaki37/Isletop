import { MAX_PLAYERS } from "@/lib/player-colors";
import {
  accountRead,
  accountWrite,
  authenticatedAccount,
  authLimit,
  AuthError,
  guestIdentity,
  issueSession,
  profileStats,
  publicProfile,
  type AccountRow,
} from "@/lib/account-store";
import {
  cookieValue,
  equalHash,
  passwordHash,
  randomToken,
  sessionCookie,
  tokenHash,
  usernameKey,
  validatePassword,
  verifyPassword,
} from "@/lib/account-crypto";
import {
  normalizeAvatar,
  selectAvatar,
  AvatarSelectionError,
} from "@/lib/avatars";
import { selectRegion, RegionSelectionError } from "@/lib/regions";
const response = (data: unknown, status = 200, cookies: string[] = []) => {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json(data, { status, headers });
};
const requireAccount = async (req: Request) => {
  const session = await authenticatedAccount(req);
  if (!session) throw new AuthError("Sign in to manage your account.", 401);
  return session;
};
const passwordGuard = async (value: unknown, row: AccountRow) => {
  if (!(await verifyPassword(value, row.password_hash)))
    throw new AuthError("Incorrect current password.", 401);
};
const profileInput = (body: Record<string, unknown>) => {
  if (
    typeof body.displayName !== "string" ||
    !body.displayName.trim() ||
    body.displayName.length > 24
  )
    throw new AuthError("Choose a display name of 1–24 characters.");
  if (typeof body.bio !== "string" || body.bio.length > 200)
    throw new AuthError("Your bio can contain up to 200 characters.");
  if (
    !Number.isInteger(body.color) ||
    Number(body.color) < 0 ||
    Number(body.color) >= MAX_PLAYERS
  )
    throw new AuthError("Choose an available player color.");
  return {
    name: body.displayName.trim(),
    bio: body.bio,
    color: Number(body.color),
  };
};
export async function GET(req: Request) {
  try {
    const username = new URL(req.url).searchParams.get("username");
    if (username !== null) {
      const row = (await accountRead("byUsername", {
        username: usernameKey(username),
      })) as AccountRow | null;
      return row
        ? response({
            account: publicProfile(row),
            stats: await profileStats(row),
          })
        : response({ error: "Player profile not found." }, 404);
    }
    const session = await authenticatedAccount(req),
      guest = await guestIdentity(req);
    const overview = (await accountRead("overview", {
      player: guest.id,
      account: session?.row.id ?? null,
      now: Date.now(),
    })) as { guestGames: number; guestSeats: number; sessions: number };
    return response(
      {
        account: session ? publicProfile(session.row) : null,
        ...overview,
        ...(session ? { stats: await profileStats(session.row) } : {}),
      },
      200,
      guest.cookie ? [guest.cookie] : [],
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    // Consume the bounded request before rejecting its origin so the local
    // Worker proxy can reuse the connection without an unread body.
    if (Number(req.headers.get("content-length")) > 4096)
      throw new AuthError("Request is too large.", 413);
    const text = await req.text();
    if (
      req.headers.get("origin") &&
      req.headers.get("origin") !== new URL(req.url).origin
    )
      throw new AuthError("Invalid request origin.", 403);
    if (text.length > 4096) throw new AuthError("Request is too large.", 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AuthError("Invalid account request.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AuthError("Invalid account request.");
    if (body.op === "register") {
      if (await authenticatedAccount(req))
        throw new AuthError("Sign out before creating another account.");
      const username = usernameKey(body.username);
      validatePassword(body.password);
      await authLimit(req, "register", username);
      const guest = await guestIdentity(req),
        id = crypto.randomUUID(),
        recovery = randomToken(),
        hash = await passwordHash(body.password),
        recoveryHash = await tokenHash(recovery),
        now = Date.now();
      const name =
        typeof body.displayName === "string"
          ? body.displayName.trim()
          : username;
      if (!name || name.length > 24)
        throw new AuthError("Choose a display name of 1–24 characters.");
      try {
        await accountWrite("register", {
          id,
          username,
          display_name: name,
          password_hash: hash,
          recovery_hash: recoveryHash,
          player_id: guest.id,
          created_at: now,
        });
      } catch (error) {
        if (String(error).includes("UNIQUE constraint"))
          throw new AuthError(
            "That username or browser identity is already registered.",
            409,
          );
        throw error;
      }
      const row = (await accountRead("byId", { id })) as AccountRow | null;
      if (!row) throw new Error("Account creation failed.");
      const session = await issueSession(req, row);
      return response({ account: publicProfile(row), recovery }, 201, [
        ...(guest.cookie ? [guest.cookie] : []),
        session.cookie,
      ]);
    }
    if (body.op === "login") {
      const username = usernameKey(body.username);
      await authLimit(req, "login", username);
      const row = (await accountRead("byUsername", {
        username,
      })) as AccountRow | null;
      const valid = await verifyPassword(
        body.password,
        row?.password_hash ??
          `scrypt$16384$8$5$${"0".repeat(64)}$${"0".repeat(64)}`,
      );
      if (!row || !valid)
        throw new AuthError("Incorrect username or password.", 401);
      const prior = await authenticatedAccount(req);
      if (prior) await accountWrite("logout", { all: false, hash: prior.hash });
      const session = await issueSession(req, row);
      return response({ account: publicProfile(row) }, 200, [session.cookie]);
    }
    if (body.op === "reset") {
      const username = usernameKey(body.username);
      validatePassword(body.password);
      await authLimit(req, "reset", username);
      const row = (await accountRead("byUsername", {
        username,
      })) as AccountRow | null;
      const code =
        typeof body.recovery === "string" ? body.recovery.trim() : "";
      if (
        !row ||
        !/^[a-f0-9]{64}$/.test(code) ||
        !equalHash(await tokenHash(code), row.recovery_hash)
      )
        throw new AuthError("Incorrect username or recovery code.", 401);
      return await replaceCredentials(
        req,
        row,
        body.password,
        row.recovery_hash,
        "recovery_hash",
      );
    }
    const session = await requireAccount(req),
      row = session.row;
    if (body.op === "logout" || body.op === "logoutAll") {
      await accountWrite("logout", {
        all: body.op === "logoutAll",
        id: row.id,
        hash: session.hash,
      });
      const guest = await guestIdentity(req);
      return response({ account: null }, 200, [
        sessionCookie(req, "", 0),
        ...(guest.cookie ? [guest.cookie] : []),
      ]);
    }
    if (body.op === "region") {
      const region = selectRegion(body.region);
      await accountWrite("region", { id: row.id, ...region });
      return response({ account: { ...publicProfile(row), region } });
    }
    if (body.op === "profile") {
      const profile = profileInput(body);
      const avatar =
        body.avatar === undefined
          ? normalizeAvatar(row.avatar)
          : selectAvatar(body.avatar);
      await accountWrite("profile", { id: row.id, ...profile, avatar });
      return response({
        account: {
          ...publicProfile(row),
          displayName: profile.name,
          bio: profile.bio,
          color: profile.color,
          avatar,
        },
      });
    }
    if (body.op === "password") {
      validatePassword(body.password);
      await authLimit(req, "password", row.username);
      await passwordGuard(body.currentPassword, row);
      return await replaceCredentials(
        req,
        row,
        body.password,
        row.password_hash,
        "password_hash",
      );
    }
    if (body.op === "recovery") {
      await authLimit(req, "recovery", row.username);
      await passwordGuard(body.currentPassword, row);
      const recovery = randomToken();
      const changed = await accountWrite("recovery", {
        id: row.id,
        hash: await tokenHash(recovery),
        expected: row.password_hash,
      });
      if (!changed)
        throw new AuthError("Your credentials changed. Sign in again.", 401);
      return response({ recovery });
    }
    if (body.op === "import") {
      const guest = await guestIdentity(req),
        players = (await accountRead("aliases", { id: row.id })) as string[];
      if (players.length >= 64)
        throw new AuthError("This account has reached its guest import limit.");
      await accountWrite("import", { player: guest.id, id: row.id });
      const owner = (await accountRead("owner", { player: guest.id })) as {
        account_id: string;
      } | null;
      if (owner?.account_id !== row.id)
        throw new AuthError(
          owner
            ? "This browser identity belongs to another account."
            : "A guest seat overlaps with your account in an unfinished room, or the import limit has been reached. Leave the overlapping guest seat before importing.",
          409,
        );
      return response(
        { imported: true },
        200,
        guest.cookie ? [guest.cookie] : [],
      );
    }
    throw new AuthError("Unknown account operation.");
  } catch (error) {
    return failure(error);
  }
}
async function replaceCredentials(
  req: Request,
  row: AccountRow,
  password: string,
  expected: string,
  column: "password_hash" | "recovery_hash",
) {
  const recovery = randomToken(),
    recoveryHash = await tokenHash(recovery),
    hash = await passwordHash(password),
    token = randomToken();
  const changed = await accountWrite("credentials", {
    id: row.id,
    column,
    expected,
    password: hash,
    recovery: recoveryHash,
    hash: await tokenHash(token),
    expires: Date.now() + 2592000000,
  });
  if (!changed)
    throw new AuthError("Your credentials changed. Sign in again.", 401);
  return response({ account: publicProfile(row), recovery }, 200, [
    sessionCookie(req, token),
  ]);
}
function failure(error: unknown) {
  if (error instanceof RegionSelectionError)
    return response({ error: error.message }, 400);
  if (error instanceof AvatarSelectionError)
    return response({ error: error.message }, 400);
  if (error instanceof AuthError)
    return response({ error: error.message }, error.status);
  if (
    error instanceof Error &&
    /Choose a username|Use a password/.test(error.message)
  )
    return response({ error: error.message }, 400);
  console.error("Account operation failed", error);
  return response(
    { error: "Account service is temporarily unavailable. Please try again." },
    503,
  );
}
