// Minimal real-backend local smoke. Refuses cloud URLs before constructing clients.
// This is not a load test or a cost/capacity measurement.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ConvexClient } from "convex/browser";
import {
  api,
  storageClient,
  storageMutation,
  tableSessionToken,
} from "../lib/convex-client";
import {
  createGame,
  player,
  actor,
  view,
  type Game,
  type View,
} from "../lib/game";
assert(process.env.CONVEX_DEPLOYMENT?.startsWith("local:"));
const localUrl = new URL(process.env.NEXT_PUBLIC_CONVEX_URL!);
assert.equal(localUrl.protocol, "http:");
assert(["127.0.0.1", "localhost", "[::1]"].includes(localUrl.hostname));
const backend = storageClient();
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
  backend: localUrl.origin,
  cloudFunctionTraffic: false,
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
    args("efficiency-host", { action: { type: "settings", turnSeconds: 15 } }),
  );
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
  const opening = JSON.parse((await backend.query(api.rooms.load, { code }))!.state) as Game;
  const firstPlayer = opening.players[actor(opening)].id;
  const firstView = view(opening, firstPlayer);
  const placement = args(firstPlayer, {
    action: { type: "settlement", id: firstView.legal.settlement[0] },
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
  const live = new ConvexClient(localUrl.origin);
  live.setAuth(async () => tableSessionToken("efficiency-guest"));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Local subscription timed out")),
        10000,
      );
      live.onUpdate(
        api.roomViews.table,
        { code },
        (value) => {
          try {
            const v = value as View;
            assert(v && v.me === 1);
            assert(
              v.players.every((p, i) => !("id" in p) && !!p.hand === (i === 1)),
            );
            assert(!("deck" in v) && !("diceState" in v));
            clearTimeout(timeout);
            resolve();
          } catch (e) {
            clearTimeout(timeout);
            reject(e);
          }
        },
        (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      );
    });
    proof.realWebSocketPrivateProjection = true;
  } finally {
    await live.close();
  }
  let raw = JSON.parse(
    (await backend.query(api.rooms.load, { code }))!.state,
  ) as Game;
  while (raw.phase.startsWith("setup")) {
    const own = raw.players[actor(raw)].id;
    const v = view(raw, own);
    await storageMutation(
      api.tableActions.act,
      args(own, {
        action:
          raw.phase === "setupSettlement"
            ? { type: "settlement", id: v.legal.settlement[0] }
            : { type: "road", id: v.legal.road[0] },
      }),
    );
    raw = JSON.parse((await backend.query(api.rooms.load, { code }))!.state);
  }
  assert.equal(raw.phase, "roll");
  assert(raw.deadline);
  const revision = raw.revision;
  await new Promise((r) =>
    setTimeout(r, Math.max(0, raw.deadline! - Date.now()) + 1500),
  );
  const advanced = JSON.parse(
    (await backend.query(api.rooms.load, { code }))!.state,
  ) as Game;
  assert(advanced.revision > revision && advanced.phase !== "roll");
  proof.schedulerAdvancedWithoutClients = true;
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
    ".sites-runtime/local-convex-verification.json",
    JSON.stringify(proof, null, 2) + "\n",
  );
}
console.log(JSON.stringify(proof));
