// Test drivers stay outside the application. Only normal HTTP actions mutate games.
// Trusted storage reads verify inventories and persisted state, not move choice.
import assert from "node:assert/strict";
import { loadRoom } from "../lib/room-store";
import { api, storageClient } from "../lib/convex-client";
import { assertConvexReplay } from "./convex-replay-assertions";
import { writeFileSync } from "node:fs";
import {
  assertGoldRushInventory,
  assertGoldRushProjection,
} from "./gold-rush-assertions";
import {
  assertBlackForestInventory,
  assertBlackForestProjection,
} from "./black-forest-assertions";
import { RESOURCES, emptyHand } from "../lib/board";
import {
  Action,
  Game,
  View,
  actor,
  moveContext,
  points,
  roadLength,
} from "../lib/game";
import { chooseMove } from "./autoplay";
import { pauseMatchProof } from "./pause-match-proof";
import { publicLeader } from "../lib/game-display";
import type { PlayerStatistics } from "../lib/match-statistics";
import { assertFinishedReplay } from "./replay-assertions";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
const url = new URL(origin);
assert(
  url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname),
  "Local verification only.",
);
const rounds = Number(process.env.TEST_ROUNDS ?? 3);
assert(Number.isInteger(rounds) && rounds >= 2 && rounds <= 10);
const sizes = process.argv.slice(2).map(Number);
assert(sizes.every((n) => Number.isInteger(n) && n >= 1 && n <= 12));
const capacities = process.env.TEST_BASE_CAPACITIES?.split(",").map(Number);
if (capacities) {
  assert.equal(capacities.length, sizes.length);
  assert(capacities.every((n) => Number.isInteger(n) && n >= 2 && n <= 12));
}
async function persisted(code: string): Promise<Game> {
  const g = await loadRoom(code);
  assert(g);
  return g;
}
class Session {
  cookie = "";
  cookies(response: Response) {
    const jar = new Map(
      this.cookie
        .split("; ")
        .filter(Boolean)
        .map((pair) => {
          const i = pair.indexOf("=");
          return [pair.slice(0, i), pair.slice(i + 1)] as [string, string];
        }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0],
        i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    this.cookie = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  }
  async account(body?: Record<string, unknown>) {
    const response = await fetch(origin + "/api/accounts", {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: this.cookie,
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    this.cookies(response);
    const data = (await response.json()) as {
      error?: string;
      stats: {
        games: number;
        wins: number;
        trackedGames: number;
      };
    };
    assert(response.status === 200 || response.status === 201, data.error);
    return data;
  }
  async request(body: Record<string, unknown> | null, code?: string) {
    const retryable =
      body === null || (body.op === "action" && typeof body.nonce === "string");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(
          `${origin}/api/rooms${body ? "" : code ? `?code=${code}` : ""}`,
          {
            method: body ? "POST" : "GET",
            headers: {
              ...(this.cookie ? { Cookie: this.cookie } : {}),
              ...(body
                ? { "Content-Type": "application/json", Origin: origin }
                : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          },
        );
        this.cookies(response);
        if (
          !(response.headers.get("content-type") ?? "").includes(
            "application/json",
          )
        )
          throw new TypeError(
            `Preview returned non-JSON HTTP ${response.status}`,
          );
        return {
          status: response.status,
          ...((await response.json()) as {
            game: View;
            error?: string;
            rooms: {
              code: string;
            }[];
            games: {
              code: string;
            }[];
          }),
        };
      } catch (error) {
        if (!retryable || attempt === 2 || !(error instanceof TypeError))
          throw error;
        console.log(
          `Retrying preview transport with the original request (${attempt + 1}/2).`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, 150 * (attempt + 1)),
        );
      }
    }
    throw new Error("Preview transport did not recover");
  }
  async move(
    code: string,
    action: Action,
    context?: string,
    nonce = crypto.randomUUID(),
  ) {
    const r = await this.request({
      op: "action",
      code,
      action,
      nonce,
      ...(context ? { context } : {}),
    });
    assert.equal(r.status, 200, `${code} ${action.type}: ${r.error}`);
    return r.game;
  }
}
async function privateView(g: View, seat: number) {
  const storedView = await persisted(g.code);
  assertGoldRushProjection(g);
  assertBlackForestProjection(g);
  if (g.phase !== "finished")
    assert.equal(
      g.statistics,
      null,
      "Detailed statistics stay private while playing.",
    );
  assert.equal(g.me, seat);
  assert(!("deck" in g) && !("diceState" in g) && !("receipts" in g));
  assert(!("specialRequests" in g) && !("specialQueue" in g));
  assert.equal(
    g.specialRequested,
    seat >= 0 && storedView.specialRequests.includes(seat),
  );
  assert(g.players.every((p) => !("id" in p)));
  g.players.forEach((p, i) => {
    assert.equal(
      p.publicScore,
      points(storedView, i, false),
      "Crown inputs include public points only",
    );
    assert.equal(!!p.hand, i === seat);
    if (g.phase !== "finished") assert.equal(!!p.dev, i === seat);
  });
  const leaders = g.players
    .map((p, i) =>
      p.publicScore === Math.max(...g.players.map((p) => p.publicScore))
        ? i
        : -1,
    )
    .filter((i) => i >= 0);
  assert.equal(
    publicLeader(g),
    g.phase.startsWith("setup") || g.phase === "lobby" || leaders.length !== 1
      ? null
      : leaders[0],
  );
}
async function inventory(g: Game, n: number) {
  assertGoldRushInventory(g);
  assertBlackForestInventory(g);
  await assertConvexReplay(g);
  assert(g.statistics?.complete && g.statistics.detailed);
  for (let seat = 0; seat < n; seat++) {
    const stats: PlayerStatistics = g.statistics.players[seat];
    assert.equal(
      stats.resources.totalResourceIncome -
        stats.resources.totalResourceLoss -
        stats.activity.resourcesUsed,
      Object.values(g.players[seat].hand).reduce(
        (sum, amount) => sum + amount,
        0,
      ),
      "Recorded income, losses and construction reconcile with the actual hand.",
    );
    assert.equal(
      stats.activity.devCardsBought - stats.activity.devCardsUsed,
      g.players[seat].dev.length,
    );
    assert.equal(
      stats.resources.totalResourceScore,
      stats.resources.totalResourceIncome - stats.resources.totalResourceLoss,
    );
  }
  const supply = g.boardPlayers <= 4 ? 19 : g.boardPlayers <= 6 ? 24 : g.boardPlayers <= 8 ? 29 : 39;
  for (const r of RESOURCES) {
    assert.equal(
      g.bank[r] + g.players.reduce((sum, p) => sum + p.hand[r], 0),
      supply,
      `${r} inventory`,
    );
    assert(g.bank[r] >= 0 && Number.isInteger(g.bank[r]));
    assert(
      g.players.every((p) => p.hand[r] >= 0 && Number.isInteger(p.hand[r])),
    );
  }
  for (let p = 0; p < n; p++) {
    const buildings = g.board.vertices.filter((v) => v.owner === p);
    assert(buildings.filter((v) => v.city).length <= 4);
    assert(buildings.filter((v) => !v.city).length <= 5);
    assert(g.board.edges.filter((e) => e.owner === p).length <= 15);
    assert(
      g.board.edges
        .filter((e) => e.owner === p)
        .every((e) =>
          e.tiles.some((id) => g.board.tiles[id].resource !== "sea"),
        ),
      "Roads stay on land or shores",
    );
    assert(
      buildings.every((v) =>
        v.tiles.some((id) => g.board.tiles[id].resource !== "sea"),
      ),
      "Buildings stay on land",
    );
    for (const v of buildings)
      assert(
        v.edges.every((id) => {
          const edge = g.board.edges[id];
          return (
            g.board.vertices[edge.a === v.id ? edge.b : edge.a].owner === null
          );
        }),
        "Settlement distance rule",
      );
  }
  if (g.longest !== null) assert(roadLength(g, g.longest) >= 5);
  if (g.army !== null) assert(g.players[g.army].knights >= 3);
}
function strategy(g: View): Game {
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
const report: Record<string, unknown>[] = [];
for (const [caseIndex, n] of (sizes.length
  ? sizes
  : [1, 2, 3, 4, 5, 6, 7, 8]
).entries()) {
  const mode =
    n === 1
      ? "solo"
      : n === 2 && process.env.TEST_TWO_PLAYER_BASE !== "1"
        ? "duel"
        : "base";
  const capacity =
    mode === "base"
      ? Number(capacities?.[caseIndex] ?? process.env.TEST_BASE_CAPACITY ?? n)
      : n;
  assert(Number.isInteger(capacity) && capacity >= n && capacity <= 12);
  const seats = Array.from({ length: n }, () => new Session()),
    spectator = new Session();
  const made = await seats[0].request({
    op: "create",
    name: `Base QA ${n}`,
    avatar: "player",
    capacity,
    mode,
    ...(process.env.TEST_BASE_MAP ? { map: process.env.TEST_BASE_MAP } : {}),
    public: false,
  });
  assert.equal(made.status, 200, made.error);
  const code = made.game.code;
  if (process.env.TEST_TURN_SECONDS !== undefined) {
    const turnSeconds = Number(process.env.TEST_TURN_SECONDS);
    assert(Number.isInteger(turnSeconds));
    await seats[0].move(code, { type: "settings", turnSeconds });
  }
  let alternateCookie = "",
    accountWins = 0;
  if (process.env.TEST_ACCOUNT_HOST === "1") {
    const username = `count_${crypto.randomUUID().slice(0, 8)}_${n}`,
      password = `Natural test passphrase ${crypto.randomUUID()}`;
    await seats[0].account({
      op: "register",
      username,
      password,
      displayName: `Account QA ${n}`,
    });
    const secondBrowser = new Session();
    await secondBrowser.account({ op: "login", username, password });
    alternateCookie = secondBrowser.cookie;
    assert.equal((await secondBrowser.request(null, code)).game.me, 0);
  }
  for (let p = 1; p < n; p++) {
    assert.equal(
      (
        await seats[p].request({
          op: "join",
          code,
          name: `Seat ${p}`,
          avatar: "player",
        })
      ).status,
      200,
    );
  }
  for (let p = 1; p < n; p++) await seats[p].move(code, { type: "ready" });
  let previousBoard = "";
  for (let round = 1; round <= rounds; round++) {
    if (round > 1)
      for (let p = 1; p < n; p++) await seats[p].move(code, { type: "ready" });
    let g = await seats[0].move(code, { type: "start" });
    const boardSignature = JSON.stringify(
      g.board.tiles.map((t) => [t.resource, t.number]),
    );
    assert.notEqual(
      boardSignature,
      previousBoard,
      "Rematch must generate a fresh board",
    );
    previousBoard = boardSignature;
    assert.equal(g.boardPlayers, n);
    const observerToken = crypto.randomUUID();
    const announce = async () => {
      const response = await fetch(`${origin}/api/spectators`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Cookie: spectator.cookie,
        },
        body: JSON.stringify({
          op: "watch",
          code,
          created: g.created,
          token: observerToken,
          name: "Natural game observer",
        }),
      });
      spectator.cookies(response);
      assert.equal(response.status, 200, await response.clone().text());
    };
    await announce();
    const roster = async () => {
      const response = await fetch(`${origin}/api/spectators?code=${code}`);
      assert.equal(response.status, 200);
      return (await response.json()) as {
        count: number;
        spectators: {
          name: string;
        }[];
      };
    };
    assert.equal((await roster()).count, 1);
    assert.equal(g.target, mode === "duel" ? 15 : 10);
    assert.equal(g.mode, mode);
    assert.equal(g.capacity, capacity);
    assert.equal(g.map, process.env.TEST_BASE_MAP ?? "base");
    assert.equal(g.players.length, n);
    assert.equal(
      g.board.tiles.length,
      g.map === "lakes"
        ? 49
        : g.map === "diamond"
          ? 25
          : g.map === "pond"
            ? 28
            : g.map === "gear"
              ? 51
              : g.map === "twirl"
                ? 46
                : g.map === "goldRush"
                  ? 31
                  : g.map === "blackForest"
                    ? 61
                    : n <= 4
                      ? 19
                      : n <= 6
                        ? 30
                        : 37,
    );
    assert.equal(g.diceMode, mode === "duel" ? "balanced" : "random");
    if (n === 1) {
      assert.equal(g.mode, "solo");
      assert.equal(g.turnSeconds, Number(process.env.TEST_TURN_SECONDS ?? 0));
      const joinDenied = await spectator.request({
        op: "join",
        code,
        name: "Extra player",
      });
      assert.equal(joinDenied.status, 400);
    }
    let steps = 0,
      reconnects = 0,
      duplicates = 0,
      exchanges = 0;
    const counts: Record<string, number> = {},
      setup: number[] = [];
    const update = async (
      p: number,
      a: Action,
      context?: string,
      nonce = crypto.randomUUID(),
    ) => {
      const result = await seats[p].move(code, a, context, nonce);
      counts[a.type] = (counts[a.type] ?? 0) + 1;
      steps++;
      const stored = await persisted(code);
      assert.equal(stored.revision, result.revision);
      await inventory(stored, n);
      return result;
    };
    if (process.env.TEST_PAUSE === "1")
      g = await pauseMatchProof(g, (p, a) => update(p, a));
    while (g.phase !== "finished" && steps < 12000) {
      if (g.boardPlayers > 4 && g.phase === "action") {
        for (let seat = 0; seat < n; seat++) {
          if (seat === g.active) continue;
          const candidate = (await seats[seat].request(null, code)).game;
          if (candidate.specialRequested) continue;
          const special = {
            ...strategy(candidate),
            phase: "special" as const,
            specialPlayer: seat,
          };
          const move = chooseMove(special, seat);
          if (move && move.type !== "pass") {
            g = await update(seat, { type: "specialBuild", requested: true });
            assert(g.specialRequested);
          }
        }
      }
      const p =
        g.phase === "discard"
          ? Number(Object.keys(g.discards)[0])
          : g.phase === "gold"
            ? Number(Object.keys(g.goldClaims)[0])
            : actor(g as unknown as Game);
      let mine = (await seats[p].request(null, code)).game;
      await privateView(mine, p);
      if (mine.phase === "setupSettlement") setup.push(p);
      // Complete two genuine exchanges per match, using each participant's own view.
      if (mine.phase === "action" && exchanges < 2 && n > 2) {
        for (let other = 0; other < n; other++) {
          if (other === p) continue;
          const theirs = (await seats[other].request(null, code)).game;
          const from = RESOURCES.find(
            (r) =>
              mine.players[p].hand![r] > 0 &&
              RESOURCES.some(
                (w) => w !== r && theirs.players[other].hand![w] > 0,
              ),
          );
          const to =
            from &&
            RESOURCES.find(
              (r) => r !== from && theirs.players[other].hand![r] > 0,
            );
          if (!from || !to) continue;
          const give = { ...emptyHand(), [from]: 1 },
            want = { ...emptyHand(), [to]: 1 };
          const offered = await update(
            p,
            { type: "offer", give, want, targets: [other] },
            moveContext(mine),
          );
          const id = offered.offers.at(-1)!.id;
          await update(other, { type: "accept", id });
          mine = await update(p, { type: "completeTrade", id, to: other });
          exchanges++;
          break;
        }
      }
      const action = chooseMove(strategy(mine), p);
      assert(action, `No move at ${mine.phase}`);
      const nonce = crypto.randomUUID();
      g = await update(p, action, moveContext(mine), nonce);
      if (steps === 1 || steps % 100 === 0) {
        if (p === 0 && alternateCookie) {
          const previousCookie = seats[0].cookie;
          seats[0].cookie = alternateCookie;
          alternateCookie = previousCookie;
        }
        const again = await seats[p].move(code, action, undefined, nonce);
        assert.equal(again.revision, g.revision);
        assert.deepEqual(again.board, g.board);
        duplicates++;
        const reconnected = await seats[p].request({
          op: "join",
          code,
          name: "Ignored rename",
        });
        assert.equal(reconnected.status, 200);
        assert.equal(reconnected.game.me, p);
        assert.equal(reconnected.game.players[p].name, mine.players[p].name);
        assert.deepEqual(reconnected.game.players[p].hand, g.players[p].hand);
        reconnects++;
        const watch = (await spectator.request(null, code)).game;
        await privateView(watch, -1);
        assert.equal(watch.revision, g.revision);
        await announce();
        assert.equal((await roster()).count, 1);
      }
      if (steps % 200 === 0)
        console.log(
          JSON.stringify({
            progress: true,
            players: n,
            round,
            actions: steps,
            turn: g.turn,
          }),
        );
    }
    assert.equal(g.phase, "finished", `${n} seats round ${round} stalled`);
    assert(g.winner !== null);
    assert(g.players[g.winner].score >= g.target);
    const final = await persisted(code);
    if (alternateCookie) {
      if (g.winner === 0) accountWins++;
      const overview = await seats[0].account();
      assert.equal(overview.stats.games, round);
      assert.equal(overview.stats.trackedGames, round);
      assert.equal(overview.stats.wins, accountWins);
    }
    assert.equal(
      final.active,
      final.winner,
      "Normal wins happen on the winner's own turn.",
    );
    assert(points(final, final.winner!) >= final.target);
    assert.deepEqual(setup, [
      ...Array.from({ length: n }, (_, i) => i),
      ...Array.from({ length: n }, (_, i) => n - 1 - i),
    ]);
    if (n > 2)
      assert.equal(exchanges, 2, "Two real player exchanges per match.");
    if (n > 4) {
      assert(
        (counts.pass ?? 0) > 0,
        "Extended tables exercise special building phases.",
      );
      assert(
        (counts.specialBuild ?? 0) > 0,
        "Players explicitly request special building phases.",
      );
    }
    for (let p = 0; p < n; p++) {
      const finished = (await seats[p].request(null, code)).game;
      await privateView(finished, p);
      assert.equal(finished.phase, "finished");
      assert.equal(finished.winner, g.winner);
      assert.deepEqual(
        finished.players.map((pl) => pl.score),
        g.players.map((pl) => pl.score),
      );
    }
    const record = {
      matchId: final.statistics!.id,
      players: n,
      round,
      mode: g.mode,
      map: g.map,
      code,
      actions: steps,
      turns: g.turn,
      rolls: Object.values(g.rollCounts).reduce((sum, n) => sum + n, 0),
      winner: g.winner,
      score: g.players[g.winner].score,
      target: g.target,
      capacity: g.capacity,
      turnSeconds: g.turnSeconds,
      exchanges,
      reconnects,
      duplicates,
      counts,
      accountHost: !!alternateCookie,
    };
    report.push(record);
    writeFileSync(
      ".sites-runtime/player-count-results.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify({ passed: true, ...record }));
    const matchId = final.statistics!.id;
    await assertFinishedReplay(origin, seats[0].cookie, final);
    const sharedResponse = await fetch(
      `${origin}/api/matches?match=${matchId}`,
    );
    assert.equal(sharedResponse.status, 200);
    const saved = (await sharedResponse.json()) as {
      game: View;
      summary: {
        id: string;
        winner: number;
      };
    };
    assert.equal(saved.summary.id, matchId);
    assert.equal(saved.summary.winner, g.winner);
    assert.deepEqual(saved.game.statistics, g.statistics);
    assert(saved.game.players.every((pl) => !("id" in pl) && !pl.hand));
    assert(!("deck" in saved.game) && !("diceState" in saved.game));
    for (const session of seats) {
      const history = await fetch(`${origin}/api/matches`, {
        headers: { Cookie: session.cookie },
      });
      assert.equal(history.status, 200);
      const data = (await history.json()) as {
        matches: {
          id: string;
        }[];
      };
      assert(data.matches.some((m) => m.id === matchId));
    }
    const outsider = await fetch(`${origin}/api/matches`);
    assert.equal(outsider.status, 200);
    assert.deepEqual(
      (
        (await outsider.json()) as {
          matches: unknown[];
        }
      ).matches,
      [],
    );
    const rematch = await seats[0].request({ op: "rematch", code });
    assert.equal(rematch.status, 200, rematch.error);
    assert.equal(rematch.game.phase, "lobby");
    assert.equal(rematch.game.players.length, n);
    assert.deepEqual(
      rematch.game.players.map((p) => p.avatar),
      g.players.map((p) => p.avatar),
    );
    assert(rematch.game.players.every((pl) => pl.score === 0));
    assert.equal(rematch.game.target, g.target);
    assert.equal(rematch.game.mode, g.mode);
    assert.equal(rematch.game.capacity, capacity);
    assert.equal(rematch.game.map, g.map);
    assertGoldRushProjection(rematch.game);
    assertBlackForestProjection(rematch.game);
    if (g.map === "goldRush") {
      assert.equal(rematch.game.board.tiles.filter((t) => t.fog).length, 7);
      assertGoldRushInventory(await persisted(code));
    }
    if (g.map === "blackForest") {
      assert.equal(rematch.game.board.tiles.filter((t) => t.fog).length, 30);
      assertBlackForestInventory(await persisted(code));
    }
    assert.equal(rematch.game.diceMode, g.diceMode);
    assert.equal(rematch.game.statistics, null);
    assert.equal(
      (await roster()).count,
      0,
      "A rematch invalidates the previous spectator generation.",
    );
    const staleWatch = await fetch(`${origin}/api/spectators`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        Cookie: spectator.cookie,
      },
      body: JSON.stringify({
        op: "watch",
        code,
        created: g.created,
        token: observerToken,
      }),
    });
    assert.equal(staleWatch.status, 409);
    const retained = await fetch(`${origin}/api/matches?match=${matchId}`);
    assert.equal(retained.status, 200);
    assert.deepEqual(
      (
        (await retained.json()) as {
          game: View;
        }
      ).game.statistics,
      saved.game.statistics,
    );
  }
  for (let p = n - 1; p >= 0; p--)
    assert.equal((await seats[p].request({ op: "leave", code })).status, 200);
}
console.log(
  `PASS: ${report.length} natural HTTP matches to the default victory target; all tested player counts, persistent rematches, private views, inventories, trades and reconnects.`,
);
