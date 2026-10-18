import assert from "node:assert/strict";
import { api, storageMutation } from "../lib/convex-client";
import { loadRoom } from "../lib/room-store";
import { actor, type Action, type View } from "../lib/game";
import { assertConvexReplay } from "./convex-replay-assertions";
const origin = process.env.TEST_ORIGIN!;
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
assert.equal(
  process.env.NEXT_PUBLIC_CONVEX_URL,
  "http://127.0.0.1:3210",
);
class Seat {
  cookie = "";
  async call(body: unknown) {
    const r = await fetch(origin + "/api/rooms", {
      method: "POST",
      headers: {
        Cookie: this.cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    for (const c of r.headers.getSetCookie()) this.cookie = c.split(";")[0];
    const d = (await r.json()) as { error?: string; game: View };
    assert(r.ok, d.error);
    return d.game as View;
  }
  async move(code: string, action: Action) {
    return this.call({
      op: "action",
      code,
      nonce: crypto.randomUUID(),
      action,
    });
  }
}
const seats = [new Seat(), new Seat()];
let g = await seats[0].call({
  op: "create",
  name: "Live QA 998/0",
  mode: "duel",
  capacity: 2,
  public: false,
});
const code = g.code,
  created = g.created;
try {
  await seats[1].call({ op: "join", code, name: "Clock friend" });
  await seats[0].move(code, { type: "settings", turnSeconds: 15 });
  for (const s of seats) await s.move(code, { type: "ready" });
  g = await seats[0].move(code, { type: "start" });
  while (g.phase.startsWith("setup")) {
    const p = actor(g as never);
    const raw = await loadRoom(code);
    assert(raw);
    const own = (await import("../lib/game")).view(raw, raw.players[p].id);
    g = await seats[p].move(
      code,
      g.phase === "setupSettlement"
        ? { type: "settlement", id: own.legal.settlement[0] }
        : { type: "road", id: own.legal.road[0] },
    );
  }
  assert.equal(g.phase, "roll");
  assert(g.deadline);
  const before = await loadRoom(code);
  assert(before);
  console.log(
    JSON.stringify({
      proof: "no-browser-clock-start",
      code,
      revision: before.revision,
      deadline: g.deadline,
    }),
  );
  await new Promise((r) =>
    setTimeout(r, Math.max(0, g.deadline! - Date.now()) + 2500),
  );
  const after = await loadRoom(code);
  assert(after);
  assert(
    after.revision > before.revision,
    "Cloud schedule committed without a browser or HTTP room reads.",
  );
  assert.notEqual(after.phase, "roll");
  await assertConvexReplay(after);
  console.log(
    JSON.stringify({
      passed: true,
      code,
      beforeRevision: before.revision,
      afterRevision: after.revision,
      phase: after.phase,
      scheduledWithoutBrowser: true,
      replayVerified: true,
    }),
  );
} finally {
  await storageMutation(api.inspection.cleanupLoadRooms, {
    rooms: [{ code, created }],
  });
}
