import type { Good } from "./cities-knights";
import type { Game } from "./game";

export type CardEndpoint = { type: "player"; seat: number } | { type: "tile"; tile: number } | { type: "bank" };
export type CardTransfer = { card: Good | "development" | "hidden"; amount: number; from: CardEndpoint; to: CardEndpoint };
export type CardFeedback = { sequence: number; source: "setup" | "purchase" | "trade" | "bank" | "steal"; transfers: CardTransfer[] };

// Purchased card kinds stay hidden. Stolen resources are redacted per viewer below.
export function recordCardFeedback(g: Game, source: CardFeedback["source"], transfers: CardTransfer[]) {
  const paid = transfers.filter(t => t.amount > 0);
  if (!paid.length) return;
  const previous = g.cardFeedback ?? [];
  g.cardFeedback = [...previous, {
    sequence: (previous.at(-1)?.sequence ?? 0) + 1, source, transfers: paid,
  }].slice(-24);
}

export function cardFeedbackForViewer(events: CardFeedback[] | undefined, viewer: number) {
  return events?.map(event => event.source !== "steal" ? event : {
    ...event,
    transfers: event.transfers.map(transfer => ({
      ...transfer,
      card: (transfer.from.type === "player" && transfer.from.seat === viewer) ||
        (transfer.to.type === "player" && transfer.to.seat === viewer)
        ? transfer.card : "hidden" as const,
    })),
  });
}
