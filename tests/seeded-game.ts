import { applyAction, type Game } from "../lib/game";
import { shuffle } from "../lib/board";
import { makeBaseBoard } from "../lib/base-maps";
import { makeSeafarersBoard } from "../lib/seafarers";
import { createCitiesState } from "../lib/cities-knights";
import { usesSeafarers } from "../lib/game-modes";

// Test-only initialization. Starting the engine currently generates its board
// and shuffled decks independently of applyAction's injected dice/trade RNG.
// Replace that initial random state before any setup placement or draw.
export function seededStart(g: Game, rng: () => number) {
  applyAction(g, 0, { type: "start" }, rng);
  g.board = usesSeafarers(g.mode)
    ? makeSeafarersBoard(g.boardPlayers, g.scenario, rng)
    : makeBaseBoard(g.boardPlayers, g.map, rng);
  g.deck = shuffle(g.deck.sort(), rng);
  if (g.cities) g.cities = createCitiesState(g.players.length, rng);
}

export function seededRandom(initial: number) {
  let seed = initial;
  return () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
