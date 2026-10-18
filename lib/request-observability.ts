import { randomUUID } from "node:crypto";
type Route = "rooms" | "table-session";
type Operation =
  | "read"
  | "write"
  | "create"
  | "join"
  | "action"
  | "leave"
  | "rematch"
  | "session";
const summaries = new Map<string, { at: number; count: number }>();
export function requestObservation(route: Route) {
  const id = randomUUID(),
    started = performance.now();
  let operation: Operation = route === "table-session" ? "session" : "read";
  return {
    operation: (next: Operation) => {
      operation = next;
    },
    respond: (
      data: unknown,
      cookie: string | null = null,
      status = 200,
      retryAfter?: number,
    ) => {
      const duration = Math.round((performance.now() - started) * 10) / 10;
      const headers: Record<string, string> = {
        "Cache-Control": "no-store",
        "X-Request-ID": id,
        "Server-Timing": `app;dur=${duration}`,
      };
      if (cookie) headers["Set-Cookie"] = cookie;
      if (retryAfter) headers["Retry-After"] = String(retryAfter);
      const event = {
        event: "table_request",
        requestId: id,
        route,
        operation,
        status,
        durationMs: duration,
        outcome:
          status === 429
            ? "rate_limit"
            : status >= 500
              ? "unavailable"
              : status >= 400
                ? "rejected"
                : "ok",
      };
      // Error/slow bursts are aggregated per instance over thirty seconds;
      // ordinary successes are sampled at 5%. No error object,
      // body, URL query, name, cookie, identity, private hand or token is logged.
      if (status >= 400 || duration >= 1500) {
        const key = route + ":" + operation + ":" + event.outcome,
          now = performance.now(),
          previous = summaries.get(key);
        const count = (previous?.count ?? 0) + 1;
        if (!previous || now - previous.at >= 30_000) {
          const entry = JSON.stringify({ ...event, occurrences: count });
          if (status >= 500) console.error(entry);
          else console.warn(entry);
          summaries.set(key, { at: now, count: 0 });
        } else previous.count = count;
      } else if (Math.random() < 0.05) console.info(JSON.stringify(event));
      return Response.json(data, { status, headers });
    },
  };
}
