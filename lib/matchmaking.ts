import { MAX_PLAYERS } from "./player-colors";
import { addPlayer, applyAction, createGame, player } from "./game";
import { normalizeAvatar } from "./avatars";
import { beginReplayCapture, takeReplayCapture } from "./match-replay";

import {
  MATCHMAKING_QUEUES,
  RANKED_QUEUES,
  isRankedQueue,
  matchmakingMap,
  type MatchmakingQueue,
  type QueuePlayer,
} from "./matchmaking-types";
import type { RankedSnapshot } from "./ranked-types";
export * from "./matchmaking-types";
// FIFO selects the human participants; the room uses the ordinary authoritative
// game engine, supplies, targets, statistics and recorder. Ranked games retain
// a private frozen rating snapshot for the atomic result settlement.
export function matchedGame(
  code: string,
  queue: MatchmakingQueue,
  seats: QueuePlayer[],
  now = Date.now(),
  ranked?: RankedSnapshot,
  map: import("./base-maps").BaseMap = "baseRandom",
) {
  const preset = MATCHMAKING_QUEUES[queue];
  if (
    seats.length !== preset.players ||
    new Set(seats.map((p) => p.id)).size !== seats.length
  )
    throw new Error("A match needs distinct human seats.");
  if (
    isRankedQueue(queue) &&
    (!ranked ||
      ranked.mode !== RANKED_QUEUES[queue].rankedMode ||
      ranked.seats.length !== seats.length)
  )
    throw Error("Ranked matches require frozen account ratings.");
  if (!isRankedQueue(queue) && ranked)
    throw Error("Casual games do not award rating.");
  const g = createGame(
    code,
    player(seats[0].id, seats[0].name, normalizeAvatar(seats[0].avatar)),
    preset.players,
    true,
    preset.mode,
    undefined,
    matchmakingMap(queue, map),
  );
  for (const p of seats.slice(1))
    addPlayer(g, player(p.id, p.name, normalizeAvatar(p.avatar)));
  const used = new Set<number>();
  g.players.forEach((p, i) => {
    const wanted = seats[i].color;
    p.color =
      Number.isInteger(wanted) && wanted >= 0 && wanted < MAX_PLAYERS && !used.has(wanted)
        ? wanted
        : Array.from({ length: MAX_PLAYERS }, (_, color) => color).find(
            (color) => !used.has(color),
          )!;
    used.add(p.color);
    p.ready = true;
  });
  g.title = `${isRankedQueue(queue) ? "Ranked" : "Casual"} ${preset.title}`;
  g.matchmaking = queue;
  g.turnSeconds = preset.seconds;
  if (ranked) {
    g.ranked = structuredClone(ranked);
    g.hideBank = true;
  }
  beginReplayCapture(g);
  try {
    applyAction(g, 0, { type: "start" }, undefined, now);
    const replay = takeReplayCapture(g);
    if (!replay?.initial || !replay.id || replay.frames.length !== 0)
      throw new Error("Unable to record the matched game.");
    return { game: g, replay };
  } finally {
    takeReplayCapture(g);
  }
}
