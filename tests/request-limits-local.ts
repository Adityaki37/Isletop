import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { api, storageClient, storageMutation } from "../lib/convex-client";
assert.equal(process.env.NEXT_PUBLIC_CONVEX_URL, "http://127.0.0.1:3210");
const origin = "http://localhost:5174";
let cookie = "";
const rooms: { code: string; created: number }[] = [];
async function call(path: string, body?: object) {
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of response.headers.getSetCookie()) cookie = c.split(";")[0];
  return {
    response,
    data: (await response.json()) as {
      error?: string;
      token?: string;
      game?: { code: string; created: number };
    },
  };
}
try {
  for (let i = 0; i < 6; i++) {
    const { response, data } = await call("/api/rooms", {
      op: "create",
      name: "Live QA 997/0",
      capacity: 2,
      public: false,
    });
    assert(response.ok, data.error);
    assert(data.game);
    rooms.push({ code: data.game.code, created: data.game.created });
    assert(response.headers.get("X-Request-ID"));
    assert(response.headers.get("Server-Timing"));
  }
  const rejected = await call("/api/rooms", {
    op: "create",
    name: "Live QA 997/0",
    capacity: 2,
    public: false,
  });
  assert.equal(rejected.response.status, 429);
  assert(Number(rejected.response.headers.get("Retry-After")) > 0);
  assert(/Too many/.test(rejected.data.error ?? ""));
  const first = await call("/api/table-session");
  assert(first.response.ok);
  assert(first.data.token);
  for (let i = 1; i < 30; i++)
    assert((await call("/api/table-session")).response.ok);
  const tokenDenied = await call("/api/table-session");
  assert.equal(tokenDenied.response.status, 429);
  assert(!tokenDenied.data.token);
  // Start away from a minute boundary so normal fixed-window rollover cannot
  // invalidate the intended denial assertion. All traffic remains loopback.
  const left = 60_000 - (Date.now() % 60_000);
  if (left < 20_000)
    await new Promise((resolve) => setTimeout(resolve, left + 20));
  for (let i = 0; i < 60; i++) {
    const r = await call("/api/rooms", { op: "join", code: "BAD", name: "QA" });
    assert.equal(r.response.status, 400);
  }
  assert.equal(
    (await call("/api/rooms", { op: "join", code: "BAD", name: "QA" })).response
      .status,
    429,
  );
  for (let batch = 0; batch < 6; batch++) {
    const replies = await Promise.all(
      Array.from({ length: 100 }, () =>
        call("/api/rooms", {
          op: "action",
          code: "BAD",
          nonce: crypto.randomUUID(),
          action: { type: "ready" },
        }),
      ),
    );
    assert(replies.every((r) => r.response.status === 400));
  }
  assert.equal(
    (
      await call("/api/rooms", {
        op: "action",
        code: "BAD",
        nonce: crypto.randomUUID(),
        action: { type: "ready" },
      })
    ).response.status,
    429,
  );
  const subject = crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");
  const shared = await Promise.all(
    Array.from({ length: 20 }, () =>
      storageMutation(api.requestLimits.reserve, {
        kind: "join",
        scope: "player",
        subject,
      }),
    ),
  );
  assert.equal(
    shared.reduce((sum, r) => sum + r.granted, 0),
    60,
  );
  const malformed = await call("/api/rooms", {});
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.data.error, "Unknown room operation.");
  const proof = {
    at: new Date().toISOString(),
    localOnly: true,
    createAllowance: 6,
    seventhCreate429: true,
    sessionAllowance: 30,
    thirtyFirstSession429: true,
    diagnosticHeaders: true,
    retryAfter: true,
    malformedBody400: true,
    sixtyFirstJoin429: true,
    sixHundredFirstAction429: true,
    concurrentSharedReservationsBounded: true,
  };
  writeFileSync(
    ".sites-runtime/safeguards-limits-local.json",
    JSON.stringify(proof, null, 2) + "\n",
  );
  console.log(JSON.stringify(proof));
} finally {
  await storageMutation(api.inspection.cleanupLoadRooms, { rooms });
  for (const room of rooms)
    assert.equal(
      await storageClient().query(api.rooms.load, { code: room.code }),
      null,
    );
}
