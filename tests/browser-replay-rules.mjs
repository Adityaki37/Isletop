import assert from "node:assert/strict";

// Older immutable recordings predate public expansion metadata. Reconstruct
// these fields from the saved result, the observed lobby and historical moves;
// never rewrite a recording or substitute a private live game for its history.
export function replayRules(initial, summary, proof) {
  assert.equal(summary.mode, proof.mode);
  assert.equal(summary.target, proof.finished.target);
  const legacy = {
    rules: initial.mode === undefined,
    gold: initial.goldClaims === undefined,
    ships: initial.shipMoved === undefined,
    islands: initial.players.some((p) => p.islandBonus === undefined),
  };
  const state = structuredClone(initial);
  if (legacy.rules)
    Object.assign(state, {
      mode: summary.mode,
      target: summary.target,
      map: proof.map,
      scenario: proof.scenario,
      friendlyRobber: false,
    });
  if (legacy.gold) state.goldClaims = {};
  if (legacy.ships) state.shipMoved = false;
  if (legacy.islands)
    state.players.forEach((p) => {
      p.islandBonus = 0;
      p.islands = [];
    });
  const resources = ["wood", "brick", "sheep", "wheat", "ore"];
  function advance(next, old, { action: a, seat: p }) {
    let claims = { ...old.goldClaims };
    const newlyGold = next.board.tiles.filter(
      (t) => t.resource === "gold" && !t.fog && old.board.tiles[t.id].fog,
    );
    if (newlyGold.length) claims[p] = (claims[p] || 0) + newlyGold.length;
    if (
      a.type === "settlement" &&
      old.phase === "setupSettlement" &&
      old.board.vertices.some((v) => v.owner === p)
    ) {
      const amount = next.board.vertices[a.id].tiles.filter(
        (id) => next.board.tiles[id].resource === "gold",
      ).length;
      if (amount) claims[p] = (claims[p] || 0) + amount;
    }
    if (
      next.phase === "gold" &&
      old.phase !== "gold" &&
      !Object.keys(claims).length
    ) {
      const sum = next.dice[0] + next.dice[1];
      assert.notEqual(sum, 7);
      next.board.tiles
        .filter(
          (t) =>
            !t.fog &&
            t.resource === "gold" &&
            t.number === sum &&
            t.id !== next.board.robber,
        )
        .forEach((t) =>
          t.vertices.forEach((id) => {
            const v = next.board.vertices[id];
            if (v.owner !== null)
              claims[v.owner] = (claims[v.owner] || 0) + (v.city ? 2 : 1);
          }),
        );
      assert(
        Object.keys(claims).length,
        "Gold obligations follow visible production or exploration",
      );
    }
    if (a.type === "gold") delete claims[p];
    if (!resources.some((r) => next.bank[r])) claims = {};
    if (legacy.gold) next.goldClaims = claims;
    else
      assert.deepEqual(
        next.goldClaims,
        claims,
        "Recorded gold obligations match independent history",
      );
    const moved =
      next.turn !== old.turn
        ? false
        : a.type === "moveShip"
          ? true
          : old.shipMoved;
    if (legacy.ships) next.shipMoved = moved;
    else assert.equal(next.shipMoved, moved);
    if (legacy.islands)
      next.players.forEach((player, i) => {
        const islands = [...old.players[i].islands];
        let bonus = old.players[i].islandBonus;
        if (
          i === p &&
          a.type === "settlement" &&
          next.mode.includes("seafarers") &&
          next.scenario !== "fogIslands"
        ) {
          const v = next.board.vertices[a.id];
          const island = v.tiles
            .map((id) => next.board.tiles[id])
            .find((t) => !["sea", "desert"].includes(t.resource))?.island;
          if (island !== undefined && !islands.includes(island)) {
            islands.push(island);
            if (
              old.phase !== "setupSettlement" &&
              (next.scenario === "fourIslands" ||
                !v.tiles.some((id) => next.board.tiles[id].home))
            )
              bonus += 2;
          }
        }
        player.islands = islands;
        player.islandBonus = bonus;
      });
    return next;
  }
  return { state, advance, legacy };
}
