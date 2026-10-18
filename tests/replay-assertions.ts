import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import type { Game } from "../lib/game";
import {
  applyReplayPatch,
  beginReplayCapture,
  takeReplayCapture,
  recordReplayFrame,
  replayState,
  ReplayTimeline,
  type ReplayFrame,
  type ReplayPage,
  type ReplayState,
} from "../lib/match-replay";
const states = new Map<string, { sequence: number; state: ReplayState }>();
export function assertRecordedTransition(g: Game, perform: () => void) {
  beginReplayCapture(g);
  perform();
  recordReplayFrame(g, null, { type: "system" }, 100000);
  const capture = takeReplayCapture(g)!;
  let state = structuredClone(capture.initial!);
  for (const frame of capture.frames)
    state = applyReplayPatch(state, frame.patch);
  assert.deepEqual(state, replayState(g));
}
export function assertPersistedReplay(g: Game, db: DatabaseSync) {
  const id = g.statistics!.id;
  const header = db
    .prepare(
      "SELECT initial, initial_sequence, last_sequence, complete FROM match_replays WHERE id = ?",
    )
    .get(id) as {
    initial: string;
    initial_sequence: number;
    last_sequence: number;
    complete: number;
  };
  assert(header, "Each started HTTP game has a replay header.");
  assert.equal(header.complete, 1);
  assert.equal(header.last_sequence, g.replaySequence);
  let previous = states.get(id);
  if (!previous) {
    previous = {
      sequence: header.initial_sequence,
      state: JSON.parse(header.initial),
    };
    states.set(id, previous);
  }
  const rows = db
    .prepare(
      "SELECT frame FROM replay_events WHERE match_id = ? AND sequence > ? ORDER BY sequence",
    )
    .all(id, previous.sequence) as { frame: string }[];
  for (const row of rows) {
    const frame = JSON.parse(row.frame) as ReplayFrame;
    assert.equal(frame.sequence, previous.sequence + 1);
    previous.state = applyReplayPatch(previous.state, frame.patch);
    previous.sequence = frame.sequence;
    for (const player of g.players)
      assert(
        !row.frame.includes(player.id),
        "Replay frames contain no guest session identifiers.",
      );
  }
  assert.equal(previous.sequence, header.last_sequence);
  assert.deepEqual(
    previous.state,
    replayState(g),
    "Persisted replay reconstructs the exact current historical state.",
  );
}
export async function assertFinishedReplay(
  origin: string,
  cookie: string,
  g: Game,
  share = false,
) {
  const id = g.statistics!.id,
    frames: ReplayFrame[] = [];
  let first: ReplayPage | null = null,
    after: number | null = null;
  do {
    const response: Response = await fetch(
      `${origin}/api/replays?match=${id}${after === null ? "" : `&after=${after}`}`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(response.status, 200);
    const page = (await response.json()) as ReplayPage;
    first ??= page;
    frames.push(...page.frames);
    after = page.next;
  } while (after !== null);
  assert(first && first.complete);
  assert.equal(frames.length, g.replaySequence);
  assert.deepEqual(
    new ReplayTimeline(first.initial, frames).stateAt(frames.length),
    replayState(g),
  );
  assert.equal(
    (await fetch(`${origin}/api/replays?match=${id}`)).status,
    404,
    "Result IDs do not reveal private replays to outsiders.",
  );
  let shareId: string | null = null;
  if (share) {
    const response = await fetch(`${origin}/api/replays`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: JSON.stringify({ match: id }),
    });
    assert.equal(response.status, 200);
    shareId = ((await response.json()) as { share: string }).share;
    const publicResponse = await fetch(
      `${origin}/api/replays?share=${shareId}`,
    );
    assert.equal(publicResponse.status, 200);
  }
  return { first, frames, shareId };
}
