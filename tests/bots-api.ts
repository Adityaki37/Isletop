// Ordinary local HTTP requests, real connection grace, no SQL/state injection.
import assert from "node:assert/strict";
import { actor, type View } from "../lib/game";
import { BOT_DISCONNECT_GRACE, BOT_MOVE_INTERVAL } from "../lib/disconnect-bots";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
class Seat {
  cookie = "";
  async request(path: string, body?: Record<string, unknown>) {
    const r = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: this.cookie,
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const cookie = r.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    return {
      status: r.status,
      ...((await r.json()) as { game: View; error?: string; ok?: boolean }),
    };
  }
  async ok(path: string, body?: Record<string, unknown>) {
    const r = await this.request(path, body);
    assert.equal(r.status, 200, r.error);
    return r;
  }
  move(g: View, action: Record<string, unknown>) {
    return this.ok("/api/rooms", {
      op: "action",
      code: g.code,
      expectedCreated: g.created,
      nonce: crypto.randomUUID(),
      action,
    }).then((r) => r.game);
  }
  presence(g: View, op: string, token: string) {
    return this.ok("/api/presence", {
      op,
      code: g.code,
      created: g.created,
      token,
    });
  }
  read(g: View) {
    return this.ok(`/api/rooms?code=${g.code}`).then((r) => r.game);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rooms = [];
for (const mode of [
  "base",
  "seafarers",
  "citiesKnights",
  "seafarersCitiesKnights",
] as const) {
  const host = new Seat(),
    guest = new Seat(),
    spectator = new Seat();
  let g = (
    await host.ok("/api/rooms", {
      op: "create",
      mode,
      capacity: 3,
      name: "Bot Connection QA",
    })
  ).game;
  await guest.ok("/api/rooms", {
    op: "join",
    code: g.code,
    name: "Human Guest",
  });
  assert.equal(
    (
      await guest.request("/api/rooms", {
        op: "action",
        code: g.code,
        nonce: crypto.randomUUID(),
        action: { type: "addBot" },
      })
    ).status,
    400,
  );
  g = await host.move(g, { type: "addBot" });
  assert(g.players[2].bot);
  assert(g.players[2].ready);
  g = await host.move(g, { type: "settings", turnSeconds: 0 });
  await guest.move(g, { type: "ready" });
  const token = crypto.randomUUID(),
    otherTab = crypto.randomUUID();
  await host.presence(g, "beat", token);
  await host.presence(g, "beat", otherTab);
  g = await host.move(g, { type: "start" });
  await host.presence(g, "release", token);
  g = await spectator.read(g);
  assert(
    !g.botPlayers.includes(0),
    "A second connected tab preserves human control",
  );
  await host.presence(g, "release", otherTab);
  g = await spectator.read(g);
  assert(!g.botPlayers.includes(0), "Grace prevents instant takeover");
  rooms.push({ mode, host, guest, spectator, g });
}
await sleep(BOT_DISCONNECT_GRACE + 300);
for (const r of rooms) {
  let g = await r.spectator.read(r.g);
  assert(g.botPlayers.includes(0));
  assert(g.botPlayers.includes(2));
  assert.equal(g.phase, "setupRoad");
  assert.equal(g.board.vertices.filter((v) => v.owner === 0).length, 1);
  const states = await Promise.all(
    Array.from({ length: 5 }, () => r.spectator.read(g)),
  );
  assert(
    states.every(
      (s) => s.board.vertices.filter((v) => v.owner === 0).length === 1,
    ),
    "Concurrent polls do not duplicate moves",
  );
  const freshToken = crypto.randomUUID();
  await r.host.presence(g, "beat", freshToken);
  g = await r.host.read(g);
  assert(!g.botPlayers.includes(0), "Reconnection restores the original human");
  const id = g.legal.road[0] ?? g.legal.ship[0];
  assert(id !== undefined);
  g = await r.host.move(g, { type: g.legal.road.length ? "road" : "ship", id });
  for (let step = 0; g.phase.startsWith("setup") && step < 40; step++) {
    const p = actor(g);
    if (p === 2) {
      await sleep(BOT_MOVE_INTERVAL + 50);
      g = await r.spectator.read(g);
      continue;
    }
    const seat = p === 0 ? r.host : r.guest;
    g = await seat.read(g);
    g = await seat.move(
      g,
      g.phase === "setupSettlement"
        ? { type: "settlement", id: g.legal.settlement[0] }
        : g.legal.road.length
          ? { type: "road", id: g.legal.road[0] }
          : { type: "ship", id: g.legal.ship[0] },
    );
  }
  assert.equal(g.phase, "roll");
  assert.equal(g.board.vertices.filter((v) => v.owner === 2).length, 2);
  g = await r.host.move(g, { type: "roll" });
  assert(!("logDetails" in g));
  console.log(
    `${r.mode} ${g.code}: add/join/start, grace, multiple tabs, concurrent polling, bot placements and human reconnection passed`,
  );
}
