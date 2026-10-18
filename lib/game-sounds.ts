import type { View } from "./game";
import type { Sound } from "./sound-assets";
import { GOODS } from "./cities-knights";
import { tradeBlocked, tradeEligible, tradeExecutor } from "./trading";

/** Only projected public state and this viewer's hand are inspected. */
export function gameSounds(previous: View | null, next: View): Sound[] {
  if (
    !previous ||
    previous.code !== next.code ||
    previous.me !== next.me ||
    previous.revision >= next.revision ||
    (next.phase === "lobby" && previous.phase !== "lobby")
  )
    return [];
  const sounds = new Set<Sound>();
  if (next.pause.vote && next.pause.vote.id !== previous.pause?.vote?.id)
    sounds.add("vote_reminder");
  if (next.phase === "finished" && previous.phase !== "finished")
    return ["victory"];
  if (
    next.me >= 0 &&
    next.chat.length &&
    JSON.stringify(next.chat) !== JSON.stringify(previous.chat) &&
    next.chat.at(-1)?.name !== next.players[next.me].name
  )
    sounds.add("message_notification");
  if (previous.phase === "lobby") {
    if (next.phase !== "lobby") sounds.add("game_started");
    else {
      if (next.players.length > previous.players.length)
        sounds.add("join_room");
      if (next.players.length < previous.players.length)
        sounds.add("leave_room");
      const settings = (g: View) =>
        [
          g.mode,
          g.scenario,
          g.map,
          g.capacity,
          g.target,
          g.diceMode,
          g.turnSeconds,
          g.discardLimit,
          g.friendlyRobber,
          g.hideBank,
          g.public,
        ].join("|");
      if (settings(previous) !== settings(next))
        sounds.add("room_setting_updated");
      else if (
        next.players.some((p, i) => p.ready && !previous.players[i]?.ready)
      )
        sounds.add("room_get_ready");
    }
    if (needsMyAction(next)) sounds.add("your_turn");
    // Starting and changing rules replace the preview board. Those replacements
    // are not building or robber moves.
    return [...sounds];
  }
  if (previous.phase.startsWith("setup") && !next.phase.startsWith("setup"))
    sounds.add("settlement_phase_ended");
  if (
    Object.values(next.rollCounts).reduce((a, b) => a + b, 0) >
    Object.values(previous.rollCounts).reduce((a, b) => a + b, 0)
  ) {
    sounds.add(
      (["dice_roll_1", "dice_roll_2", "dice_roll_3", "dice_roll_4"] as const)[
        next.turn % 4
      ],
    );
  }
  for (const v of next.board.vertices) {
    const old = previous.board.vertices[v.id];
    if (!old) continue;
    if (v.owner !== null && old.owner === null)
      sounds.add(v.city ? "city_place" : "settlement_place");
    else if (v.city && !old.city) sounds.add("city_place");
    else if (!v.city && old.city) sounds.add("city_destroy");
  }
  const oldShips = previous.board.edges.filter(
    (e) => e.owner !== null && e.kind === "ship",
  );
  const newShips = next.board.edges.filter(
    (e) => e.owner !== null && e.kind === "ship",
  );
  const movedShip =
    oldShips.length === newShips.length &&
    oldShips.some((e) => next.board.edges[e.id]?.owner === null);
  if (movedShip) sounds.add("ship_move");
  for (const e of next.board.edges) {
    if (e.owner !== null && previous.board.edges[e.id]?.owner === null) {
      if (e.kind !== "ship") sounds.add("road_place");
      else if (!movedShip) sounds.add("ship_place");
    }
  }
  if (previous.board.robber !== next.board.robber) sounds.add("robber_place");
  if (previous.board.pirate !== next.board.pirate) sounds.add("pirate_place");
  if (next.deckCount < previous.deckCount) sounds.add("devcard_bought");
  if (next.longest !== null && next.longest !== previous.longest)
    sounds.add("achievement_longest_road");
  if (next.army !== null && next.army !== previous.army)
    sounds.add("achievement_largest_army");
  if (previous.cities && next.cities) {
    for (const k of next.cities.knights) {
      const old = previous.cities.knights.find(
        (o) => o.vertex === k.vertex && o.owner === k.owner,
      );
      if (!old) sounds.add("knight_place");
      else if (k.level > old.level) sounds.add("knight_upgrade");
      else if (k.active && !old.active) sounds.add("knight_equip");
    }
    if (next.cities.walls.some((v) => !previous.cities!.walls.includes(v)))
      sounds.add("city_wall_place");
    for (const track of ["science", "trade", "politics"] as const) {
      if (
        next.cities.metropolises[track]?.owner !==
          previous.cities.metropolises[track]?.owner &&
        next.cities.metropolises[track]
      )
        sounds.add("metropolis_place");
      if (
        next.cities.players.some(
          (p, i) =>
            p.improvements[track] >
            previous.cities!.players[i].improvements[track],
        )
      )
        sounds.add("city_improvement");
    }
    if (
      next.cities.players.some(
        (p, i) =>
          p.progressCount + p.revealed.length >
          previous.cities!.players[i].progressCount +
            previous.cities!.players[i].revealed.length,
      )
    )
      sounds.add("achievement_ck_progress");
  }
  // Logs are public action broadcasts. Match the suffix only after a known name;
  // chat or names containing words such as 'played' cannot trigger these cues.
  let overlap = Math.min(previous.log.length, next.log.length);
  while (
    overlap > 0 &&
    !previous.log.slice(-overlap).every((line, i) => line === next.log[i])
  )
    overlap--;
  if (overlap)
    for (const line of next.log.slice(overlap)) {
      for (const p of next.players)
        if (line.startsWith(`${p.name} `)) {
          const action = line.slice(p.name.length + 1);
          if (action.startsWith("played "))
            sounds.add(
              action.includes("monopoly") ? "devcard_monopoly" : "devcard_used",
            );
          if (action.startsWith("traded ")) sounds.add("offer_accepted");
          break;
        }
    }
  if (next.me >= 0) {
    if (next.discards[next.me] > 0 && !previous.discards[next.me])
      sounds.add("discard_notification");
    const mine = next.players[next.me];
    for (const offer of next.offers) {
      const old = previous.offers.find((o) => o.id === offer.id);
      const executor = tradeExecutor(offer, next.active);
      if (
        !old &&
        offer.from !== next.me &&
        tradeEligible(next, offer, next.me) &&
        !tradeBlocked(next, next.me, offer.from)
      ) {
        const wanted = executor === offer.from ? offer.want : offer.give;
        sounds.add(
          mine.hand &&
            GOODS.every((r) => (mine.hand![r] ?? 0) >= (wanted[r] ?? 0))
            ? "offer_acceptable"
            : "offer_not_acceptable",
        );
      }
      if (old && executor === next.me) {
        if (offer.accepted.some((p) => !old.accepted.includes(p)))
          sounds.add("offer_accepted");
        if (offer.rejected.some((p) => !old.rejected.includes(p)))
          sounds.add("offer_rejected");
      }
    }
    if (
      needsMyAction(next) &&
      (!needsMyAction(previous) || actionKey(previous) !== actionKey(next))
    )
      sounds.add("your_turn");
  }
  return [...sounds];
}
export function needsMyAction(g: View) {
  if (
    g.pause?.pausedAt != null ||
    g.me < 0 ||
    ["lobby", "finished"].includes(g.phase)
  )
    return false;
  if (g.phase === "discard") return (g.discards[g.me] ?? 0) > 0;
  if (g.phase === "gold") return (g.goldClaims[g.me] ?? 0) > 0;
  if (g.phase === "citiesChoice") return g.cities?.choice?.player === g.me;
  if (g.rush && g.phase === "action") return false;
  return (g.phase === "special" ? g.specialPlayer : g.active) === g.me;
}
function actionKey(g: View) {
  if (g.rush && !g.phase.startsWith("setup"))
    return `${g.phase}:${g.rush.seats[g.me]?.sequence ?? 0}`;
  // A roll's own action phase is continuous; choices and special turns are new work.
  return [
    g.turn,
    g.active,
    g.phase === "special" ? g.specialPlayer : null,
    g.phase === "citiesChoice" ? g.citiesChoiceSeq : null,
    ["discard", "gold"].includes(g.phase) ? g.phase : null,
  ].join("|");
}
