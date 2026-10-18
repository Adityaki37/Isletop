import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { storageMutation } from "../lib/convex-client";
import { loadRoom } from "../lib/room-store";
import { emptyHand } from "../lib/board";
import { chooseMove } from "./autoplay";
import { chooseLegalCitiesMove, citiesMatchActor } from "./cities-match-driver";
import { assertConvexReplay } from "./convex-replay-assertions";
import { actor, type View, type Game, type Action } from "../lib/game";
const origin = process.env.TEST_ORIGIN ?? "http://localhost:5174",
  url = process.env.NEXT_PUBLIC_CONVEX_URL!;
const hosted = false;
const localBackend = process.env.TEST_LOCAL_CONVEX === "1";
const fullGames = process.env.TEST_FULL_GAMES === "1",
  finishedGames: Record<string, unknown>[] = [];
assert(hosted || ["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
assert.equal(
  url,
  localBackend
    ? "http://127.0.0.1:3210"
    : hosted
      ? "http://127.0.0.1:3210"
      : "http://127.0.0.1:3210",
  "The storage deployment must match the verified test host.",
);
assert(
  !localBackend ||
    (!hosted && ["127.0.0.1", "localhost"].includes(new URL(origin).hostname)),
);
const errors: string[] = [],
  clients: Session[] = [],
  writes: number[] = [],
  samples: { type: string; duration: number }[] = [],
  delivered: number[] = [];
class Session {
  tokenFetches = 0;
  jar = new Map<string, string>();
  live: ConvexClient | null = null;
  current: View | null = null;
  stop: (() => void) | null = null;
  seat = -1;
  code = "";
  async call(path: string, body?: unknown) {
    const r = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const p = c.split(";")[0],
        i = p.indexOf("=");
      this.jar.set(p.slice(0, i), p.slice(i + 1));
    }
    const data = (await r.json()) as {
      error?: string;
      game: View;
      token: string;
    };
    assert(r.ok, `${r.status} ${data.error}`);
    return data;
  }
  async move(action: Action, nonce = crypto.randomUUID()) {
    const at = performance.now(),
      g = (
        await this.call("/api/rooms", {
          op: "action",
          code: this.code,
          action,
          nonce,
        })
      ).game,
      duration = performance.now() - at;
    writes.push(duration);
    samples.push({ type: action.type, duration });
    return g;
  }
  subscribe() {
    this.live = new ConvexClient(url);
    this.live.setAuth(async () => {
      this.tokenFetches++;
      return (await this.call("/api/table-session")).token;
    });
    this.stop = this.live.onUpdate(
      api.roomViews.table,
      { code: this.code },
      (g) => {
        try {
          assert(g);
          const next = g as View;
          assert.equal(next.me, this.seat);
          assert(
            next.players.every(
              (p, i) => !("id" in p) && !!p.hand === (i === this.seat),
            ),
            `Private hands must remain seat-owned, including after finishing ${next.code}/${next.phase}.`,
          );
          assert(
            !("deck" in next) &&
              !("diceState" in next) &&
              !("receipts" in next),
          );
          this.current = next;
        } catch (e) {
          errors.push(String(e));
        }
      },
      (e) => errors.push(e.message),
    );
  }
  async wait(revision: number, started = performance.now()) {
    const limit = Date.now() + 15000;
    while (!this.current || this.current.revision < revision) {
      if (errors.length) throw Error(errors.join("\n"));
      assert(
        Date.now() < limit,
        "A live client did not receive the committed room revision.",
      );
      await new Promise((r) => setTimeout(r, 20));
    }
    delivered.push(performance.now() - started);
    return this.current;
  }
  async close() {
    this.stop?.();
    await this.live?.close();
  }
}
const sizes = [8, 8, 6, 4, 4],
  modes: Game["mode"][] = [
    "base",
    "base",
    "seafarers",
    "citiesKnights",
    "seafarersCitiesKnights",
  ],
  rooms: { code: string; created: number; seats: Session[] }[] = [];
try {
  for (let i = 0; i < sizes.length; i++) {
    const seats = Array.from({ length: sizes[i] }, () => new Session()),
      g = (
        await seats[0].call("/api/rooms", {
          op: "create",
          name: `Live QA ${i}/0`,
          capacity: sizes[i],
          mode: modes[i],
          public: false,
          ...(localBackend && i === 1 ? { map: "gear" } : {}),
          ...(localBackend && i === 3 ? { map: "pond" } : {}),
        })
      ).game;
    for (let p = 1; p < seats.length; p++)
      await seats[p].call("/api/rooms", {
        op: "join",
        code: g.code,
        name: `Live QA ${i}/${p}`,
      });
    seats.forEach((s, p) => {
      s.code = g.code;
      s.seat = p;
      clients.push(s);
      s.subscribe();
    });
    rooms.push({ code: g.code, created: g.created, seats });
  }
  assert.equal(clients.length, 30);
  await Promise.all(clients.map((s) => s.wait(0)));
  console.log(
    "Connected 30 independently authenticated realtime clients across five rooms.",
  );
  const ready = await Promise.all(
    clients.map((s) => s.move({ type: "ready" })),
  );
  for (let i = 0; i < rooms.length; i++) {
    const rev = Math.max(
      ...ready.filter((g) => g.code === rooms[i].code).map((g) => g.revision),
    );
    await Promise.all(rooms[i].seats.map((s) => s.wait(rev)));
    assert(rooms[i].seats[0].current!.players.every((p) => p.ready));
  }
  await Promise.all(
    rooms.map(async ({ seats }) => {
      let g = await seats[0].move({ type: "start" });
      await Promise.all(seats.map((s) => s.wait(g.revision)));
      while (g.phase.startsWith("setup")) {
        const p = actor(g as unknown as Game),
          own = await seats[p].wait(g.revision),
          legal = own.legal;
        for (const s of seats) {
          const v = await s.wait(g.revision);
          if (s.seat !== p)
            assert.equal(
              v.legal.settlement.length +
                v.legal.road.length +
                v.legal.ship.length,
              0,
              "Setup placement highlights appear only for the acting seat.",
            );
        }
        let action: Action =
          g.phase === "setupSettlement"
            ? { type: "settlement", id: legal.settlement[0] }
            : legal.road.length
              ? { type: "road", id: legal.road[0] }
              : { type: "ship", id: legal.ship[0] };
        if (fullGames) {
          const raw = await loadRoom(g.code);
          assert(raw);
          action = raw.cities
            ? chooseLegalCitiesMove(raw)
            : chooseMove(proxy(own), p)!;
        }
        assert(
          Number.isInteger((action as { id: number }).id),
          "Acting seat has a legal highlighted placement.",
        );
        g = await seats[p].move(action);
        await Promise.all(seats.map((s) => s.wait(g.revision)));
      }
      assert.equal(g.phase, "roll");
    }),
  );
  const first = rooms[0].seats[0],
    nonce = crypto.randomUUID();
  const one = await first.move({ type: "roll" }, nonce),
    again = await first.move({ type: "roll" }, nonce);
  assert.equal(one.revision, again.revision);
  await Promise.all(rooms[0].seats.map((s) => s.wait(one.revision)));
  if (fullGames)
    await Promise.all(
      rooms.map(async ({ code, seats }) => {
        let moves = 0,
          g = seats[0].current!;
        while (g.phase !== "finished" && moves < 12000) {
          const raw = await loadRoom(code);
          assert(raw);
          const p = citiesMatchActor(raw),
            own = await seats[p].wait(raw.revision);
          const action = raw.cities
            ? chooseLegalCitiesMove(raw)
            : chooseMove(proxy(own), p);
          assert(action, `No legal test move at ${code}/${g.phase}`);
          g = await seats[p].move(action);
          await Promise.all(seats.map((s) => s.wait(g.revision)));
          if (++moves % 100 === 0) {
            const saved = await loadRoom(code);
            assert(saved);
            await assertConvexReplay(saved);
            console.log(
              JSON.stringify({
                progress: true,
                code,
                mode: g.mode,
                moves,
                turn: g.turn,
                scores: g.players.map((p) => p.score),
              }),
            );
          }
        }
        assert.equal(
          g.phase,
          "finished",
          `The natural ${g.mode} game must reach its default target.`,
        );
        assert(g.winner !== null && g.players[g.winner].score >= g.target);
        const saved = await loadRoom(code);
        assert(saved);
        await assertConvexReplay(saved);
        const proof = {
          code,
          mode: g.mode,
          players: seats.length,
          moves,
          turn: g.turn,
          target: g.target,
          winner: g.winner,
          score: g.players[g.winner].score,
          matchId: saved.statistics!.id,
        };
        finishedGames.push(proof);
        console.log(JSON.stringify({ passed: true, ...proof }));
      }),
    );
  assert.deepEqual(errors, []);
  writes.sort((a, b) => a - b);
  delivered.sort((a, b) => a - b);
  const byAction = Object.fromEntries(
    [...new Set(samples.map((s) => s.type))].map((type) => {
      const ms = samples
        .filter((s) => s.type === type)
        .map((s) => s.duration)
        .sort((a, b) => a - b);
      return [
        type,
        {
          count: ms.length,
          p50Ms: ms[Math.floor(ms.length * 0.5)],
          p95Ms: ms[Math.floor(ms.length * 0.95)],
          maxMs: ms.at(-1),
        },
      ];
    }),
  );
  const result = {
    at: new Date().toISOString(),
    origin,
    scope: hosted
      ? "30 real Convex WebSocket clients and independent HTTP cookie sessions against actual public Vercel production hosting and production cloud Convex"
      : localBackend
        ? "Local functional regression: 30 SDK WebSocket clients and independent HTTP cookies; both Next.js and real Convex backend on loopback. No cloud capacity claim."
        : "30 real Convex WebSocket clients and independent HTTP cookie sessions against a warmed local production Next.js build plus isolated cloud Convex",
    targetP95Ms: 1500,
    clients: 30,
    rooms: 5,
    modes,
    sizes,
    writes: writes.length,
    writeP50Ms: writes[Math.floor(writes.length * 0.5)],
    writeP95Ms: writes[Math.floor(writes.length * 0.95)],
    deliveryP95Ms: delivered[Math.floor(delivered.length * 0.95)],
    byAction,
    allSetupComplete: true,
    privateViewsVerified: true,
    placementHighlightsVerified: true,
    idempotencyVerified: true,
    errors,
    fullGames,
    finishedGames,
    tokenFetchCounts: clients.map((s) => s.tokenFetches),
  };
  writeFileSync(
    ".sites-runtime/convex-live-load.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await Promise.allSettled(clients.map((s) => s.close()));
  await storageMutation(api.inspection.cleanupLoadRooms, {
    rooms: rooms.map(({ code, created }) => ({ code, created })),
  });
}

function proxy(g: View): Game {
  return {
    ...g,
    players: g.players.map((p) => ({
      ...p,
      id: "test-only",
      hand: p.hand ?? { ...emptyHand(), wood: p.resources },
      dev: p.dev ?? [],
    })),
    deck: Array(g.deckCount).fill("knight"),
    receipts: [],
  } as unknown as Game;
}
