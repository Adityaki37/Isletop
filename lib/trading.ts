import type { Game, Offer, Player } from "./game";
import { RESOURCES, secureRandom } from "./board";
import { GOODS } from "./cities-knights";
type Trade = Pick<Offer, "from" | "replyTo" | "targets">;
type Table = { active: number; players: Pick<Player, "embargoes">[] };
export function tradeExecutor(
  o: Pick<Offer, "from" | "replyTo" | "executor">,
  active: number,
) {
  return (
    o.executor ?? (o.replyTo !== null && o.from !== active ? active : o.from)
  );
}
export function tradePerspective(
  o: Pick<Offer, "from" | "replyTo" | "executor" | "targets" | "give" | "want">,
  active: number,
  viewer: number,
) {
  const executor = tradeExecutor(o, active);
  // Other recipients can join a counteroffer on its author's side.
  // Spectators continue to see the offer from its author's perspective.
  const authorSide =
    viewer < 0 || viewer === o.from || (executor !== o.from && viewer !== executor);
  return {
    give: authorSide ? o.give : o.want,
    receive: authorSide ? o.want : o.give,
    giveFrom: viewer < 0 ? o.from : viewer,
    receiveFrom: authorSide
      ? executor !== o.from
        ? executor
        : o.targets?.length === 1
          ? o.targets[0]
          : null
      : o.from,
  };
}
export function tradePartners(g: Table, o: Trade) {
  const executor = tradeExecutor(o, g.active);
  return (o.targets ?? g.players.map((_, i) => i)).filter(
    (i) => i !== executor,
  );
}
export function tradeEligible(g: Table, o: Trade, p: number) {
  return (
    p !== o.from &&
    (tradePartners(g, o).includes(p) ||
      (o.replyTo !== null && p === tradeExecutor(o, g.active)))
  );
}
export function tradeBlocked(g: Pick<Table, "players">, a: number, b: number) {
  return !!(
    g.players[a]?.embargoes.includes(b) || g.players[b]?.embargoes.includes(a)
  );
}
// Longer response windows leave time to inspect an offer and prepare a counter.
// Recipients see their own deadline; authors see the last pending timed response.
export function tradeCooldown(seconds: number) {
  return (
    (
      {
        0: 60,
        15: 12,
        30: 20,
        60: 30,
        120: 45,
        200: 60,
        240: 60,
        9000: 90,
        12000: 90,
      } as Record<number, number>
    )[seconds] ?? Math.max(12, Math.min(60, Math.round(seconds / 2)))
  ) * 1000;
}
export function initializeTrade(
  g: Game,
  o: Offer,
  p: number,
  now: number,
  rng = secureRandom,
) {
  const durations = (o.responseDurations ??= {});
  if (!g.players[p].autoRejectTrades) {
    delete durations[p];
    return null;
  }
  const hand = g.players[p].hand;
  const goods = g.cities ? GOODS : RESOURCES;
  if (!goods.some((r) => (hand[r] ?? 0) > 0)) {
    durations[p] = 0;
    return now;
  }
  const requested = tradeExecutor(o, g.active) === o.from ? o.want : o.give;
  const cooldown = g.rush
    ? Math.max(2000, Math.min(20000, (g.turnSeconds * 1000) / 3))
    : tradeCooldown(g.turnSeconds);
  const canPay = goods.every((r) => (hand[r] ?? 0) >= (requested[r] ?? 0));
  durations[p] = canPay
    ? cooldown
    : Math.round(cooldown * 0.75 + (rng() * 2 - 1) * 1000);
  return now + durations[p];
}
export function tradeResponseTimer(o: Offer, viewer: number) {
  let seat = viewer;
  if (viewer === o.from) {
    seat = -1;
    for (const [key, deadline] of Object.entries(o.responseDeadlines)) {
      const p = Number(key);
      if (
        deadline !== null &&
        !o.preparing.includes(p) &&
        !o.accepted.includes(p) &&
        !o.rejected.includes(p) &&
        !o.blocked.includes(p) &&
        (seat < 0 || deadline > o.responseDeadlines[seat]!)
      ) seat = p;
    }
  }
  const responseDeadline = seat >= 0 ? (o.responseDeadlines[seat] ?? null) : null;
  return {
    responseDeadline,
    responseDuration: responseDeadline !== null ? (o.responseDurations?.[seat] ?? null) : null,
  };
}
export function needsTradeUpdate(g: Game, now = Date.now()) {
  return (
    g.pause?.pausedAt == null &&
    g.phase === "action" &&
    g.offers.some(
      (o) =>
        (o.closeAt !== null && o.closeAt !== undefined && o.closeAt <= now) ||
        Object.values(o.preparingUntil ?? {}).some((t) => t <= now) ||
        Object.entries(o.responseDeadlines ?? {}).some(
          ([p, t]) =>
            t !== null && t <= now && !o.preparing.includes(Number(p)),
        ),
    )
  );
}
export function advanceTrades(g: Game, now = Date.now(), rng = secureRandom) {
  if (g.pause?.pausedAt != null) return;
  for (const o of g.offers) {
    if (g.phase !== "action") {
      o.pausedAt ??= now;
      continue;
    }
    if (o.pausedAt !== null) {
      const elapsed = Math.max(0, now - o.pausedAt);
      for (const p in o.responseDeadlines)
        if (o.responseDeadlines[p] !== null) o.responseDeadlines[p]! += elapsed;
      for (const p in o.preparingUntil) o.preparingUntil[p] += elapsed;
      if (o.closeAt !== null) o.closeAt += elapsed;
      o.pausedAt = null;
    }
    const executor = tradeExecutor(o, g.active),
      partners = tradePartners(g, o);
    const blocked = partners.filter((p) => tradeBlocked(g, executor, p));
    for (const p of blocked) {
      o.accepted = o.accepted.filter((i) => i !== p);
      o.rejected = o.rejected.filter((i) => i !== p);
      o.expired = o.expired.filter((i) => i !== p);
      o.preparing = o.preparing.filter((i) => i !== p);
      delete o.preparingUntil[p];
      delete o.responseDeadlines[p];
    }
    for (const p of o.blocked.filter(
      (p) => !blocked.includes(p) && p !== o.from,
    ))
      o.responseDeadlines[p] = initializeTrade(g, o, p, now, rng);
    o.blocked = blocked;
    for (const p of [...o.preparing]) {
      if (o.preparingUntil[p] <= now) {
        o.preparing = o.preparing.filter((i) => i !== p);
        delete o.preparingUntil[p];
        if (p !== executor && p !== o.from && !o.accepted.includes(p))
          o.responseDeadlines[p] = initializeTrade(g, o, p, now, rng);
      }
    }
    for (const [key, deadline] of Object.entries(o.responseDeadlines)) {
      const p = Number(key);
      if (deadline !== null && deadline <= now && !o.preparing.includes(p)) {
        if (!o.rejected.includes(p)) o.rejected.push(p);
        if (!o.expired.includes(p)) o.expired.push(p);
        delete o.responseDeadlines[p];
      }
    }
    const willingCreator = executor !== o.from && !blocked.includes(o.from);
    const stillWaiting =
      o.preparing.length > 0 ||
      o.accepted.length > 0 ||
      willingCreator ||
      g.offers.some((child) => child.replyTo === o.id) ||
      partners.some((p) => !o.rejected.includes(p) && !blocked.includes(p));
    if (stillWaiting) o.closeAt = null;
    else o.closeAt ??= now + (g.rush ? 0 : 2000);
  }
  const closed = new Set(
    g.offers
      .filter((o) => o.closeAt !== null && o.closeAt <= now)
      .map((o) => o.id),
  );
  for (const o of g.offers)
    if (o.replyTo !== null && closed.has(o.replyTo)) closed.add(o.id);
  g.offers = g.offers.filter((o) => !closed.has(o.id));
}
