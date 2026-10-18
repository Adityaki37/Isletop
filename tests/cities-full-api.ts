import {
  scenarioTarget,
  SEAFARERS_SCENARIOS,
  SeafarersScenario,
} from "../lib/scenarios";
// Local-only natural matches through normal create/join/start operations.
// SQL is read only: no state updates, hand/card grants or forced dice.
import assert from "node:assert/strict";
import { loadRoom } from "../lib/room-store";
import { api, storageClient } from "../lib/convex-client";
import { assertConvexReplay } from "./convex-replay-assertions";
import { Game, View, Action, moveContext, points } from "../lib/game";
import { citiesMatchActor, chooseLegalCitiesMove } from "./cities-match-driver";
import { assertCitiesInventory } from "./cities-match-inventory";
import { assertStatistics } from "./statistics-assertions";
import {
  assertBlackForestInventory,
  assertBlackForestProjection,
} from "./black-forest-assertions";
import {
  assertGoldRushInventory,
  assertGoldRushProjection,
} from "./gold-rush-assertions";
import { pauseMatchProof } from "./pause-match-proof";
import { assertFinishedReplay } from "./replay-assertions";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173",
  url = new URL(origin);
const combined = process.env.TEST_COMBINED === "1";
const scenario = (process.env.TEST_SCENARIO ??
  "newShores") as SeafarersScenario;
assert(SEAFARERS_SCENARIOS.includes(scenario));
const target = combined ? scenarioTarget(scenario, true) : 13;
const selectedMap = process.env.TEST_BASE_MAP ?? "base";
assert(
  [
    "base",
    "baseRandom",
    "lakes",
    "diamond",
    "pond",
    "gear",
    "twirl",
    "goldRush",
    "blackForest",
  ].includes(selectedMap),
);
assert(
  url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    ["5173", "5174", "5175"].includes(url.port),
  "Local preview only",
);
class Session {
  cookie = "";
  async request(body: Record<string, unknown> | null, code?: string) {
    const retryable =
      !body || (body.op === "action" && typeof body.nonce === "string");
    for (let attempt = 0; attempt < (retryable ? 3 : 1); attempt++) {
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
        const cookie = response.headers.get("set-cookie");
        if (cookie) this.cookie = cookie.split(";")[0];
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
          }),
        };
      } catch (error) {
        if (!retryable || attempt === 2 || !(error instanceof TypeError))
          throw error;
        transportRetries++;
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
    a: Action,
    context?: string,
    nonce = crypto.randomUUID(),
  ) {
    const r = await this.request({
      op: "action",
      code,
      action: a,
      nonce,
      ...(context ? { context } : {}),
    });
    assert.equal(r.status, 200, `${a.type}: ${r.error}`);
    return r.game;
  }
}
async function raw(code: string): Promise<Game> {
  const g = await loadRoom(code);
  assert(g);
  assertGoldRushInventory(g);
  assertBlackForestInventory(g);
  return g;
}
function privateProjection(g: View, seat: number) {
  assertGoldRushProjection(g);
  assertBlackForestProjection(g);
  assert.equal(g.me, seat);
  for (let p = 0; p < g.players.length; p++) {
    assert.equal(!!g.players[p].hand, p === seat);
    assert.equal(!!g.cities!.players[p].progress, p === seat);
  }
  assert(!("decks" in g.cities!));
  assert(!("citiesFlow" in g));
  if (g.cities!.peek) assert.equal(g.cities!.choice?.player, seat);
  if (g.phase !== "finished") assert.equal(g.statistics, null);
}
let transportRetries = 0;
const sizes = (
  process.argv.length > 2 ? process.argv.slice(2).map(Number) : [3, 4, 6]
).filter((n) => !["diamond", "pond"].includes(selectedMap) || n <= 4);
assert(sizes.every((n) => [3, 4, 5, 6].includes(n)));
for (const n of sizes) {
  const seats = Array.from({ length: n }, () => new Session()),
    spectator = new Session();
  const created = await seats[0].request({
    op: "create",
    name: "Cities Full Proof",
    mode: combined ? "seafarersCitiesKnights" : "citiesKnights",
    scenario,
    map: selectedMap,
    capacity: Number(process.env.TEST_CITIES_CAPACITY ?? n),
    public: false,
  });
  assert.equal(created.status, 200);
  assert.equal(created.game.map, selectedMap);
  const code = created.game.code;
  for (let p = 1; p < n; p++) {
    const r = await seats[p].request({
      op: "join",
      code,
      name: `Full seat ${p}`,
    });
    assert.equal(r.status, 200);
  }
  for (let p = 1; p < n; p++) await seats[p].move(code, { type: "ready" });
  console.log(
    JSON.stringify({
      proof: "match-start",
      map: selectedMap,
      players: n,
      combined,
      scenario,
      target,
      code,
    }),
  );
  let g = await seats[0].move(code, { type: "start" });
  assert.equal(g.boardPlayers, n);
  assert.equal(g.target, target);
  assert.equal(g.turnSeconds, 60);
  const counts: Record<string, number> = {},
    progress: Record<string, number> = {},
    choices: Record<string, number> = {};
  let moves = 0,
    reconnects = 0,
    receipts = 0;
  const pauseProof = async () => {
    g = await pauseMatchProof(g, async (p, a) => {
      const result = await seats[p].move(code, a);
      counts[a.type] = (counts[a.type] ?? 0) + 1;
      moves++;
      assertCitiesInventory(await raw(code));
      return result;
    });
  };
  if (process.env.TEST_PAUSE === "1") await pauseProof();
  let choicePause = false;
  while (g.phase !== "finished" && moves < 12000) {
    if (
      process.env.TEST_PAUSE === "1" &&
      !choicePause &&
      g.phase === "citiesChoice" &&
      g.serverTime > g.created + 16000
    ) {
      await pauseProof();
      choicePause = true;
    }
    // Expanded seats now explicitly opt into the special building phase.
    // Each decision reads only that seat's private request flag.
    const before = await raw(code);
    if (before.boardPlayers > 4 && before.phase === "action") {
      for (let seat = 0; seat < n; seat++) {
        if (seat === before.active) continue;
        const own = (await seats[seat].request(null, code)).game;
        if (!own.specialRequested) {
          await seats[seat].move(code, {
            type: "specialBuild",
            requested: true,
          });
          counts.specialBuild = (counts.specialBuild ?? 0) + 1;
          moves++;
        }
      }
    }
    const actual = await raw(code),
      p = citiesMatchActor(actual),
      mine = (await seats[p].request(null, code)).game;
    if (citiesMatchActor(await raw(code)) !== p) continue;
    privateProjection(mine, p);
    const authoritative = await raw(code),
      a = chooseLegalCitiesMove(authoritative),
      nonce = crypto.randomUUID(),
      context = moveContext(mine);
    assert.deepEqual(mine.players[p].hand, authoritative.players[p].hand);
    counts[a.type] = (counts[a.type] ?? 0) + 1;
    if (authoritative.phase === "citiesChoice") {
      const kind = authoritative.cities!.choices[0].kind;
      choices[kind] = (choices[kind] ?? 0) + 1;
    }
    if (a.type === "progress") {
      const kind = authoritative.cities!.players[p].progress.find(
        (c) => c.id === a.cardId,
      )!.kind;
      progress[kind] = (progress[kind] ?? 0) + 1;
    }
    g = await seats[p].move(code, a, context, nonce);
    moves++;
    const saved = await raw(code);
    assertCitiesInventory(saved);
    assertStatistics(saved);
    await assertConvexReplay(saved);
    assert.equal(g.revision, saved.revision);
    assert.equal(g.target, target);
    if (moves % 43 === 0) {
      const duplicate = await seats[p].move(code, a, context, nonce);
      assert.equal(duplicate.revision, saved.revision);
      assert.deepEqual(await raw(code), saved);
      receipts++;
    }
    if (moves % 71 === 0) {
      const reconnected = new Session();
      reconnected.cookie = seats[p].cookie;
      const again = (await reconnected.request(null, code)).game;
      assert.equal(again.me, p);
      assert.deepEqual(again.players[p].hand, g.players[p].hand);
      assert.deepEqual(
        again.cities!.players[p].progress,
        g.cities!.players[p].progress,
      );
      seats[p] = reconnected;
      reconnects++;
      const watch = (await spectator.request(null, code)).game;
      privateProjection(watch, -1);
      assert.equal(watch.cities!.peek, null);
    }
    if (moves % 200 === 0)
      console.log(
        JSON.stringify({
          players: n,
          moves,
          turn: g.turn,
          scores: g.players.map((p) => p.score),
        }),
      );
  }
  const finished = await raw(code);
  const replay = await assertFinishedReplay(
    origin,
    seats[0].cookie,
    finished,
    true,
  );
  assert.equal(finished.phase, "finished");
  assert.notEqual(finished.winner, null);
  assert.equal(finished.active, finished.winner);
  assert(points(finished, finished.winner!) >= target);
  assert(
    counts.improve > 0 &&
      counts.activateKnight > 0 &&
      counts.bankTrade > 0 &&
      counts.progress > 0,
  );
  assert(reconnects > 0 && receipts > 0);
  if (n > 4) assert(counts.pass > 0);
  console.log(
    JSON.stringify({
      proof: "default-target HTTP match",
      players: n,
      combined,
      scenario,
      map: selectedMap,
      target,
      code,
      moves,
      turns: finished.turn,
      winner: finished.winner,
      score: points(finished, finished.winner!),
      attacks: finished.cities!.attacks,
      reconnects,
      duplicateReceipts: receipts,
      actions: counts,
      choices,
      progress,
      matchId: finished.statistics!.id,
      replayShare: replay.shareId,
    }),
  );
  // Real rematch reset is exercised after a default-target victory.
  const rematch = await seats[0].request({ op: "rematch", code });
  assert.equal(rematch.status, 200);
  g = rematch.game;
  assert.equal(g.map, selectedMap);
  assert.equal(g.phase, "lobby");
  assert.equal(g.target, target);
  assert.equal(g.cities, null);
  assertGoldRushProjection(g);
  assertBlackForestProjection(g);
  if (selectedMap === "goldRush") {
    assert.equal(g.board.tiles.filter((t) => t.fog).length, 7);
    assertGoldRushInventory(await raw(code));
  }
  if (selectedMap === "blackForest") {
    assert.equal(g.board.tiles.filter((t) => t.fog).length, 30);
    assertBlackForestInventory(await raw(code));
  }
  assert(g.players.every((p) => p.resources === 0 && !p.ready));
  const result = (await fetch(
    `${origin}/api/matches?match=${finished.statistics!.id}`,
  ).then((r) => r.json())) as {
    game: View;
  };
  assert.deepEqual(result.game.statistics, finished.statistics);
  assert.equal(result.game.phase, "finished");
  assert.equal(result.game.winner, finished.winner);
  assert(result.game.players.every((p) => !p.hand && !("id" in p)));
  assert(!("decks" in result.game.cities!));
}
console.log(
  `${sizes.length} independent HTTP matches completed without post-start state fixtures; ${transportRetries} transport retries.`,
);
