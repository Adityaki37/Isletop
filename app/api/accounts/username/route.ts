import { accountRead, type AccountRow } from "@/lib/account-store";
import { usernameKey, USERNAME_ERROR } from "@/lib/username";
import { limitNetwork, RequestLimitError } from "@/lib/request-limits";

const respond = (data: unknown, status = 200, retryAfter?: number) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(retryAfter === undefined
        ? {}
        : { "Retry-After": String(retryAfter) }),
    },
  });

export async function GET(req: Request) {
  let username: string;
  try {
    username = usernameKey(new URL(req.url).searchParams.get("username"));
  } catch {
    return respond(
      { error: USERNAME_ERROR },
      400,
    );
  }
  try {
    await limitNetwork(req, "read");
    const row = (await accountRead("byUsername", {
      username,
    })) as AccountRow | null;
    return respond({ username, available: row === null });
  } catch (error) {
    if (error instanceof RequestLimitError)
      return respond({ error: error.message }, 429, error.retryAfter);
    return respond({ error: "Unable to check username availability." }, 503);
  }
}
