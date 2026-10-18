import {
  createGame,
  player,
  addPlayer,
  applyAction,
  actor,
  view,
  points,
  total,
  type Game,
} from "../lib/game";
import { botMove, botPendingSeats } from "../lib/disconnect-bots";
const baselineMove = (
  globalThis as typeof globalThis & { baselineBotMove: typeof botMove }
).baselineBotMove;
const baselineProvenance = (
  globalThis as typeof globalThis & {
    baselineProvenance?: { version: string; commit: string };
  }
).baselineProvenance;
import { RESOURCES } from "../lib/board";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { seededStart } from "./seeded-game";
const count = Number(process.argv[2] ?? 24),
  mode = (process.argv[3] ?? "base") as Game["mode"];
const seedOffset = Number(process.argv[4] ?? 0);
assert(Number.isInteger(count) && count > 0 && count <= 500);
assert(Number.isInteger(seedOffset) && seedOffset >= 0);
assert(
  ["base", "seafarers", "citiesKnights", "seafarersCitiesKnights"].includes(
    mode,
  ),
);
const rows: unknown[] = [],
  wins = [0, 0],
  scores = [0, 0],
  times: number[] = [];
for (let pair = 0; pair < count; pair++)
  for (let seat = 0; seat < 4; seat++) {
    let seed = 12340 + (pair + seedOffset) * 997,
      policySeed = 773 + (pair + seedOffset) * 371;
    const rng = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    Math.random = () =>
      (policySeed = (Math.imul(policySeed, 1664525) + 1013904223) >>> 0) /
      4294967296;
    const g = createGame("BENCHB", player("0", "Seat 0"), 4, false, mode);
    for (let p = 1; p < 4; p++) addPlayer(g, player(String(p), `Seat ${p}`));
    g.players.forEach((p) => (p.ready = true));
    g.turnSeconds = 0;
    seededStart(g, rng);
    g.botPlayers = [0, 1, 2, 3];
    let moves = 0;
    const errors: string[] = [];
    const actions: Record<string, number> = {};
    const supply = g.bank.wood;
    while (g.phase !== "finished" && moves < 10000) {
      const p = botPendingSeats(g)[0];
      const now = g.created + moves * 1001;
      const t = performance.now();
      let a = p === seat ? botMove(g, p, now) : baselineMove(g, p, now);
      if (p === seat) times.push(performance.now() - t);
      if (!a) {
        errors.push(`No move: ${g.phase}`);
        break;
      }
      try {
        applyAction(g, p, a, rng, now);
      } catch (e) {
        errors.push(String(e));
        break;
      }
      if (p === seat) actions[a.type] = (actions[a.type] ?? 0) + 1;
      if (!g.cities)
        for (const r of RESOURCES)
          assert.equal(
            g.bank[r] + g.players.reduce((s, p) => s + p.hand[r], 0),
            supply,
          );
      moves++;
    }
    const won = g.winner === seat;
    wins[won ? 0 : 1]++;
    scores[0] += points(g, seat);
    scores[1] +=
      g.players.reduce((s, _, p) => s + (p === seat ? 0 : points(g, p)), 0) / 3;
    rows.push({
      seed: 12340 + (pair + seedOffset) * 997,
      seat,
      winner: g.winner,
      score: points(g, seat),
      turns: g.turn,
      moves,
      errors,
      actions,
    });
    assert.equal(errors.length, 0, JSON.stringify(rows.at(-1)));
    assert.equal(g.phase, "finished", JSON.stringify(rows.at(-1)));
    if (rows.length % 8 === 0)
      console.log(
        JSON.stringify({
          completed: rows.length,
          wins: wins[0],
          rate: wins[0] / rows.length,
        }),
      );
  }
times.sort((a, b) => a - b);
const result = {
  baseline: baselineProvenance?.version ?? "unspecified",
  baselineCommit: baselineProvenance?.commit ?? null,
  policy: "production",
  mode,
  seedOffset,
  games: rows.length,
  wins: wins[0],
  winRate: wins[0] / rows.length,
  meanScore: scores[0] / rows.length,
  opponentMeanScore: scores[1] / rows.length,
  p95DecisionMs: times[Math.floor(times.length * 0.95)],
  maxDecisionMs: times.at(-1),
  matches: rows,
};
writeFileSync(
  `.sites-runtime/bot-benchmark-${mode}-${seedOffset}.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ ...result, matches: undefined }));
