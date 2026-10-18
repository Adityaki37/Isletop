import { identity } from "@/lib/session";
import { leaderboard } from "@/lib/ranked-store";
import { AuthError } from "@/lib/account-store";
import { RegionSelectionError } from "@/lib/regions";
export async function GET(req: Request) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  try {
    const ident = await identity(req);
    if (ident.cookie) headers["Set-Cookie"] = ident.cookie;
    return Response.json(
      await leaderboard(new URL(req.url).searchParams, ident),
      { headers },
    );
  } catch (e) {
    const invalid =
        e instanceof Error &&
        [
          "Choose an available Ranked mode.",
          "Choose a valid Ranked season.",
        ].includes(e.message),
      status =
        e instanceof AuthError
          ? e.status
          : invalid || e instanceof RegionSelectionError
            ? 400
            : 503;
    if (status === 503) console.error("Leaderboard read failed", e);
    return Response.json(
      {
        error:
          status === 503
            ? "Leaderboards are temporarily unavailable. Retry."
            : e instanceof Error
              ? e.message
              : "Invalid leaderboard request.",
      },
      { status, headers },
    );
  }
}
