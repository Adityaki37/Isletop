import { createHash } from "node:crypto";
import { api, storageMutation } from "./convex-client";
import { LeasedRequestLimiter } from "./leased-request-limiter";
import type { RequestKind, LimitScope } from "./request-limit-policy";
export { RequestLimitError } from "./leased-request-limiter";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const limiter = new LeasedRequestLimiter(async (key) => {
  const [kind, scope, subject] = key.split(":");
  return storageMutation(api.requestLimits.reserve, {
    kind: kind as RequestKind,
    scope: scope as LimitScope,
    subject,
  });
});
export function limitNetwork(req: Request, kind: RequestKind) {
  // Vercel supplies/overwrites x-real-ip. Never trust caller Forwarded headers.
  // Development/unknown networks share a conservative aggregate bucket.
  const ip = process.env.VERCEL ? req.headers.get("x-real-ip") : null;
  return limiter.acquire(`${kind}:network:${hash(ip ?? "unknown-network")}`);
}
export const limitPlayer = (id: string, kind: RequestKind) =>
  limiter.acquire(`${kind}:player:${hash(id)}`);
