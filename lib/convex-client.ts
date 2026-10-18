import { createPrivateKey, sign, randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type {
  FunctionReference,
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";

export { api };
// The SDK's default HTTP mutation queue serializes a shared server client's
// unrelated rooms. Database transactions provide ordering and conflict retries.
export async function storageMutation<M extends FunctionReference<"mutation">>(
  mutation: M,
  args: FunctionArgs<M>,
): Promise<FunctionReturnType<M>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await storageClient().mutation(mutation, args, {
        skipQueue: true,
      });
    } catch (error) {
      let conflict = false;
      try {
        conflict =
          error instanceof Error &&
          JSON.parse(error.message).code ===
            "OptimisticConcurrencyControlFailure";
      } catch {}
      // Convex rejects an exhausted OCC transaction without committing writes.
      // Reissue only that explicit failure, never a lost response or rule error.
      if (!conflict || attempt >= 4) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 80 * 2 ** attempt + Math.random() * 100),
      );
    }
  }
}
const encoded = (data: unknown) =>
  Buffer.from(JSON.stringify(data)).toString("base64url");
let client: ConvexHttpClient | undefined,
  expires = 0;

export function tableSessionToken(
  subject: string,
  aliases: string[] = [],
  account: string | null = null,
  session: string | null = null,
) {
  return token(subject, "player", aliases, account, session);
}
function token(
  subject: string,
  role: "player" | "server",
  aliases: string[] = [],
  account: string | null = null,
  session: string | null = null,
) {
  const raw = process.env.STORAGE_JWT_PRIVATE_JWK,
    issuer = process.env.STORAGE_JWT_ISSUER;
  if (!raw || !issuer)
    throw new Error("Table storage authentication is not configured.");
  const key = JSON.parse(raw),
    now = Math.floor(Date.now() / 1000);
  const input =
    encoded({ alg: "RS256", typ: "JWT", kid: key.kid }) +
    "." +
    encoded({
      iss: issuer,
      aud: "island-table",
      sub: subject,
      // The SDK immediately requests a fresh token after its first handshake.
      // Two issues within one second must differ, or it stops scheduling refresh.
      jti: randomUUID(),
      role,
      aliases: JSON.stringify(aliases),
      account: account ?? "",
      session: session ?? "",
      iat: now,
      exp: now + 120,
    });
  return (
    input +
    "." +
    sign(
      "RSA-SHA256",
      Buffer.from(input),
      createPrivateKey({ key, format: "jwk" }),
    ).toString("base64url")
  );
}
export function storageClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Table storage is not configured.");
  if (!client) client = new ConvexHttpClient(url);
  if (Date.now() >= expires) {
    client.setAuth(token("storage-server", "server"));
    expires = Date.now() + 90_000;
  }
  return client;
}
