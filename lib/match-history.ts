import type { Game, GameMode, View } from "./game";
import { view } from "./game";
export type MatchSummary = {
  id: string;
  code: string;
  title: string;
  mode: GameMode;
  startedAt: number;
  finishedAt: number;
  turns: number;
  target: number;
  winner: number;
  resignedBy: number | null;
  players: {
    name: string;
    color: number;
    score: number;
    avatar?: import("./avatars").AvatarId;
  }[];
};
export function archivedMatch(g: Game) {
  if (g.phase !== "finished" || g.winner === null || !g.statistics) return null;
  const result = view(g, null),
    stats = g.statistics;
  const summary: MatchSummary = {
    id: stats.id,
    code: g.code,
    title: g.title,
    mode: g.mode,
    startedAt: stats.startedAt,
    finishedAt: stats.finishedAt ?? g.updated,
    turns: g.turn,
    target: g.target,
    winner: g.winner,
    resignedBy: g.resignedBy,
    players: result.players.map(({ name, color, score, avatar }) => ({
      name,
      color,
      score,
      avatar,
    })),
  };
  // Keep the completed table and statistics, never hands, cookies, decks or chat.
  result.chat = [];
  result.offers = [];
  result.legal = {
    settlement: [],
    road: [],
    city: [],
    robber: [],
    pirate: [],
    ship: [],
    moveShips: [],
    shipDestinations: {},
  };
  return { summary, result, participants: g.players.map((p) => p.id) };
}
export type ArchivedResult = { summary: MatchSummary; game: View };
