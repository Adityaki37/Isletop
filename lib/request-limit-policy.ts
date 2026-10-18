export type RequestKind =
  "create" | "join" | "action" | "session" | "read" | "write";
export type LimitScope = "network" | "player";
export function requestQuota(kind: RequestKind, scope: LimitScope) {
  const network = scope === "network";
  const limits = {
    create: [90, 6, 600_000, 1],
    join: [600, 60, 60_000, 6],
    action: [12000, 600, 60_000, 12],
    session: [600, 30, 60_000, 3],
    read: [6000, 300, 60_000, 12],
    write: [12000, 600, 60_000, 12],
  }[kind];
  const networkBatch = ["action", "read", "write"].includes(kind)
    ? limits[3] * 10
    : kind === "session"
      ? 6
      : limits[3];
  return {
    max: limits[network ? 0 : 1],
    windowMs: limits[2],
    batch: network ? networkBatch : limits[3],
  };
}
export type QuotaRow = { window: number; count: number };
export function reserveQuota(
  previous: QuotaRow | null,
  max: number,
  batch: number,
  windowMs: number,
  now: number,
) {
  const window = Math.floor(now / windowMs);
  const count = previous?.window === window ? previous.count : 0;
  const granted = Math.max(0, Math.min(batch, max - count));
  return {
    window,
    count: count + granted,
    granted,
    validForMs: (window + 1) * windowMs - now,
  };
}
