// A unique public leader only. Private victory cards never affect this mark.
// The same rule is used by live player panels and historical replay panels.
export function publicLeader(game: {
  phase: string;
  players: readonly { publicScore: number }[];
}): number | null {
  if (
    ["lobby", "setupSettlement", "setupRoad"].includes(game.phase) ||
    !game.players.length ||
    game.players.some((p) => !Number.isFinite(p.publicScore))
  )
    return null;
  const highest = Math.max(...game.players.map((p) => p.publicScore));
  const leaders = game.players
    .map((p, i) => (p.publicScore === highest ? i : -1))
    .filter((i) => i >= 0);
  return leaders.length === 1 ? leaders[0] : null;
}
