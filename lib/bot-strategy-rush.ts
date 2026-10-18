// Disconnected-seat decisions based on one seat's permitted projection.
import { emptyHand } from "./board";
import type { Action, Game, View } from "./game";
import { chooseMove } from "./bot-strategy-base";
import { robberCandidates } from "./robber-strategy";
export function chooseRushMove(v: View): Action | null {
  if (v.me < 0 || ["lobby", "finished"].includes(v.phase)) return null;
  if (v.phase === "robber" || v.phase === "steal") return robberCandidates(v)[0] ?? null;
  if (v.phase === "discard" && !v.discards[v.me]) return null;
  if (v.phase.startsWith("setup") && v.active !== v.me) return null;
  const proxy = {
    ...v,
    players: v.players.map((p, i) => ({
      ...p,
      id: "bot-projection",
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
