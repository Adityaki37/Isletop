// Local HTTP match drivers call this with their normal owned action transport.
import assert from "node:assert/strict";
import type { Action, View } from "../lib/game";
export async function pauseMatchProof(
  game: View,
  move: (seat: number, action: Action) => Promise<View>,
) {
  const before = game;
  let g = await move(0, { type: "pauseRequest" });
  for (let seat = 1; seat < g.players.length; seat++)
    g = await move(seat, {
      type: "pauseVote",
      id: g.pause.vote!.id,
      accept: true,
    });
  assert(g.pause.pausedAt !== null);
  assert.deepEqual(g.board, before.board);
  assert.equal(g.deadline, before.deadline);
  assert.equal(g.phase, before.phase);
  assert.equal(g.turn, before.turn);
  const paused = g.pause.pausedAt;
  g = await move(0, { type: "pauseRequest" });
  for (let seat = 1; seat < g.players.length; seat++)
    g = await move(seat, {
      type: "pauseVote",
      id: g.pause.vote!.id,
      accept: true,
    });
  assert.equal(g.pause.pausedAt, null);
  assert.equal(g.pause.vote, null);
  assert.deepEqual(g.board, before.board);
  assert.equal(g.phase, before.phase);
  assert.equal(g.turn, before.turn);
  if (before.deadline !== null)
    assert(
      Math.abs(g.deadline! - before.deadline - (g.serverTime - paused)) < 1000,
    );
  return g;
}
