import { AuthError } from "@/lib/account-store";
import {
  spectatorAction,
  spectatorCode,
  spectatorPage,
} from "@/lib/spectator-store";
function response(data: unknown, status = 200, cookie: string | null = null) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return Response.json(data, { status, headers });
}
function failure(error: unknown) {
  if (error instanceof AuthError)
    return response({ error: error.message }, error.status);
  console.error("Spectator request failed", error);
  return response(
    { error: "Spectators are temporarily unavailable. Try again." },
    503,
  );
}
export async function GET(req: Request) {
  try {
    const query = new URL(req.url).searchParams;
    const raw = query.get("cursor");
    if (raw !== null && !/^\d{1,7}$/.test(raw))
      throw new AuthError("Invalid spectator page.");
    return response(
      await spectatorPage(
        spectatorCode(query.get("code")),
        raw === null ? 0 : Number(raw),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length")) > 2048)
      throw new AuthError("Request is too large.", 413);
    const text = await req.text();
    if (
      req.headers.get("origin") &&
      req.headers.get("origin") !== new URL(req.url).origin
    )
      throw new AuthError("Invalid request origin.", 403);
    if (text.length > 2048) throw new AuthError("Request is too large.", 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AuthError("Invalid spectator request.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AuthError("Invalid spectator request.");
    const result = await spectatorAction(req, body);
    return response(result.data, 200, result.cookie);
  } catch (error) {
    return failure(error);
  }
}
