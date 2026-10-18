import { identity } from "@/lib/session";
import { listMatches, loadMatch } from "@/lib/room-store";
const validId = (id: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export async function GET(req: Request) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  try {
    const query = new URL(req.url).searchParams,
      match = query.get("match");
    if (match) {
      if (!validId(match))
        return Response.json(
          { error: "Invalid result link." },
          { status: 400, headers },
        );
      // A result link shares a completed, sanitized table. Browsing someone
      // else's history is never available through this endpoint.
      const result = await loadMatch(match);
      return Response.json(result ?? { error: "Game result not found." }, {
        status: result ? 200 : 404,
        headers,
      });
    }
    const { id, cookie } = await identity(req);
    if (cookie) headers["Set-Cookie"] = cookie;
    const at = query.get("before"),
      cursor = query.get("id");
    if (
      (at || cursor) &&
      (!at ||
        !cursor ||
        !validId(cursor) ||
        !Number.isSafeInteger(Number(at)) ||
        Number(at) < 0)
    )
      return Response.json(
        { error: "Invalid history page." },
        { status: 400, headers },
      );
    return Response.json(
      await listMatches(
        id,
        at && cursor ? { at: Number(at), id: cursor } : undefined,
      ),
      { headers },
    );
  } catch (error) {
    console.error("Match history read failed", error);
    return Response.json(
      { error: "Game history is temporarily unavailable. Please try again." },
      { status: 503, headers },
    );
  }
}
