import { AuthError } from "@/lib/account-store";
import { spectatorCode } from "@/lib/spectator-store";
import { tablePresence, tablePresenceAction } from "@/lib/table-presence-store";
function response(data: unknown, status = 200, cookie: string | null = null) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return Response.json(data, { status, headers });
}
function failure(e: unknown) {
  if (e instanceof AuthError) return response({ error: e.message }, e.status);
  console.error("Table connection failed", e);
  return response(
    { error: "Table connections are temporarily unavailable." },
    503,
  );
}
export async function GET(req: Request) {
  try {
    return response(
      await tablePresence(
        spectatorCode(new URL(req.url).searchParams.get("code")),
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length")) > 1024)
      throw new AuthError("Request is too large.", 413);
    // Consume the bounded body before rejecting the origin so a persistent
    // connection can safely handle the next request.
    const text = await req.text();
    if (
      req.headers.get("origin") &&
      req.headers.get("origin") !== new URL(req.url).origin
    )
      throw new AuthError("Invalid request origin.", 403);
    if (text.length > 1024) throw new AuthError("Request is too large.", 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AuthError("Invalid table connection.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AuthError("Invalid table connection.");
    const result = await tablePresenceAction(req, body);
    return response(result.data, 200, result.cookie);
  } catch (e) {
    return failure(e);
  }
}
