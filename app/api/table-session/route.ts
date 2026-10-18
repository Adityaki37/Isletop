import { identity } from "@/lib/session";
import { authenticatedAccount } from "@/lib/account-store";
import { tableSessionToken } from "@/lib/convex-client";
import {
  limitNetwork,
  limitPlayer,
  RequestLimitError,
} from "@/lib/request-limits";
import { requestObservation } from "@/lib/request-observability";
export async function GET(req: Request) {
  const respond = requestObservation("table-session").respond;
  let cookie: string | null = null;
  try {
    await limitNetwork(req, "session");
    const ident = await identity(req),
      session = ident.account ? await authenticatedAccount(req) : null;
    cookie = ident.cookie;
    await limitPlayer(ident.id, "session");
    if (ident.account && !session)
      return respond(
        { error: "Sign in to your table session again." },
        cookie,
        401,
      );
    return respond(
      {
        token: tableSessionToken(
          ident.id,
          ident.aliases,
          ident.account?.id ?? null,
          session?.hash ?? null,
        ),
      },
      cookie,
    );
  } catch (e) {
    if (e instanceof RequestLimitError)
      return respond({ error: e.message }, cookie, 429, e.retryAfter);
    return respond({ error: "Unable to reconnect to the table." }, cookie, 503);
  }
}
