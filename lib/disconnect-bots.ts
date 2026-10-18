import {
  actor,
  applyAction,
  type Game,
  type Action,
  view,
  tradeEligible,
  tradeExecutor,
  total,
  tradePartners,
  tradeBlocked,
} from "./game";
import { emptyHand, RESOURCES } from "./board";
import { citiesCandidates } from "./bot-strategy-cities";
import { chooseRushMove } from "./bot-strategy-rush";
import { appendGameLog } from "./game-log";
import { plannedBaseCandidates } from "./bot-strategy-planned";
import { strategicTrade } from "./bot-economy";
import { tradeCooldown } from "./trading";
import { botMoveInterval } from "./bot-speed";
export { BOT_MOVE_INTERVAL } from "./bot-speed";
import { BOT_DISCONNECT_GRACE } from "./table-presence";
export { BOT_DISCONNECT_GRACE } from "./table-presence";
export const BOT_TRADE_WAIT = 10000;
export const BOT_TRADE_ATTEMPTS = 2;
export function botSeats(g: Game, expires: (number | null)[], now: number) {
  if (["lobby", "finished"].includes(g.phase) || g.mode === "solo") return [];
  return g.players.flatMap((seat, p) =>
    seat.bot ||
    (expires[p] !== null &&
      expires[p] !== undefined &&
      expires[p]! + BOT_DISCONNECT_GRACE <= now)
      ? [p]
      : [],
  );
}
export function botPendingSeats(g: Game) {
  if (g.phase === "discard") return Object.keys(g.discards).map(Number);
  if (g.phase === "gold") return Object.keys(g.goldClaims).map(Number);
  if (g.rush && !g.phase.startsWith("setup")) return g.botPlayers;
  const responders = g.botPlayers.filter(
    (p) =>
      g.phase === "action" &&
      g.offers.some(
        (o) =>
          tradeEligible(g, o, p) &&
          !o.accepted.includes(p) &&
          !o.rejected.includes(p) &&
          !o.expired.includes(p) &&
          !tradeBlocked(
            g,
            tradeExecutor(o, g.active),
            p === tradeExecutor(o, g.active) ? o.from : p,
          ),
      ),
  );
  // Confirm an accepted trade promptly; otherwise recipients respond before
  // the active bot can finish its turn and clear the offer.
  const accepted = g.offers.some(
    (o) => o.from === actor(g) && o.accepted.length > 0,
  );
  return [
    ...new Set(
      accepted ? [actor(g), ...responders] : [...responders, actor(g)],
    ),
  ];
}
export function botMove(g: Game, p: number, now = Date.now()): Action | null {
  const replacingPlayer = g.botPlayers.includes(p) && !g.players[p].bot;
  const visible = view(g, g.players[p].id);
  if (visible.phase === "discard" && !g.cities && !g.rush) {
    // Discard highlights contain no builds. Plan the cards to keep against the
    // seat's next action phase, using another private-safe public projection.
    // The submitted action is still validated against the real discard phase.
    visible.legal = view(
      { ...g, phase: "action", active: p },
      g.players[p].id,
    ).legal;
  }
  const candidates: (Action | null)[] = [];
  if (visible.phase === "action")
    for (const offer of visible.offers) {
      if (
        !tradeEligible(visible, offer, p) ||
        offer.accepted.includes(p) ||
        offer.rejected.includes(p) ||
        offer.expired.includes(p) ||
        tradeBlocked(
          visible,
          tradeExecutor(offer, visible.active),
          p === tradeExecutor(offer, visible.active) ? offer.from : p,
        )
      )
        continue;
      const executor = tradeExecutor(offer, visible.active);
      const receives =
        executor === p || executor === offer.from ? offer.give : offer.want;
      const gives =
        executor === p || executor === offer.from ? offer.want : offer.give;
      const hand = visible.players[p].hand!;
      const payable =
        total(gives) > 0 &&
        total(receives) > 0 &&
        Object.entries(gives).every(
          ([r, n]) => (hand[r as keyof typeof hand] ?? 0) >= n,
        );
      const worthwhile =
        !replacingPlayer &&
        payable &&
        (g.cities
          ? total(receives) >= total(gives)
          : strategicTrade(visible, gives, receives, offer.from));
      candidates.push({
        type: worthwhile
          ? executor === p
            ? "completeTrade"
            : "accept"
          : "reject",
        id: offer.id,
        ...(executor === p ? { to: offer.from } : {}),
      });
    }
  // Hidden bank stock is estimated, just as a human can propose an exchange.
  // Legality is checked by the normal engine; opponents' hands are never read.
  if (!visible.bank)
    visible.bank = Object.fromEntries(
      (visible.cities
        ? [...RESOURCES, "paper", "cloth", "coin"]
        : RESOURCES
      ).map((r) => [r, 24]),
    ) as Game["bank"];
  const memory = g.botTradeMemory?.[p];
  const ownOffer =
    visible.phase === "action" && !g.rush
      ? visible.offers.find((o) => o.from === p && o.replyTo === null)
      : undefined;
  let waiting = false;
  if (ownOffer) {
    for (const to of (replacingPlayer ? [] : [...ownOffer.accepted]).sort(
      (a, b) => visible.players[a].publicScore - visible.players[b].publicScore,
    ))
      candidates.push({ type: "completeTrade", id: ownOffer.id, to });
    const pending = tradePartners(visible, ownOffer).some(
      (to) =>
        !ownOffer.accepted.includes(to) &&
        !ownOffer.rejected.includes(to) &&
        !ownOffer.expired.includes(to) &&
        !tradeBlocked(visible, p, to),
    );
    const authoritativeOffer = g.offers.find((offer) => offer.id === ownOffer.id)!;
    const preparing = ownOffer.preparing.some(
      (to) => (authoritativeOffer.preparingUntil[to] ?? 0) > now,
    );
    const responseUntil = Math.max(
      (memory?.startedAt ?? now) + Math.max(BOT_TRADE_WAIT, tradeCooldown(g.turnSeconds)),
      ...Object.values(authoritativeOffer.responseDeadlines).map((deadline) => deadline ?? 0),
    );
    waiting =
      !replacingPlayer &&
      ownOffer.accepted.length === 0 &&
      pending &&
      memory?.turn === g.turn &&
      (preparing || now < responseUntil);
    if (!waiting) candidates.push({ type: "cancelOffer", id: ownOffer.id });
  }
  if (
    !ownOffer &&
    (actor(g) === p || ["discard", "gold"].includes(g.phase) || g.rush)
  ) {
    candidates.push(
      ...(g.cities
        ? citiesCandidates(visible)
        : g.rush
          ? [chooseRushMove(visible)]
          : plannedBaseCandidates(visible)),
    );
    if (visible.phase === "action" && !g.rush) candidates.push({ type: "end" });
    if (
      visible.phase === "citiesChoice" &&
      visible.cities?.choice?.kind === "aqueduct"
    )
      candidates.push(
        ...RESOURCES.map((resource) => ({ type: "citiesChoice", resource })),
      );
  }
  for (const action of candidates)
    if (action) {
      // A temporary replacement never consents to a player trade on someone's
      // behalf. Bank trades and mandatory game choices still work normally.
      if (
        replacingPlayer &&
        ["offer", "accept", "completeTrade", "editOffer", "counterOffer", "prepareCounter"].includes(action.type)
      )
        continue;
      if (
        action.type === "offer" &&
        memory?.turn === g.turn &&
        (memory.attempts >= BOT_TRADE_ATTEMPTS ||
          memory.signatures.includes(
            JSON.stringify([action.give, action.want, action.targets ?? null]),
          ))
      )
        continue;
      // Validate against a clone; planning never advances the real random stream or match.
      try {
        applyAction(structuredClone(g), p, action, () => 0.42, now);
        return action;
      } catch {
        /* Try the next legal candidate. */
      }
    }
  if (visible.phase === "gold")
    for (const resources of goldChoices(visible.goldAmount)) {
      const action: Action = { type: "gold", resources };
      try {
        applyAction(structuredClone(g), p, action, () => 0.42, now);
        return action;
      } catch {
        /* Try another public choice. */
      }
    }
  return null;
}
function* goldChoices(
  amount: number,
  index = 0,
  hand = emptyHand(),
): Generator<Game["bank"]> {
  if (index === RESOURCES.length - 1) {
    yield { ...hand, [RESOURCES[index]]: amount };
    return;
  }
  for (let n = amount; n >= 0; n--)
    yield* goldChoices(amount - n, index + 1, {
      ...hand,
      [RESOURCES[index]]: n,
    });
}
export function needsBotUpdate(g: Game, seats: number[], now = Date.now()) {
  return (
    JSON.stringify(seats) !== JSON.stringify(g.botPlayers) ||
    (g.pause.pausedAt === null &&
      now >= g.botDueAt &&
      botPendingSeats(g).some((p) => seats.includes(p)))
  );
}
export function advanceBots(g: Game, seats: number[], now = Date.now()) {
  if (["lobby", "finished"].includes(g.phase)) {
    g.botPlayers = [];
    return;
  }
  if (JSON.stringify(g.botPlayers) !== JSON.stringify(seats)) {
    for (const p of seats.filter(
      (p) => !g.botPlayers.includes(p) && !g.players[p].bot,
    ))
      appendGameLog(
        g,
        `${g.players[p].name} disconnected. A bot is playing until they return.`,
      );
    for (const p of g.botPlayers.filter((p) => !seats.includes(p)))
      if (g.players[p] && !g.players[p].bot)
        appendGameLog(g, `${g.players[p].name} returned and regained control.`);
    g.botPlayers = [...seats];
  }
  if (
    ["lobby", "finished"].includes(g.phase) ||
    g.pause.pausedAt !== null ||
    now < g.botDueAt
  )
    return;
  for (const p of botPendingSeats(g))
    if (seats.includes(p)) {
      const action = botMove(g, p, now);
      g.botDueAt = now + botMoveInterval(g);
      if (action) applyAction(g, p, action, undefined, now);
      return;
    }
}
