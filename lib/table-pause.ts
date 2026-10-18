import type { Action, Game } from "./game";
import { appendGameLog } from "./game-log";

export const PAUSE_VOTE_MS = 30000;
export const PAUSE_REQUEST_COOLDOWN = 15000;
export type PauseVote = {
  id: number;
  target: "pause" | "resume";
  creator: number;
  accepted: number[];
  endsAt: number;
};
export type TablePause = {
  pausedAt: number | null;
  // Retained for old saved games; pauses no longer have an expiry.
  until: number | null;
  vote: PauseVote | null;
  sequence: number;
};
export const createTablePause = (): TablePause => ({
  pausedAt: null,
  until: null,
  vote: null,
  sequence: 0,
});
const log = appendGameLog;
const requirePause = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message);
};
const shifted = (time: number | null, elapsed: number) =>
  time === null ? null : time + elapsed;

function resume(g: Game, at: number) {
  const elapsed = Math.max(0, at - g.pause.pausedAt!);
  g.deadline = shifted(g.deadline, elapsed);
  for (const memory of Object.values(g.botTradeMemory ?? {}))
    memory.startedAt += elapsed;
  for (const offer of g.offers) {
    for (const seat in offer.responseDeadlines)
      offer.responseDeadlines[seat] = shifted(
        offer.responseDeadlines[seat],
        elapsed,
      );
    for (const seat in offer.preparingUntil)
      offer.preparingUntil[seat] += elapsed;
    offer.closeAt = shifted(offer.closeAt, elapsed);
    offer.pausedAt = shifted(offer.pausedAt, elapsed);
  }
  if (g.rush) {
    for (const key of [
      "rollAt",
      "discardUntil",
      "robberUntil",
      "pausedAt",
    ] as const)
      g.rush[key] = shifted(g.rush[key], elapsed);
    for (const seat of g.rush.seats) seat.until = shifted(seat.until, elapsed);
  }
  g.pause.pausedAt = null;
  g.pause.until = null;
  g.pause.vote = null;
  g.pause.sequence++;
  log(g, "The game resumed.");
}
function succeed(g: Game, target: PauseVote["target"], now: number) {
  g.pause.vote = null;
  if (target === "resume") resume(g, now);
  else {
    g.pause.pausedAt = now;
    g.pause.until = null;
    g.pause.sequence++;
    log(g, "The game paused.");
  }
}
export function needsPauseUpdate(
  g: Pick<Game, "pause" | "phase">,
  now = Date.now(),
) {
  return (
    !!g.pause &&
    ((g.phase === "finished" &&
      (g.pause.pausedAt !== null || g.pause.vote !== null)) ||
      (g.pause.vote !== null && g.pause.vote.endsAt <= now))
  );
}
export function advancePause(g: Game, now: number) {
  if (g.phase === "finished") {
    if (g.pause.vote || g.pause.pausedAt !== null)
      log(g, "Pause voting ended because the game finished.");
    g.pause.pausedAt = null;
    g.pause.until = null;
    g.pause.vote = null;
    return;
  }
  if (g.pause.vote && g.pause.vote.endsAt <= now) {
    log(
      g,
      `The vote to ${g.pause.vote.target} expired without everyone's agreement.`,
    );
    g.pause.vote = null;
  }
}
export function isPauseAction(a: Action | null | undefined) {
  return (
    a?.type === "pauseRequest" ||
    a?.type === "pauseVote" ||
    (a?.type === "chat" &&
      typeof a.text === "string" &&
      a.text.trim() === "/pause")
  );
}
export function performPauseAction(
  g: Game,
  seat: number,
  a: Action,
  now: number,
) {
  requirePause(g.players[seat], "Only seated players can vote.");
  requirePause(
    !["lobby", "finished"].includes(g.phase),
    "Pause voting is available during a game.",
  );
  if (a.type === "pauseVote") {
    const vote = g.pause.vote;
    requirePause(
      vote && a.id === vote.id,
      "That vote has ended. Refresh the table.",
    );
    requirePause(
      typeof a.accept === "boolean",
      "Choose whether to accept the vote.",
    );
    requirePause(
      !vote!.accepted.includes(seat),
      "Your vote has already been recorded.",
    );
    if (!a.accept) {
      log(g, `${g.players[seat].name} declined the vote to ${vote!.target}.`);
      g.pause.vote = null;
      return;
    }
    vote!.accepted.push(seat);
    if (vote!.accepted.length === g.players.length)
      succeed(g, vote!.target, now);
    return;
  }
  requirePause(!g.pause.vote, "A pause or resume vote is already open.");
  const target = g.pause.pausedAt === null ? "pause" : "resume";
  if (target === "pause") {
    requirePause(
      (g.pauseCooldowns[seat] ?? 0) <= now,
      "Wait before requesting another pause vote.",
    );
    g.pauseCooldowns[seat] = now + PAUSE_REQUEST_COOLDOWN;
  }
  const vote: PauseVote = {
    id: ++g.pause.sequence,
    target,
    creator: seat,
    accepted: [
      ...new Set([
        seat,
        ...g.players.flatMap((p, i) =>
          p.bot || g.botPlayers.includes(i) ? [i] : [],
        ),
      ]),
    ],
    endsAt: now + PAUSE_VOTE_MS,
  };
  log(g, `${g.players[seat].name} requested a vote to ${target}.`);
  if (vote.accepted.length === g.players.length) succeed(g, target, now);
  else g.pause.vote = vote;
}
