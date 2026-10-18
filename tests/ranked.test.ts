import test from "node:test";
import assert from "node:assert/strict";
import {
  ratingSeats,
  rankedSeason,
  seasonById,
  resetRating,
  rankedView,
  rankedRange,
  rankedMode,
} from "../lib/ranked";
import {
  matchedGame,
  RANKED_QUEUES,
  matchmakingQueue,
} from "../lib/matchmaking";
import { view, advanceClock } from "../lib/game";
import type { RankedSeed } from "../lib/ranked-types";
const seeds = (n: number, games = 10): RankedSeed[] =>
  Array.from({ length: n }, (_, i) => ({
    accountId: `secret-account-${i}`,
    username: `human_${i}`,
    rating: 1000,
    games,
    wins: Math.floor(games / 2),
  }));
test("Ranked season boundaries use UTC including January and leap years", () => {
  assert.equal(rankedSeason(Date.UTC(2026, 0, 31, 23, 59, 59)).id, "2025-11");
  assert.equal(rankedSeason(Date.UTC(2026, 1, 1)).id, "2026-02");
  assert.equal(rankedSeason(Date.UTC(2026, 9, 31, 23, 59, 59)).id, "2026-08");
  assert.equal(rankedSeason(Date.UTC(2026, 10, 1)).id, "2026-11");
  assert.equal(seasonById("2028-02").endsAt, Date.UTC(2028, 4, 1));
  assert.throws(() => seasonById("2026-10"));
  assert.throws(() => rankedSeason(NaN));
  assert.equal(resetRating(undefined), 1000);
  assert.equal(resetRating(1600), 1300);
  assert.equal(resetRating(800), 900);
});
test("Winner-only rating is fixed before play, sensitive to opponents and bounded", () => {
  const equal = ratingSeats(seeds(4));
  assert(equal.every((s) => s.win === 24 && s.loss === -8));
  const gap = seeds(2);
  gap[1].rating = 1800;
  const uneven = ratingSeats(gap);
  assert(uneven[0].win > uneven[1].win);
  assert(uneven[1].loss < uneven[0].loss);
  for (let winner = 0; winner < 4; winner++) {
    const v = rankedView(
      { season: rankedSeason(), mode: "base4", seats: equal },
      winner,
      true,
    );
    assert(v.players[winner].change! > 0);
    v.players.forEach((p, i) => {
      if (i !== winner) assert.equal(p.change, -8);
    });
  }
  const extremes = seeds(2);
  extremes[0].rating = 0;
  extremes[1].rating = 4000;
  const bounded = ratingSeats(extremes);
  assert.equal(bounded[0].loss, 0);
  assert.equal(bounded[1].win, 0);
  assert(
    bounded.every((s) => s.rating + s.win <= 4000 && s.rating + s.loss >= 0),
  );
});
test("Placement projections redact private ratings and IDs until the tenth result", () => {
  const s = {
    season: rankedSeason(),
    mode: "duel" as const,
    seats: ratingSeats(seeds(2, 9)),
  };
  const before = rankedView(s, null, false);
  assert(
    before.players.every(
      (p) =>
        p.rating === null &&
        p.after === null &&
        p.change === null &&
        p.win === null &&
        p.loss === null &&
        p.division === null &&
        p.games === 9,
    ),
  );
  const after = rankedView(s, 1, true);
  assert(
    after.players.every(
      (p) =>
        p.rating === null &&
        p.after !== null &&
        p.change === null &&
        p.division !== null &&
        p.games === 10,
    ),
  );
  assert(!JSON.stringify(after).includes("secret-account"));
  assert.deepEqual(
    s.seats.map((s) => s.games),
    [9, 9],
  );
});
test("Ranked rejects duplicate accounts and malformed ratings/counters", () => {
  for (const patch of [
    { rating: NaN },
    { rating: -1 },
    { rating: 4001 },
    { games: -1 },
    { wins: -1 },
    { wins: 11 },
    { accountId: "" },
  ]) {
    const s = seeds(2);
    Object.assign(s[0], patch);
    assert.throws(() => ratingSeats(s));
  }
  const duplicate = seeds(2);
  duplicate[1].accountId = duplicate[0].accountId;
  assert.throws(() => ratingSeats(duplicate));
  for (const value of ["__proto__", "constructor", "unknown", null])
    assert.throws(() => matchmakingQueue(value));
  assert.throws(() => rankedMode("rankedDuel"));
  assert.equal(rankedRange(1000, 0), 100);
  assert.equal(rankedRange(0, 14999), 100);
  assert.equal(rankedRange(0, 15000), 200);
  assert.equal(rankedRange(0, 900000), 4000);
});
for (const queue of Object.keys(
  RANKED_QUEUES,
) as (keyof typeof RANKED_QUEUES)[])
  test(`${queue} freezes server ratings, hides bank and uses the full preset with finite clocks`, () => {
    const preset = RANKED_QUEUES[queue],
      snapshot = {
        season: rankedSeason(),
        mode: preset.rankedMode,
        seats: ratingSeats(seeds(preset.players, 0)),
      },
      humans = Array.from({ length: preset.players }, (_, i) => ({
        id: `private-player-${i}`,
        name: `Human ${i}`,
        color: i,
      }));
    assert.throws(() => matchedGame("RANKED", queue, humans));
    const { game: g, replay } = matchedGame(
      "RANKED",
      queue,
      humans,
      Date.now(),
      snapshot,
    );
    assert.equal(
      g.target,
      queue === "rankedDuel" ? 15 : queue === "rankedCities4" ? 13 : 10,
    );
    assert.equal(
      g.discardLimit,
      queue === "rankedDuel" || queue === "rankedRush4" ? 9 : 7,
    );
    assert.equal(g.turnSeconds, preset.seconds);
    assert.equal(g.hideBank, true);
    const stored = JSON.parse(JSON.stringify(g));
    assert(Number.isFinite(stored.deadline));
    advanceClock(stored, stored.updated);
    assert.equal(stored.phase, g.phase);
    const v = view(g, humans[0].id);
    assert(v.bank === null);
    assert(v.ranked?.players.every((p) => p.rating === null));
    assert(!JSON.stringify(v).includes("secret-account"));
    assert(!JSON.stringify(replay).includes("secret-account"));
    snapshot.seats[0].rating = 2000;
    assert.equal(g.ranked!.seats[0].rating, 1000);
  });
