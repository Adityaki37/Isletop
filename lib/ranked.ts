import {
  PLACEMENT_GAMES,
  type Season,
  type RankedSeed,
  type RankedSeat,
  type RankedSnapshot,
  type RankedView,
  type Division,
  type RankedMode,
  RANKED_MODES,
} from "./ranked-types";
export function rankedMode(value: unknown): RankedMode {
  if (!RANKED_MODES.includes(value as RankedMode))
    throw Error("Choose an available Ranked mode.");
  return value as RankedMode;
}
// Three-month UTC cycles aligned with the observed Nov 1 season boundary.
// Seasons use stable date-based identifiers.
export function rankedSeason(now = Date.now()): Season {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw Error("Invalid season date.");
  const year = date.getUTCFullYear(),
    month = date.getUTCMonth();
  const start = month < 1 ? -2 : 1 + Math.floor((month - 1) / 3) * 3;
  const startsAt = Date.UTC(year, start, 1),
    endsAt = Date.UTC(year, start + 3, 1),
    d = new Date(startsAt);
  return {
    id: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    label: `${d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })} season`,
    startsAt,
    endsAt,
  };
}
export function seasonById(id: string): Season {
  if (!/^20\d{2}-(02|05|08|11)$/.test(id))
    throw Error("Choose a valid Ranked season.");
  const [year, month] = id.split("-").map(Number);
  return rankedSeason(Date.UTC(year, month - 1, 1));
}
export function resetRating(previous: number | null | undefined) {
  return previous == null ? 1000 : Math.round(1000 + (previous - 1000) * 0.5);
}
// These thresholds and the softmax/K factors are an independent rating model.
// Winner-only outcomes and ten placements follow the public reference rules.
export function division(rating: number): Division {
  return rating < 1000
    ? "bronze"
    : rating < 1200
      ? "silver"
      : rating < 1400
        ? "gold"
        : rating < 1600
          ? "platinum"
          : rating < 1800
            ? "diamond"
            : rating < 2000
              ? "master"
              : "grandmaster";
}
export function ratingSeats(seeds: RankedSeed[]): RankedSeat[] {
  if (
    ![2, 4].includes(seeds.length) ||
    new Set(seeds.map((s) => s.accountId)).size !== seeds.length ||
    seeds.some(
      (s) =>
        !s.accountId ||
        !s.username ||
        !Number.isSafeInteger(s.rating) ||
        s.rating < 0 ||
        s.rating > 4000 ||
        !Number.isSafeInteger(s.games) ||
        s.games < 0 ||
        !Number.isSafeInteger(s.wins) ||
        s.wins < 0 ||
        s.wins > s.games,
    )
  )
    throw Error("Invalid Ranked participants.");
  const max = Math.max(...seeds.map((s) => s.rating)),
    weights = seeds.map((s) => Math.pow(10, (s.rating - max) / 400)),
    sum = weights.reduce((n, v) => n + v, 0);
  return seeds.map((s, i) => {
    const expected = weights[i] / sum,
      k = s.games < PLACEMENT_GAMES ? 64 : 32;
    return {
      ...s,
      win: Math.min(
        4000 - s.rating,
        Math.max(1, Math.round(k * (1 - expected))),
      ),
      loss:
        s.rating === 0
          ? 0
          : -Math.min(s.rating, Math.max(1, Math.round(k * expected))),
    };
  });
}
export function rankedView(
  snapshot: RankedSnapshot,
  winner: number | null,
  finished: boolean,
): RankedView {
  return {
    season: { ...snapshot.season },
    mode: snapshot.mode,
    finished,
    players: snapshot.seats.map((s, i) => {
      const change = i === winner ? s.win : s.loss,
        after = s.rating + change,
        games = s.games + (finished ? 1 : 0),
        placed = games >= PLACEMENT_GAMES;
      return {
        username: s.username,
        rating: s.games >= PLACEMENT_GAMES ? s.rating : null,
        after: finished && placed ? after : null,
        change: finished && s.games >= PLACEMENT_GAMES ? change : null,
        win: s.games >= PLACEMENT_GAMES ? s.win : null,
        loss: s.games >= PLACEMENT_GAMES ? s.loss : null,
        games,
        division: placed ? division(finished ? after : s.rating) : null,
      };
    }),
  };
}
export function rankedRange(joinedAt: number, now: number) {
  return Math.min(
    4000,
    100 + Math.floor(Math.max(0, now - joinedAt) / 15000) * 100,
  );
}
