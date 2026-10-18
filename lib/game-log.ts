import type { Game } from "./game";
import { GOODS, type Good } from "./cities-knights";
import { RESOURCES } from "./board";
import { productionTransfers } from "./production-feedback";
export type PrivateLogDetail = { text: string; seats: number[] } | null;
export function formatResourceCards(cards: Partial<Record<Good, number>>) {
  return GOODS.filter(good => (cards[good] ?? 0) > 0)
    .map(good => `${cards[good]} ${good}`).join(" and ");
}
export function appendGameLog(
  g: Game,
  text: string,
  detail: PrivateLogDetail = null,
) {
  if (text === "No resources produced on a seven.") g.productionFeedback = {
    sequence: (g.productionFeedback?.sequence ?? 0) + 1,
    roll: 7, source: "dice", transfers: [],
  };
  g.logDetails ??= g.log.map(() => null);
  g.log.push(text);
  g.logDetails.push(detail);
  g.log = g.log.slice(-160);
  g.logDetails = g.logDetails.slice(-160);
}

// Production is public; report only cards actually paid by the bank.
export function appendResourceReceipt(
  g: Game,
  seat: number,
  received: Partial<Record<Good, number>>,
  source = "",
) {
  const cards = formatResourceCards(received);
  if (cards) appendGameLog(g, `${g.players[seat].name} got ${cards}${source ? ` from ${source}` : ""}.`);
  if (cards && source) g.productionFeedback = {
    sequence: (g.productionFeedback?.sequence ?? 0) + 1,
    roll: null,
    source,
    transfers: GOODS.flatMap((good) => (received[good] ?? 0) > 0
      ? [{ seat, good, amount: received[good]!, tile: null }] : []),
  };
  return !!cards;
}

export function appendProductionLog(
  g: Game,
  received: Partial<Record<Good, number>>[],
  gold: number[] = g.players.map((_, seat) => g.goldClaims[seat] ?? 0),
  aqueduct: number[] = [],
  sum = g.dice.reduce((a, b) => a + b, 0),
) {
  g.productionFeedback = {
    sequence: (g.productionFeedback?.sequence ?? 0) + 1,
    roll: sum,
    source: "dice",
    transfers: productionTransfers(g.board, !!g.cities, sum, received),
  };
  const available = RESOURCES.reduce((n, good) => n + g.bank[good], 0);
  gold = gold.map((n) => Math.min(n, available));
  let paid = false;
  received.forEach((cards, seat) => {
    paid = appendResourceReceipt(g, seat, cards) || paid;
    if (gold[seat]) appendGameLog(g, `${g.players[seat].name} may choose ${gold[seat]} resources from gold.`);
    if (aqueduct.includes(seat)) appendGameLog(g, `${g.players[seat].name} may choose 1 resource from Aqueduct.`);
  });
  if (!paid && !gold.some(Boolean) && !aqueduct.length)
    appendGameLog(g, "No resources produced.");
}
