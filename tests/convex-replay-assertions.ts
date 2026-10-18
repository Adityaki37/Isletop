import assert from "node:assert/strict";
import { api, storageClient } from "../lib/convex-client";
import type { Game } from "../lib/game";
import {
  applyReplayPatch,
  replayState,
  type ReplayState,
  type ReplayFrame,
} from "../lib/match-replay";
const states = new Map<string, { sequence: number; state: ReplayState }>();
export async function assertConvexReplay(g: Game) {
  const id = g.statistics!.id,
    previous = states.get(id);
  const saved = (await storageClient().query(api.inspection.read, {
    op: "replay",
    key: id,
    after: previous?.sequence ?? -1,
  })) as {
    header: {
      initial: string;
      initialSequence: number;
      lastSequence: number;
      complete: boolean;
    } | null;
    frames: { sequence: number; frame: string }[];
  };
  assert(saved.header, "Every started HTTP game has a persisted replay.");
  assert(saved.header.complete);
  assert(saved.header.lastSequence >= g.replaySequence);
  let snapshot = previous ?? {
    sequence: saved.header.initialSequence,
    state: JSON.parse(saved.header.initial) as ReplayState,
  };
  for (const r of saved.frames.filter((r) => r.sequence <= g.replaySequence)) {
    const frame = JSON.parse(r.frame) as ReplayFrame;
    assert.equal(frame.sequence, snapshot.sequence + 1);
    snapshot = {
      sequence: frame.sequence,
      state: applyReplayPatch(snapshot.state, frame.patch),
    };
    for (const p of g.players)
      assert(!r.frame.includes(p.id), "Replay contains no session identity.");
  }
  assert.equal(snapshot.sequence, g.replaySequence);
  assert.deepEqual(
    snapshot.state,
    replayState(g),
    "Persisted replay reconstructs the historical game snapshot.",
  );
  states.set(id, snapshot);
}
