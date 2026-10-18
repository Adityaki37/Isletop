// Small functional regression against the isolated development deployment.
// This is not a load test or a cost/capacity measurement.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { api, storageClient, storageMutation } from "../lib/convex-client";
import { createGame, player } from "../lib/game";
const backend = storageClient();
assert.equal(
  process.env.NEXT_PUBLIC_CONVEX_URL,
  "http://127.0.0.1:3210",
);
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = Array.from(
  crypto.getRandomValues(new Uint8Array(6)),
  (n) => alphabet[n % alphabet.length],
).join("");
const g = createGame(
  code,
  player("efficiency-host", "Live QA 999/0"),
  2,
  false,
  "duel",
);
const args = (id: string, body: unknown) => ({
  code,
  player: id,
  account: null,
  session: null,
  avatar: "player",
  body: { op: "action", nonce: randomUUID(), ...(body as object) },
  checkClock: true,
});
const proof: { [key: string]: unknown } = {
  at: new Date().toISOString(),
  code,
  created: g.created,
};
try {
  await storageMutation(api.rooms.insert, { state: JSON.stringify(g) });
  const joined = await storageMutation(
    api.tableActions.act,
    args("efficiency-guest", { op: "join", name: "Guest" }),
  );
  assert(joined && joined.players.length === 2);
  await storageMutation(
    api.tableActions.act,
    args("efficiency-host", { action: { type: "ready" } }),
  );
  await storageMutation(
    api.tableActions.act,
    args("efficiency-guest", { action: { type: "ready" } }),
  );
  const start = await storageMutation(
    api.tableActions.act,
    args("efficiency-host", { action: { type: "start" } }),
  );
  assert(start && start.phase === "setupSettlement");
  const placement = args("efficiency-host", {
    action: { type: "settlement", id: start.legal.settlement[0] },
  });
  const placed = await storageMutation(api.tableActions.act, placement);
  assert(placed && placed.phase === "setupRoad");
  const duplicate = await storageMutation(api.tableActions.act, placement);
  assert(duplicate && duplicate.revision === placed.revision);
  const before = await backend.query(api.rooms.load, { code });
  await assert.rejects(
    storageMutation(
      api.tableActions.act,
      args("efficiency-guest", { action: { type: "roll" } }),
    ),
  );
  const after = await backend.query(api.rooms.load, { code });
  assert.equal(after?.state, before?.state);
  const finished = await storageMutation(
    api.tableActions.act,
    args("efficiency-host", { action: { type: "resign" } }),
  );
  assert(finished && finished.phase === "finished");
  const match = JSON.parse(
    (await backend.query(api.rooms.load, { code }))!.state,
  ).statistics.id;
  const first = await backend.query(api.history.replayPage, {
    match,
    share: null,
    players: ["efficiency-guest"],
  });
  assert(first && first.initial && first.summary);
  assert(first.frames.length > 0);
  const cursor = first.initialSequence;
  const compact = await backend.query(api.history.replayPage, {
    match,
    share: null,
    players: ["efficiency-guest"],
    after: cursor,
    includeHeader: false,
  });
  assert(compact && !("initial" in compact) && !("summary" in compact));
  assert.deepEqual(compact.frames, first.frames);
  const old = await backend.query(api.history.replayPage, {
    match,
    share: null,
    players: ["efficiency-guest"],
    after: cursor,
  });
  assert(old && old.initial && old.summary);
  assert.equal(
    await backend.query(api.history.replayPage, {
      match,
      share: null,
      players: ["other-player"],
      after: cursor,
      includeHeader: false,
    }),
    null,
  );
  Object.assign(proof, {
    ordinaryFastMoves: true,
    nonceRetryDidNotDuplicateMove: true,
    invalidMoveDidNotWrite: true,
    replayFramesIdentical: true,
    replayOldContract: true,
    replayPrivacy: true,
    fullPageBytes: Buffer.byteLength(JSON.stringify(first)),
    compactPageBytes: Buffer.byteLength(JSON.stringify(compact)),
    replayFrames: first.frames.length,
  });
} finally {
  await storageMutation(api.inspection.cleanupLoadRooms, {
    rooms: [{ code, created: g.created }],
  });
  proof.roomCleaned = (await backend.query(api.rooms.load, { code })) === null;
  writeFileSync(
    ".sites-runtime/efficiency-verification.json",
    JSON.stringify(proof, null, 2) + "\n",
  );
}
console.log(JSON.stringify(proof));
