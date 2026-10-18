import { loadReplayPage, shareReplay } from "@/lib/room-store";
import { identity } from "@/lib/session";
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const headers = { "Cache-Control": "no-store" };
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams,
      match = q.get("match"),
      share = q.get("share"),
      raw = q.get("after");
    if (
      !!match === !!share ||
      !validId(match ?? share) ||
      (raw !== null &&
        (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))))
    )
      return Response.json(
        { error: "Invalid replay link." },
        { status: 400, headers },
      );
    const session = share ? null : await identity(req);
    const page = await loadReplayPage(
      session?.id ?? null,
      match,
      share,
      raw === null ? undefined : Number(raw),
      q.get("compact") !== "1",
    );
    return Response.json(
      page ?? {
        error:
          "Replay unavailable. Use the browser you played in, or a shared replay link. Older games may not have a recording.",
      },
      {
        status: page ? 200 : 404,
        headers: {
          ...headers,
          ...(session?.cookie ? { "Set-Cookie": session.cookie } : {}),
        },
      },
    );
  } catch (error) {
    if (error instanceof RangeError)
      return Response.json({ error: error.message }, { status: 400, headers });
    console.error("Replay read failed", error);
    return Response.json(
      { error: "Unable to load this replay. Please try again." },
      { status: 503, headers },
    );
  }
}
export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin)
      return Response.json(
        { error: "Invalid request origin." },
        { status: 403, headers },
      );
    const text = await req.text();
    if (text.length > 1000)
      return Response.json(
        { error: "Request is too large." },
        { status: 413, headers },
      );
    let body: { match?: unknown } | null;
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json(
        { error: "Invalid replay request." },
        { status: 400, headers },
      );
    }
    if (!body || !validId(body.match))
      return Response.json(
        { error: "Invalid replay link." },
        { status: 400, headers },
      );
    const session = await identity(req),
      share = await shareReplay(body.match, session.id);
    return Response.json(
      share
        ? { share }
        : { error: "Only participants can share a completed replay." },
      {
        status: share ? 200 : 404,
        headers: {
          ...headers,
          ...(session.cookie ? { "Set-Cookie": session.cookie } : {}),
        },
      },
    );
  } catch (error) {
    console.error("Replay share failed", error);
    return Response.json(
      { error: "Unable to share this replay. Please try again." },
      { status: 503, headers },
    );
  }
}
