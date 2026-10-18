// Local sessions mutate games only through ordinary HTTP requests. Trusted
// Convex reads verify settlements, inventories and immutable replays.
import assert from "node:assert/strict";
import { loadRoom } from "../lib/room-store";
import { api, storageClient } from "../lib/convex-client";
import { assertConvexReplay } from "./convex-replay-assertions";
import { writeFileSync } from "node:fs";
import {
  actor,
  moveContext,
  type Game,
  type View,
  type Action,
} from "../lib/game";
import { RESOURCES, emptyHand } from "../lib/board";
import { chooseMove } from "./autoplay";
import { citiesCandidates, citiesMatchActor } from "./cities-match-driver";
import { chooseRushMove } from "./rush-match-driver";
import { assertCitiesInventory } from "./cities-match-inventory";
import { assertFinishedReplay } from "./replay-assertions";
import {
  RANKED_QUEUES,
  type RankedQueue,
  type MatchmakingStatus,
} from "../lib/matchmaking-types";
import type { LeaderboardData, RankedProfileData } from "../lib/ranked-types";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
async function raw(code: string): Promise<Game> {
  const g = await loadRoom(code);
  assert(g);
  return g;
}
class Session {
  cookies = new Map<string, string>();
  username = "";
  password = "";
  get cookie() {
    return [...this.cookies.values()].join("; ");
  }
  async request<T>(path: string, body?: unknown, expected = 200): Promise<T> {
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: this.cookie,
        ...(body === undefined
          ? {}
          : { Origin: origin, "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      this.cookies.set(pair.split("=")[0], pair);
    }
    const result = (await response.json()) as T & {
      error?: string;
    };
    assert.equal(response.status, expected, `${path}: ${result.error}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return result;
  }
  async register(i: number) {
    this.username = `rank_${crypto.randomUUID().slice(0, 8)}_${i}`;
    this.password = `Ranked proof pass ${crypto.randomUUID()}`;
    await this.request(
      "/api/accounts",
      {
        op: "register",
        username: this.username,
        password: this.password,
        displayName: `Rank Human ${i}`,
      },
      201,
    );
  }
  async game(code: string) {
    return (
      await this.request<{
        game: View;
      }>("/api/rooms?code=" + code)
    ).game;
  }
  async room(body: unknown) {
    return (
      await this.request<{
        game: View;
      }>("/api/rooms", body)
    ).game;
  }
  async move(
    code: string,
    action: Action,
    context?: string,
    nonce = crypto.randomUUID(),
  ) {
    return this.room({ op: "action", code, action, context, nonce });
  }
  queue(queue: RankedQueue) {
    return this.request<MatchmakingStatus>("/api/matchmaking", {
      op: "join",
      queue,
      ticket: crypto.randomUUID(),
    });
  }
  profile() {
    return this.request<RankedProfileData>(
      "/api/leaderboards?profile=" + this.username,
    );
  }
}
const guest = new Session();
await guest.request("/api/matchmaking");
await guest.request(
  "/api/matchmaking",
  { op: "join", queue: "rankedDuel", ticket: crypto.randomUUID() },
  401,
);
await guest.request("/api/leaderboards?friends=1", undefined, 401);
for (const q of [
  "mode=constructor",
  "season=2026-10",
  "season=2099-11",
  "offset=-1",
  "offset=1.1",
  "search=" + "x".repeat(33),
])
  await guest.request("/api/leaderboards?" + q, undefined, 400);
const seats = Array.from({ length: 4 }, () => new Session());
for (let i = 0; i < seats.length; i++) {
  const s = seats[i];
  await s.register(i);
  await s.request(
    "/api/matchmaking",
    { op: "join", queue: "rankedDuel", ticket: crypto.randomUUID() },
    403,
  );
  const partner = new Session();
  await partner.request("/api/matchmaking");
  for (let count = 0; count < 5; count++) {
    let g = await s.room({
      op: "create",
      name: "Qualification",
      mode: "duel",
      capacity: 2,
      public: false,
    });
    const code = g.code;
    await partner.room({ op: "join", code, name: "Qualification Friend" });
    await s.move(code, { type: "ready" });
    await partner.move(code, { type: "ready" });
    await s.move(code, { type: "start" });
    g = await s.move(code, { type: "resign" });
    assert.equal(g.phase, "finished");
    assert(!g.ranked);
  }
  const status = await s.request<MatchmakingStatus>("/api/matchmaking");
  assert.equal(status.rankedEligibility?.played, 5);
  assert(
    (await s.profile()).ratings.every(
      (r) => r.games === 0 && r.rating === null,
    ),
  );
}
console.log(
  "PASS: accounts, five ordinary qualification games, guest/locked rejection and leaderboard validation",
);
const report: Record<string, unknown>[] = [];
async function assertSettlement(g: Game) {
  const r = g.ranked!;
  const data = (await storageClient().query(api.inspection.read, {
    op: "ratings",
    key: g.statistics!.id,
  })) as {
    result: {
      result: string;
    } | null;
    ratings: {
      accountId: string;
      season: string;
      mode: string;
      rating: number;
      games: number;
      wins: number;
    }[];
  };
  for (let i = 0; i < r.seats.length; i++) {
    const s = r.seats[i],
      row = data.ratings.find(
        (x) =>
          x.accountId === s.accountId &&
          x.season === r.season.id &&
          x.mode === r.mode,
      );
    assert(row);
    assert.deepEqual(
      { rating: row.rating, games: row.games, wins: row.wins },
      {
        rating: s.rating + (i === g.winner ? s.win : s.loss),
        games: s.games + 1,
        wins: s.wins + (i === g.winner ? 1 : 0),
      },
    );
  }
  assert(data.result);
  assert(!data.result.result.includes("accountId"));
  assert(!data.result.result.includes("token"));
}
function privateView(g: View) {
  assert(g.ranked);
  assert(!JSON.stringify(g.ranked).includes("accountId"));
  assert(!JSON.stringify(g.ranked).includes("token"));
  if (g.phase !== "finished") {
    assert.equal(g.bank, null);
    assert.equal(g.statistics, null);
    assert(
      g.players.every((p, i) => !("id" in p) && !!p.hand === (i === g.me)),
    );
    assert(
      g.ranked.players.every(
        (p) =>
          p.games >= 10 ||
          [p.rating, p.after, p.change, p.win, p.loss, p.division].every(
            (v) => v === null,
          ),
      ),
    );
  }
}
// A player does not know the bank. Optimistic requests may be refused normally;
// fallback choices use that refusal and the same private player projection.
function optimistic(g: View): View {
  return {
    ...g,
    bank:
      g.bank ??
      (Object.fromEntries(RESOURCES.map((r) => [r, 19])) as View["bank"]),
  };
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
async function ownedMove(session: Session, mine: View, rush = false) {
  const visible = optimistic(mine);
  const actions =
    mine.mode === "citiesKnights"
      ? citiesCandidates(visible)
      : ([
          rush ? chooseRushMove(visible) : chooseMove(proxy(visible), mine.me),
        ].filter(Boolean) as Action[]);
  if (mine.mode === "citiesKnights" && mine.cities?.choice?.kind === "aqueduct")
    actions.push(
      ...RESOURCES.map((resource) => ({
        type: "citiesChoice" as const,
        resource,
      })),
    );
  const rejected: string[] = [];
  for (const action of actions) {
    try {
      return {
        game: await session.move(mine.code, action, moveContext(mine)),
        action,
      };
    } catch (e) {
      if (!(e instanceof assert.AssertionError) || e.actual !== 400) throw e;
      if (/turn has changed|table changed/.test(e.message))
        return { game: await session.game(mine.code), action: null };
      if (mine.mode === "citiesKnights") {
        rejected.push(`${action.type}: ${e.message}`);
        continue;
      }
      if (
        ["bankTrade", "plenty", "citiesChoice"].includes(action.type) &&
        /bank|available|enough|resource/i.test(e.message)
      ) {
        const copy = optimistic(mine);
        copy.bank = emptyHand();
        const alternative = rush
          ? chooseRushMove(copy)
          : chooseMove(proxy(copy), mine.me);
        if (alternative)
          return {
            game: await session.move(mine.code, alternative, moveContext(mine)),
            action: alternative,
          };
        return { game: mine, action: null };
      }
      throw e;
    }
  }
  if (mine.mode === "citiesKnights")
    throw Error(
      `No legal projected candidate in ${mine.phase}: ${rejected.join("; ")}`,
    );
  return { game: mine, action: null };
}
async function allocation(queue: RankedQueue) {
  const joining = seats.slice(0, RANKED_QUEUES[queue].players);
  for (const s of joining) await s.queue(queue);
  let status = await joining[0].request<MatchmakingStatus>("/api/matchmaking");
  const deadline = Date.now() + 90000;
  while (status.status === "waiting" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    for (const session of joining) {
      const own = await session.request<MatchmakingStatus>("/api/matchmaking");
      if (own.status === "waiting")
        await session.request("/api/matchmaking", {
          op: "heartbeat",
          ticket: own.ticket,
        });
    }
    status = await joining[0].request<MatchmakingStatus>("/api/matchmaking");
  }
  assert.equal(status.status, "matched");
  if (status.status !== "matched") throw Error();
  const assigned = await Promise.all(
    joining.map(async (session) => ({
      session,
      game: await session.game(status.code),
    })),
  );
  assert.equal(new Set(assigned.map((a) => a.game.me)).size, joining.length);
  assert(assigned.every((a) => a.game.me >= 0));
  assigned.sort((a, b) => a.game.me - b.game.me);
  const humans = assigned.map((a) => a.session),
    g = assigned[0].game;
  assert.equal(g.ranked?.mode, RANKED_QUEUES[queue].rankedMode);
  assert.equal(g.turnSeconds, RANKED_QUEUES[queue].seconds);
  assert(g.phase.startsWith("setup"));
  privateView(g);
  return { humans, game: g };
}
for (const queue of [
  "rankedDuel",
  "rankedBase4",
  "rankedCities4",
  "rankedRush4",
] as const)
  for (let round = 1; round <= 3; round++) {
    const { humans, game } = await allocation(queue);
    let g = game,
      moves = 0,
      cycles = 0,
      earlyRolls = 0,
      refused = 0;
    const counts: Record<string, number> = {};
    while (g.phase !== "finished" && cycles++ < 12000) {
      if (queue === "rankedRush4") {
        let changed = false;
        for (let p = 0; p < humans.length && g.phase !== "finished"; p++) {
          const mine = await humans[p].game(g.code);
          privateView(mine);
          const result = await ownedMove(humans[p], mine, true);
          g = result.game;
          if (result.action) {
            moves++;
            changed = true;
            counts[result.action.type] = (counts[result.action.type] ?? 0) + 1;
          }
        }
        if (
          g.phase !== "finished" &&
          !changed &&
          !g.phase.startsWith("setup")
        ) {
          const before = g.turn;
          for (let p = 0; p < humans.length; p++) {
            const mine = await humans[p].game(g.code);
            if (mine.phase === "action" && !mine.rush!.votes.includes(p)) {
              try {
                g = await humans[p].move(
                  g.code,
                  { type: "voteRoll" },
                  moveContext(mine),
                );
                moves++;
              } catch (e) {
                if (
                  !(e instanceof assert.AssertionError) ||
                  e.actual !== 400 ||
                  !/turn has changed|table changed|already recorded/.test(
                    e.message,
                  )
                )
                  throw e;
              }
            }
          }
          g = await humans[0].game(g.code);
          if (g.turn > before) earlyRolls++;
        }
      } else {
        const p =
          queue === "rankedCities4"
            ? citiesMatchActor(g)
            : g.phase === "discard"
              ? Number(Object.keys(g.discards)[0])
              : actor(g);
        const mine = await humans[p].game(g.code);
        g = mine;
        if (g.phase === "finished") break;
        const current =
          queue === "rankedCities4"
            ? citiesMatchActor(g)
            : g.phase === "discard"
              ? Number(Object.keys(g.discards)[0])
              : actor(g);
        if (current !== p) continue;
        privateView(mine);
        const result = await ownedMove(humans[p], mine);
        g = result.game;
        if (result.action) {
          moves++;
          counts[result.action.type] = (counts[result.action.type] ?? 0) + 1;
        } else refused++;
      }
      const stored = await raw(g.code);
      await assertConvexReplay(stored);
      if (stored.mode === "citiesKnights") assertCitiesInventory(stored);
      else
        for (const r of RESOURCES)
          assert.equal(
            stored.bank[r] +
              stored.players.reduce((sum, p) => sum + p.hand[r], 0),
            19,
          );
      if (cycles % 200 === 0)
        console.log(
          JSON.stringify({
            queue,
            round,
            cycles,
            moves,
            rolls: g.turn,
            score: g.players.map((p) => p.score),
          }),
        );
    }
    assert.equal(
      g.phase,
      "finished",
      `${queue} ${moves} actions ${cycles} cycles`,
    );
    assert(g.winner !== null && g.players[g.winner].score >= g.target);
    const final = await raw(g.code);
    await assertSettlement(final);
    await assertFinishedReplay(origin, humans[0].cookie, final);
    const archive = await guest.request<{
      game: View;
    }>("/api/matches?match=" + final.statistics!.id);
    assert.deepEqual(archive.game.ranked, g.ranked);
    assert(!JSON.stringify(archive.game).includes("accountId"));
    for (const s of humans)
      assert.equal(
        (await s.request<MatchmakingStatus>("/api/matchmaking")).status,
        "idle",
      );
    report.push({
      queue,
      round,
      code: g.code,
      matchId: final.statistics!.id,
      target: g.target,
      score: g.players[g.winner!].score,
      moves,
      cycles,
      earlyRolls,
      refused,
      rolls: Object.values(g.rollCounts).reduce((n, v) => n + v, 0),
      counts,
    });
    writeFileSync(
      ".sites-runtime/ranked-results.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify({ passed: true, ...report.at(-1) }));
  }
console.log(
  "PASS: twelve natural Ranked games, fixed deltas, placements privacy, inventories, archives and replays",
);
// Seven ordinary Duel resignations complete each player's ten placements.
for (let i = 0; i < 7; i++) {
  const { humans, game } = await allocation("rankedDuel"),
    s = humans[i % 2],
    nonce = crypto.randomUUID();
  const results = await Promise.all([
    s.move(game.code, { type: "resign" }, undefined, nonce),
    s.move(game.code, { type: "resign" }, undefined, nonce),
  ]);
  assert(results.every((g) => g.phase === "finished"));
  await assertSettlement(await raw(game.code));
}
let board = await guest.request<LeaderboardData>("/api/leaderboards?mode=duel");
assert(
  seats
    .slice(0, 2)
    .every((s) =>
      board.rows.some(
        (p) => p.username === s.username && p.games === 10 && p.rating !== null,
      ),
    ),
);
assert.equal(board.next, null);
assert(board.rows.every((p) => p.rank !== null));
const literal = await guest.request<LeaderboardData>(
  "/api/leaderboards?mode=duel&search=" + encodeURIComponent(seats[0].username),
);
assert.deepEqual(
  literal.rows.map((p) => p.username),
  [seats[0].username],
);
const wild = await guest.request<LeaderboardData>(
  "/api/leaderboards?mode=duel&search=%25",
);
assert.equal(wild.total, 0);
await guest.request(
  "/api/leaderboards?profile=unknown_rank_user",
  undefined,
  404,
);
const own = await seats[0].request<LeaderboardData>(
  "/api/leaderboards?mode=duel&friends=1",
);
assert.deepEqual(
  own.rows.map((p) => p.username),
  [seats[0].username],
);
await seats[0].request("/api/social", {
  op: "request",
  username: seats[1].username,
});
const social = await seats[1].request<{
  incoming: {
    id: string;
  }[];
}>("/api/social");
await seats[1].request("/api/social", {
  op: "accept",
  id: social.incoming[0].id,
});
assert.equal(
  (
    await seats[0].request<LeaderboardData>(
      "/api/leaderboards?mode=duel&friends=1",
    )
  ).rows.length,
  2,
);
await seats[0].request("/api/social", {
  op: "block",
  username: seats[1].username,
});
assert.equal(
  (
    await seats[0].request<LeaderboardData>(
      "/api/leaderboards?mode=duel&friends=1",
    )
  ).rows.length,
  1,
);
const { humans, game } = await allocation("rankedDuel");
assert(
  game.ranked?.players.every(
    (p) => p.win !== null && p.loss !== null && p.rating !== null,
  ),
);
const finished = await humans[1].move(game.code, { type: "resign" });
assert(finished.ranked?.players.every((p) => p.change !== null));
await assertSettlement(await raw(game.code));
const old = await humans[0].profile();
const rematch = await humans[0].room({ op: "rematch", code: game.code });
assert(!rematch.ranked && !rematch.matchmaking);
await humans[0].move(game.code, { type: "ready" });
await humans[1].move(game.code, { type: "ready" });
await humans[0].move(game.code, { type: "start" });
await humans[1].move(game.code, { type: "resign" });
assert.deepEqual(await humans[0].profile(), old);
writeFileSync(
  ".sites-runtime/ranked-browser-accounts.json",
  JSON.stringify(
    seats.map((s) => ({ username: s.username, password: s.password })),
    null,
    2,
  ),
);
console.log(
  "PASS: ten placements, public leaderboard/search/profiles, friends/block filters, rated deltas, concurrent duplicate finish and unranked rematches",
);
