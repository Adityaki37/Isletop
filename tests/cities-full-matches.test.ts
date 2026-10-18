import test from "node:test";
import assert from "node:assert/strict";
import {
  Game,
  createGame,
  player,
  addPlayer,
  applyAction,
  actor,
  view,
  points,
  normalizeGame,
} from "../lib/game";

import { chooseLegalCitiesMove, citiesMatchActor } from "./cities-match-driver";

import { assertCitiesInventory } from "./cities-match-inventory";
import { assertStatistics } from "./statistics-assertions";
function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
for (const n of [3, 4, 6])
  for (const seed of [37, 129])
    test(`C&K ${n}-seat default 13-point match, generated setup, seed ${seed}`, (t) => {
      const rng = random(seed + n * 1000);
      // Room creation/start use secure randomness for terrain and card shuffles.
      // Seed that source too, so the full-match coverage is reproducible rather
      // than seeding only the later dice. No game state is granted or replaced.
      t.mock.method(crypto, "getRandomValues", (values: Uint32Array) => {
        for (let i = 0; i < values.length; i++)
          values[i] = Math.floor(rng() * 4294967296);
        return values;
      });
      let g = createGame(
        "MATCH2",
        player("p0", "Seat 0"),
        n,
        false,
        "citiesKnights",
      );
      const counts: Record<string, number> = {},
        choices: Record<string, number> = {},
        progress: Record<string, number> = {};
      applyAction(g, 0, { type: "settings", turnSeconds: 0 }, rng, 100000);
      for (let p = 1; p < n; p++) {
        addPlayer(g, player(`p${p}`, `Seat ${p}`));
      }
      for (let p = 1; p < n; p++)
        applyAction(g, p, { type: "ready" }, rng, 100000);
      assert.equal(g.target, 13);
      applyAction(g, 0, { type: "start" }, rng, 100000);
      t.mock.restoreAll();
      let moves = 0;
      while (g.phase !== "finished" && moves < 12000) {
        const p = citiesMatchActor(g),
          a = chooseLegalCitiesMove(g);
        counts[a.type] = (counts[a.type] ?? 0) + 1;
        if (g.phase === "citiesChoice") {
          const kind = g.cities!.choices[0].kind;
          choices[kind] = (choices[kind] ?? 0) + 1;
        }
        if (a.type === "progress") {
          const kind = g.cities!.players[p].progress.find(
            (card) => card.id === a.cardId,
          )!.kind;
          progress[kind] = (progress[kind] ?? 0) + 1;
        }
        applyAction(g, p, a, rng, 100000 + moves);
        moves++;
        if (moves % 23 === 0) g = normalizeGame(JSON.parse(JSON.stringify(g)));
        assertCitiesInventory(g);
        assertStatistics(g);
        if (g.phase !== "finished")
          assert.equal(view(g, null).statistics, null);
      }
      assert.equal(
        g.phase,
        "finished",
        JSON.stringify({
          turn: g.turn,
          scores: g.players.map((_, p) => points(g, p)),
          counts,
          choices,
          improvements: g.cities!.players.map((p) => p.improvements),
        }),
      );
      assert.notEqual(g.winner, null);
      assert.equal(g.active, g.winner);
      assert(points(g, g.winner!) >= 13);
      assert(g.cities!.attacks > 0);
      assert(
        counts.placeKnight > 0 &&
          counts.activateKnight > 0 &&
          counts.improve > 0,
      );
      assert(counts.bankTrade > 0);
      assert(
        (counts.city ?? 0) + (progress.medicine ?? 0) > 0,
        "No city upgrade occurred",
      );
      assert(Object.keys(progress).length >= 3);
      console.log(
        JSON.stringify({
          players: n,
          seed,
          moves,
          turns: g.turn,
          winner: g.winner,
          score: points(g, g.winner!),
          attacks: g.cities!.attacks,
          actions: counts,
          choices,
          progress,
        }),
      );
    });
