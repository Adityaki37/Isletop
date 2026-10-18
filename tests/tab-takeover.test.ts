import test from "node:test";
import assert from "node:assert/strict";
import { createGame, player, addPlayer, type Game } from "../lib/game";
import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import {
  botSeats,
  advanceBots,
  BOT_DISCONNECT_GRACE,
} from "../lib/disconnect-bots";
import { connection, seats, expiries } from "../convex/presence";
import { connectionTimes } from "../convex/tableTimers";
import type { MutationCtx, QueryCtx } from "../convex/_generated/server";
import { TABLE_CONNECTION_TTL } from "../lib/table-presence";
type Row = { _id: string; [key: string]: unknown };
function fixture() {
  const g = createGame("AWAY22", player("host", "Host"), 2);
  addPlayer(g, player("guest", "Guest"));
  g.players.forEach((p) => {
    p.ready = true;
  });
  applyAction(g, 0, { type: "start" });
  const tables: Record<string, Row[]> = {
    rooms: [{ _id: "room", state: JSON.stringify(g), code: g.code }],
    tableConnections: [],
    roomTimers: [],
  };
  const jobs = new Map<string, { state: { kind: string } }>();
  let serial = 0;
  const ctx = {
    auth: {
      getUserIdentity: async () => ({
        subject: "storage-server",
        role: "server",
      }),
    },
    db: {
      query(table: string) {
        const predicates: ((row: Row) => boolean)[] = [];
        const q = {
          withIndex(_name: string, cb: (q: unknown) => unknown) {
            const range = {
              eq(field: string, value: unknown) {
                predicates.push((row) => row[field] === value);
                return range;
              },
              lte(field: string, value: number) {
                predicates.push((row) => Number(row[field]) <= value);
                return range;
              },
            };
            cb(range);
            return q;
          },
          async collect() {
            return (tables[table] ?? []).filter((row) =>
              predicates.every((p) => p(row)),
            );
          },
          async unique() {
            return (await q.collect())[0] ?? null;
          },
          async take(n: number) {
            return (await q.collect()).slice(0, n);
          },
        };
        return q;
      },
      async get(id: string) {
        return (
          Object.values(tables)
            .flat()
            .find((row) => row._id === id) ?? null
        );
      },
      async insert(table: string, value: object) {
        const id = "row-" + ++serial;
        (tables[table] ??= []).push({ _id: id, ...value });
        return id;
      },
      async patch(id: string, value: object) {
        const row = Object.values(tables)
          .flat()
          .find((row) => row._id === id);
        assert(row);
        Object.assign(row, value);
      },
      async delete(id: string) {
        for (const rows of Object.values(tables)) {
          const i = rows.findIndex((row) => row._id === id);
          if (i >= 0) rows.splice(i, 1);
        }
      },
      system: { get: async (id: string) => jobs.get(id) ?? null },
    },
    scheduler: {
      async runAt() {
        const id = "job-" + ++serial;
        jobs.set(id, { state: { kind: "pending" } });
        return id;
      },
      async cancel(id: string) {
        jobs.set(id, { state: { kind: "canceled" } });
      },
    },
  } as unknown as MutationCtx;
  return { g, ctx, tables };
}
const announce = (
  connection as unknown as {
    _handler: (ctx: MutationCtx, args: { data: object }) => Promise<unknown>;
  }
)._handler;
const readSeats = (
  seats as unknown as {
    _handler: (
      ctx: QueryCtx,
      args: { code: string },
    ) => Promise<{ connected: boolean[] }>;
  }
)._handler;
const readExpiries = (
  expiries as unknown as {
    _handler: (
      ctx: QueryCtx,
      args: { code: string; created: number; players: string[] },
    ) => Promise<(number | null)[]>;
  }
)._handler;
function payload(g: Game, op: string, token = "tab-a") {
  return {
    op,
    token,
    code: g.code,
    created: g.created,
    player: "host",
    account: null,
    hash: null,
    ttl: TABLE_CONNECTION_TTL,
  };
}
test("hidden tabs yield immediately, visible sibling tabs prevent takeover, and returning restores human control", async () => {
  const { g, ctx, tables } = fixture();
  await announce(ctx, { data: payload(g, "beat") });
  assert.deepEqual(botSeats(g, await connectionTimes(ctx, g), Date.now()), []);
  await announce(ctx, { data: payload(g, "away") });
  const times = await connectionTimes(ctx, g);
  assert(times[0]! + BOT_DISCONNECT_GRACE <= Date.now());
  assert.deepEqual(botSeats(g, times, Date.now()), [0]);
  assert.equal((await readSeats(ctx, { code: g.code })).connected[0], false);
  assert(
    Number(tables.roomTimers[0].wakeAt) <= Date.now() + 50,
    "Takeover is scheduled immediately",
  );
  assert.deepEqual(
    await readExpiries(ctx, {
      code: g.code,
      created: g.created,
      players: g.players.map((p) => p.id),
    }),
    times,
  );
  advanceBots(g, [0], Date.now());
  assert.equal(g.phase, "setupRoad");
  await announce(ctx, { data: payload(g, "beat", "tab-b") });
  assert.deepEqual(botSeats(g, await connectionTimes(ctx, g), Date.now()), []);
  assert.equal((await readSeats(ctx, { code: g.code })).connected[0], true);
  await announce(ctx, { data: payload(g, "away", "tab-b") });
  assert.deepEqual(botSeats(g, await connectionTimes(ctx, g), Date.now()), [0]);
  await announce(ctx, { data: payload(g, "beat") });
  const human = botSeats(g, await connectionTimes(ctx, g), Date.now());
  assert.deepEqual(human, []);
  advanceBots(g, human, Date.now());
  assert.deepEqual(g.botPlayers, []);
  assert.equal(!!g.players[0].bot, false);
  assert.equal(g.players[0].id, "host");
});
test("starting in a hidden tab can yield without an earlier heartbeat and cannot alter another seat or game", async () => {
  const { g, ctx, tables } = fixture();
  await announce(ctx, { data: payload(g, "away") });
  assert.deepEqual(botSeats(g, await connectionTimes(ctx, g), Date.now()), [0]);
  const before = JSON.stringify(tables.tableConnections);
  await assert.rejects(
    () => announce(ctx, { data: { ...payload(g, "away"), player: "guest" } }),
    /new connection/,
  );
  await assert.rejects(
    () =>
      announce(ctx, {
        data: { ...payload(g, "away"), created: g.created - 1 },
      }),
    /restarted/,
  );
  await assert.rejects(
    () =>
      announce(ctx, {
        data: { ...payload(g, "away", "outsider"), player: "outsider" },
      }),
    /seated/,
  );
  assert.equal(JSON.stringify(tables.tableConnections), before);
});
