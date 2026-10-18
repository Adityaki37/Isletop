// Ordinary HTTP guests against the explicitly authorized public QA instance.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const origin = process.env.TEST_ORIGIN ?? "http://localhost:5174";
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
class Session {
  cookies = new Map();
  ticket = crypto.randomUUID();
  async call(path = "/api/matchmaking", body) {
    const response = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: [...this.cookies.values()].join("; "),
        ...(body ? { Origin: origin, "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      this.cookies.set(pair.split("=")[0], pair);
    }
    const data = await response.json();
    assert.equal(response.status, 200, data.error);
    return data;
  }
}
const clients = Array.from({ length: 16 }, () => new Session());
const rooms = new Map();
try {
  await Promise.all(clients.map((session) => session.call()));
  const start = performance.now();
  await Promise.all(
    clients.map((session, index) =>
      session.call("/api/matchmaking", {
        op: "join",
        queue: "duel",
        ticket: session.ticket,
        name: `Hosted Queue QA ${index}`,
        avatar: "player",
      }),
    ),
  );
  const burstElapsedMs = performance.now() - start;
  const states = await Promise.all(clients.map((session) => session.call()));
  states.forEach((state, index) => {
    assert.equal(state.status, "matched");
    const seats = rooms.get(state.code) ?? [];
    seats.push(index);
    rooms.set(state.code, seats);
  });
  assert.equal(rooms.size, 8);
  for (const [code, seats] of rooms) {
    assert.equal(seats.length, 2);
    const views = await Promise.all(
      seats.map((index) => clients[index].call(`/api/rooms?code=${code}`)),
    );
    assert.equal(views[0].game.players.length, 2);
    assert.equal(new Set(views.map((view) => view.game.me)).size, 2);
    const result = await clients[seats[0]].call("/api/rooms", {
      op: "action",
      code,
      action: { type: "resign" },
      nonce: crypto.randomUUID(),
    });
    assert.equal(result.game.phase, "finished");
  }
  const report = {
    passed: true,
    origin,
    clients: clients.length,
    rooms: rooms.size,
    burstElapsedMs,
    finishedByOrdinaryResignation: rooms.size,
    at: new Date().toISOString(),
  };
  writeFileSync(
    ".sites-runtime/hosted-matchmaking-final.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  // A failed assertion must not leave matched games running turn clocks.
  const statuses = await Promise.allSettled(
    clients.map((session) => session.call()),
  );
  const cleaned = new Set();
  for (let index = 0; index < statuses.length; index++) {
    const status = statuses[index];
    if (status.status !== "fulfilled") continue;
    if (status.value.status === "waiting") {
      await clients[index].call("/api/matchmaking", {
        op: "cancel",
        ticket: clients[index].ticket,
      });
    } else if (
      status.value.status === "matched" &&
      !cleaned.has(status.value.code)
    ) {
      const code = status.value.code;
      cleaned.add(code);
      const { game } = await clients[index].call(`/api/rooms?code=${code}`);
      if (game.phase !== "finished")
        await clients[index].call("/api/rooms", {
          op: "action",
          code,
          action: { type: "resign" },
          nonce: crypto.randomUUID(),
        });
    }
  }
}
