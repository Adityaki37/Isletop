import test from "node:test";
import assert from "node:assert/strict";
import { roomRequest, RoomNetworkError } from "../lib/room-transport";

test("lost move response retries the identical receipt once, without changing payload", async () => {
  const original = globalThis.fetch,
    requests: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(init!);
    if (requests.length === 1) throw new TypeError("connection reset");
    return Response.json({ revision: 4 });
  };
  try {
    const body = JSON.stringify({
      op: "action",
      nonce: "same-receipt",
      expectedCreated: 123,
      action: { type: "ready" },
    });
    assert.deepEqual(
      await roomRequest("/api/rooms", { method: "POST", body }, true),
      { revision: 4 },
    );
    assert.equal(requests.length, 2);
    assert.equal(requests[0].body, requests[1].body);
    assert(requests.every((r) => r.signal));
  } finally {
    globalThis.fetch = original;
  }
});
test("non-idempotent room creation is never automatically repeated", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError("connection reset");
  };
  try {
    await assert.rejects(
      roomRequest("/api/rooms", { method: "POST", body: "create" }),
      RoomNetworkError,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("a rejected move is not classified as a dropped connection or repeated", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: "The turn has changed" }, { status: 400 });
  };
  try {
    await assert.rejects(
      roomRequest("/api/rooms", {}, true),
      /turn has changed/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("aborting the owner of a request cancels retries", async () => {
  const original = globalThis.fetch,
    controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    controller.abort();
    throw init!.signal!.reason;
  };
  try {
    await assert.rejects(
      roomRequest("/api/rooms", { signal: controller.signal }, true),
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
