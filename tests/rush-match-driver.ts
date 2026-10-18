// Test-only decisions based on one seat's permitted projection.
import { emptyHand } from "../lib/board";
import type { Action, Game, View } from "../lib/game";
import { chooseMove } from "./autoplay";
export function chooseRushMove(v: View): Action | null {
  if (v.me < 0 || ["lobby", "finished"].includes(v.phase)) return null;
  if (v.phase === "discard" && !v.discards[v.me]) return null;
  if (v.phase.startsWith("setup") && v.active !== v.me) return null;
  const proxy = {
    ...v,
    players: v.players.map((p, i) => ({
      ...p,
      id: "test-only",
      hand: p.hand ?? { ...emptyHand(), wood: p.resources },
      dev: (p.dev ?? [])
        .filter(
          (d) =>
            !(
              i === v.me &&
              d.kind === "knight" &&
              v.rush?.robberQueue.includes(v.me)
            ),
        )
        .map((d) => ({ ...d, bought: -1 })),
    })),
    devPlayed: false,
    deck: Array(v.deckCount).fill("knight"),
    receipts: [],
  } as unknown as Game;
  const action = chooseMove(proxy, v.me);
  return action?.type === "end" ? null : action;
}
