import type { Game } from "./game";

export const BOT_MOVE_INTERVAL = 3000;
export const FAST_BOT_MOVE_INTERVAL = 500;

export function isBotPracticeGame(g: {
  public: boolean;
  ranked?: unknown;
  matchmaking?: unknown;
  players: { bot?: boolean }[];
}) {
  return !g.public && !g.ranked && !g.matchmaking && g.players.length > 1 &&
    !g.players[0].bot && g.players.slice(1).every(p => p.bot === true);
}

export function botMoveInterval(g: Pick<Game, "botFastForward" | "public" | "ranked" | "matchmaking" | "players">) {
  return g.botFastForward && isBotPracticeGame(g) ? FAST_BOT_MOVE_INTERVAL : BOT_MOVE_INTERVAL;
}
