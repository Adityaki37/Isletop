import { AuthError } from "@/lib/account-store";
import {
  socialAccount,
  socialAction,
  socialLookup,
  socialOverview,
} from "@/lib/social-store";
const response = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof AuthError)
    return response({ error: error.message }, error.status);
  console.error("Social request failed", error);
  return response(
    { error: "Friends are temporarily unavailable. Try again." },
    503,
  );
}
export async function GET(req: Request) {
  try {
    const owner = await socialAccount(req),
      query = new URL(req.url).searchParams;
    return response(
      query.has("username")
        ? await socialLookup(owner, query.get("username"))
        : await socialOverview(owner, query.get("code")),
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
      throw new AuthError("Invalid social request.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AuthError("Invalid social request.");
    return response(await socialAction(await socialAccount(req), body));
  } catch (error) {
    return failure(error);
  }
}
