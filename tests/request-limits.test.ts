import test from "node:test";
import assert from "node:assert/strict";
import {
  LeasedRequestLimiter,
  RequestLimitError,
} from "../lib/leased-request-limiter";
import {
  reserveQuota,
  requestQuota,
  type QuotaRow,
} from "../lib/request-limit-policy";
import { requestObservation } from "../lib/request-observability";
test("independent instances share a hard quota; retries and eviction cannot mint allowance", async () => {
  let row: QuotaRow | null = null,
    calls = 0,
    now = 100;
  const reserve = async () => {
    calls++;
    const grant = reserveQuota(row, 25, 4, 1000, now);
    row = grant;
    return grant;
  };
  const workers = Array.from(
    { length: 8 },
    () => new LeasedRequestLimiter(reserve, () => now, 2),
  );
  const results = await Promise.allSettled(
    Array.from({ length: 80 }, (_, i) => workers[i % 8].acquire("action")),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 25);
  assert.equal(row!.count, 25);
  assert(calls < 35);
  await assert.rejects(
    new LeasedRequestLimiter(reserve, () => now).acquire("action"),
    RequestLimitError,
  );
  now = 1100;
  await workers[0].acquire("action");
  assert.equal(row!.window, 1);
});
test("concurrent requests on one instance consume every grant once and refill exhausted leases", async () => {
  let row: QuotaRow | null = null,
    calls = 0;
  const worker = new LeasedRequestLimiter(
    async () => {
      calls++;
      await Promise.resolve();
      const grant = reserveQuota(row, 12, 3, 1000, 100);
      row = grant;
      return grant;
    },
    () => 100,
  );
  const results = await Promise.allSettled(
    Array.from({ length: 15 }, () => worker.acquire("same")),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 12);
  assert.equal(calls, 5);
  await assert.rejects(worker.acquire("same"), RequestLimitError);
  assert.equal(calls, 5);
});
test("storage failure fails closed and permits a later recovery; expired grants are unusable", async () => {
  let now = 0,
    calls = 0;
  const worker = new LeasedRequestLimiter(
    async () => {
      calls++;
      if (calls === 1) throw Error("storage unavailable");
      if (calls === 2) {
        now += 1000;
        return { granted: 4, validForMs: 10 };
      }
      return { granted: 1, validForMs: 1000 };
    },
    () => now,
  );
  await assert.rejects(worker.acquire("same"), /storage unavailable/);
  await assert.rejects(worker.acquire("same"), RequestLimitError);
  await worker.acquire("same");
});
test("thirty cold instances behind one network can join and acquire initial and refresh tokens", async () => {
  for (const kind of ["join", "session"] as const) {
    let row: QuotaRow | null = null;
    const p = requestQuota(kind, "network");
    const workers = Array.from(
      { length: 30 },
      () =>
        new LeasedRequestLimiter(
          async () => {
            const grant = reserveQuota(row, p.max, p.batch, p.windowMs, 100);
            row = grant;
            return grant;
          },
          () => 100,
        ),
    );
    await Promise.all(
      workers.map(async (w) => {
        for (let n = 0; n < (kind === "session" ? 4 : 2); n++)
          await w.acquire(kind);
      }),
    );
    assert(row!.count <= p.max);
  }
});
test("diagnostic responses log only a bounded schema and expose retry/request/timing headers", () => {
  const warn = console.warn;
  const logged: string[] = [];
  console.warn = (s) => logged.push(String(s));
  try {
    const o = requestObservation("rooms");
    o.operation("action");
    const r = o.respond(
      { error: "private sentinel body" },
      "secret sentinel cookie",
      429,
      42,
    );
    assert.equal(r.headers.get("Retry-After"), "42");
    assert.match(r.headers.get("X-Request-ID")!, /^[\da-f-]{36}$/);
    assert.match(r.headers.get("Server-Timing")!, /^app;dur=\d/);
    assert.equal(logged.length, 1);
    assert(!logged[0].includes("sentinel"));
    assert.deepEqual(
      Object.keys(JSON.parse(logged[0])).sort(),
      [
        "durationMs",
        "event",
        "operation",
        "outcome",
        "requestId",
        "route",
        "status",
        "occurrences",
      ].sort(),
    );
    o.respond({ error: "private sentinel repeated" }, null, 429, 42);
    assert.equal(logged.length, 1);
  } finally {
    console.warn = warn;
  }
});
