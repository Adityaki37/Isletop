import { AuthError } from "@/lib/account-store";
import { AvatarSelectionError } from "@/lib/avatars";
import { matchmakingAction, matchmakingRead } from "@/lib/matchmaking-store";
function response(data: unknown, status = 200, cookie: string | null = null) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
}
function failure(e: unknown) {
  if (e instanceof AuthError) return response({ error: e.message }, e.status);
  if (
    e instanceof AvatarSelectionError ||
    (e instanceof Error &&
      [
        "Choose an available Casual queue.",
        "Choose an available matchmaking queue.",
        "Choose an available map for this game mode.",
      ].includes(e.message))
  )
    return response({ error: e.message }, 400);
  console.error("Matchmaking failed", e);
  return response(
    { error: "Matchmaking is temporarily unavailable. Retry." },
    503,
  );
}
export async function GET(req: Request) {
  try {
    const result = await matchmakingRead(req);
    return response(result.data, 200, result.cookie);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length")) > 2048)
      throw new AuthError("Request is too large.", 413);
    const text = await req.text();
    if (text.length > 2048) throw new AuthError("Request is too large.", 413);
    if (
      req.headers.get("origin") &&
      req.headers.get("origin") !== new URL(req.url).origin
    )
      throw new AuthError("Invalid request origin.", 403);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw Error();
      body = parsed;
    } catch {
      throw new AuthError("Invalid matchmaking request.");
    }
    const result = await matchmakingAction(req, body);
    return response(result.data, 200, result.cookie);
  } catch (e) {
    return failure(e);
  }
}
