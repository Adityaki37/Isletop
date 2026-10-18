import { api, storageClient, storageMutation } from "./convex-client";
import { accountRead, storageOperation, AuthError } from "./account-store";
import { normalizeGame, type Game } from "./game";
import type { ReplayCapture, ReplayPage } from "./match-replay";
import type { MatchSummary } from "./match-history";
export async function loadRoom(code: string) {
  const row = await storageClient().query(api.rooms.load, { code });
  if (!row) return null;
  const g = JSON.parse(row.state) as Game;
  g.revision = row.revision;
  return normalizeGame(g);
}
export async function insertRoom(g: Game) {
  await storageMutation(api.rooms.insert, { state: JSON.stringify(g) });
}
export async function saveRoom(
  g: Game,
  revision: number,
  _previous?: Game,
  replay?: ReplayCapture,
) {
  g.revision = revision + 1;
  g.updated = Date.now();
  return storageMutation(api.rooms.save, {
    state: JSON.stringify(g),
    expectedRevision: revision,
    ...(replay ? { replay: JSON.stringify(replay) } : {}),
  });
}
const historyPlayers = (player: string) =>
  accountRead("historyAliases", { player }) as Promise<string[]>;
export async function loadReplayPage(
  playerId: string | null,
  match: string | null,
  share: string | null,
  after?: number,
  includeHeader = true,
) {
  const players = playerId ? await historyPlayers(playerId) : [];
  try {
    return (await storageOperation(() =>
      storageClient().query(api.history.replayPage, {
        players,
        match,
        share,
        ...(after !== undefined ? { after } : {}),
        includeHeader,
      }),
    )) as
      | (Omit<ReplayPage, "initial"> & {
          initial?: ReplayPage["initial"];
          summary?: MatchSummary;
        })
      | null;
  } catch (e) {
    if (e instanceof AuthError && e.status === 400)
      throw new RangeError(e.message);
    throw e;
  }
}
export async function shareReplay(match: string, playerId: string) {
  return storageMutation(api.history.shareReplay, {
    match,
    players: await historyPlayers(playerId),
    share: crypto.randomUUID(),
  });
}
export async function listMatches(
  playerId: string,
  before?: { at: number; id: string },
) {
  return storageClient().query(api.history.list, {
    players: await historyPlayers(playerId),
    ...(before ? { before } : {}),
  });
}
export async function loadMatch(match: string) {
  return storageClient().query(api.history.result, { match });
}
export async function listRooms() {
  const rows = (
    await storageClient().query(api.rooms.list, {
      since: Date.now() - 86400000,
    })
  ).map((r) => JSON.parse(r));
  const summary = (g: Record<string, unknown>) => {
    const { phase, ...data } = g;
    return data;
  };
  return {
    rooms: rows
      .filter((g) => g.phase === "lobby" && g.players < g.capacity)
      .slice(0, 20)
      .map(summary),
    games: rows
      .filter((g) => g.phase !== "lobby" && g.phase !== "finished")
      .slice(0, 20)
      .map(summary),
  };
}
