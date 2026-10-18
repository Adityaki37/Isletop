import type { Action, View } from "./game";

const best = <T>(items: readonly T[], score: (item: T) => number) =>
  [...items].sort((a, b) => score(b) - score(a))[0];

// Use only the moving player's permitted view, never opponents' private cards.
export function robberValue(g: View, id: number) {
  const own = g.players[g.me], t = g.board.tiles[id];
  const production = t.number >= 2 && t.number <= 12 && t.number !== 7
    ? 6 - Math.abs(7 - t.number) : 0;
  return t.vertices.reduce((score, vid) => {
    const v = g.board.vertices[vid];
    if (v.owner === null) return score;
    const player = g.players[v.owner];
    const importance = 1 + Math.max(0, player.publicScore - own.publicScore) * 0.6
      + (player.publicScore >= g.target - 2 ? 3 : 0);
    return score + (v.owner === g.me ? -8 : importance) * (v.city ? 2 : 1) * production;
  }, 0) + (t.vertices.some(vid => {
    const owner = g.board.vertices[vid].owner;
    return owner !== null && owner !== g.me && g.players[owner].resources > 0;
  }) ? 4 : 0);
}

function pirateValue(g: View, id: number) {
  return g.board.edges
    .filter(e => e.tiles.includes(id) && e.kind === "ship" && e.owner !== null)
    .reduce((score, e) => score + (e.owner === g.me ? -10 : 3 + g.players[e.owner!].publicScore), 0);
}

export function robberCandidates(g: View): Action[] {
  if (g.me < 0) return [];
  if (g.phase === "steal") {
    const id = best(g.victims, seat => g.players[seat].publicScore * 3 + g.players[seat].resources * 0.25);
    return id === undefined ? [] : [{type:"steal", id}];
  }
  if (g.phase !== "robber") return [];
  const tile = best(g.legal.robber, id => robberValue(g, id));
  const pirate = best(g.legal.pirate, id => pirateValue(g, id));
  const moves: Action[] = [];
  if (tile !== undefined) moves.push({type:"robber", id:tile});
  if (pirate !== undefined) moves.push({type:"pirate", id:pirate});
  return moves.sort((a, b) => {
    const value = (move: Action) => move.type === "pirate"
      ? pirateValue(g, move.id!) : robberValue(g, move.id!);
    return value(b) - value(a);
  });
}
