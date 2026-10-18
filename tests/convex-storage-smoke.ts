// Integration check for the isolated Convex storage deployment, not a browser
// or production capacity claim. Secrets come only from the ignored env file.
import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import {
  createGame,
  player,
  addPlayer,
  applyAction,
  type Game,
} from "../lib/game";

const url = process.env.NEXT_PUBLIC_CONVEX_URL!;
assert.equal(
  url,
  "http://127.0.0.1:3210",
  "Only the isolated migration dev deployment is allowed.",
);
const encoded = (data: unknown) =>
  Buffer.from(JSON.stringify(data)).toString("base64url");
const key = JSON.parse(process.env.STORAGE_JWT_PRIVATE_JWK!);
const now = Math.floor(Date.now() / 1000);
function jwt(role = "server", subject = "storage-server") {
  const input =
    encoded({ alg: "RS256", typ: "JWT", kid: key.kid }) +
    "." +
    encoded({
      iss: process.env.STORAGE_JWT_ISSUER,
      aud: "island-table",
      sub: subject,
      role,
      iat: now,
      exp: now + 600,
    });
  return (
    input +
    "." +
    sign(
      "RSA-SHA256",
      Buffer.from(input),
      createPrivateKey({ key, format: "jwk" }),
    ).toString("base64url")
  );
}
const backend = new ConvexHttpClient(url);
backend.setAuth(jwt());
const anonymous = new ConvexHttpClient(url);
const guest = new ConvexHttpClient(url);
guest.setAuth(jwt("player", "guest-proof"));
await assert.rejects(
  anonymous.query(api.rooms.list, { since: 0 }),
  /Unauthorized storage request/,
);
await assert.rejects(
  guest.query(api.rooms.list, { since: 0 }),
  /Unauthorized storage request/,
);
const sizes = [8, 8, 6, 4, 4],
  modes: Game["mode"][] = [
    "base",
    "base",
    "seafarers",
    "citiesKnights",
    "seafarersCitiesKnights",
  ];
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codes = sizes.map(() =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (n) => alphabet[n % alphabet.length],
  ).join(""),
);
for (let i = 0; i < sizes.length; i++) {
  const g = createGame(
    codes[i],
    player(`storage-qa-${i}-0`, `QA ${i}/0`),
    sizes[i],
    false,
    modes[i],
  );
  for (let p = 1; p < sizes[i]; p++)
    addPlayer(g, player(`storage-qa-${i}-${p}`, `QA ${i}/${p}`));
  await backend.mutation(api.rooms.insert, { state: JSON.stringify(g) });
}
const clients = sizes.flatMap((n, room) =>
  Array.from({ length: n }, (_, seat) => ({ room, seat })),
);
assert.equal(clients.length, 30);
let retries = 0;
await Promise.all(
  clients.map(async ({ room, seat }) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const stored = await backend.query(api.rooms.load, { code: codes[room] });
      assert(stored);
      const g = JSON.parse(stored.state) as Game;
      assert.equal(g.revision, stored.revision);
      applyAction(g, seat, { type: "ready" });
      if (
        await backend.mutation(api.rooms.save, {
          state: JSON.stringify(g),
          expectedRevision: stored.revision,
        })
      )
        return;
      retries++;
    }
    throw Error("Ready operation exhausted concurrency retries.");
  }),
);
for (let room = 0; room < sizes.length; room++) {
  const saved = await backend.query(api.rooms.load, { code: codes[room] });
  assert(saved);
  const g = JSON.parse(saved.state) as Game;
  assert(g.players.every((p) => p.ready));
  assert.equal(saved.revision, sizes[room]);
}
const times: number[] = [];
for (let wave = 0; wave < 10; wave++)
  await Promise.all(
    clients.map(async ({ room }) => {
      const start = performance.now();
      const result = await backend.query(api.rooms.load, { code: codes[room] });
      assert(result);
      times.push(performance.now() - start);
    }),
  );
times.sort((a, b) => a - b);
const result = {
  at: new Date().toISOString(),
  url,
  scope:
    "Convex storage integration only; 30 parallel server-side operations, not browser clients or full-stack load verification",
  modes,
  sizes,
  actors: clients.length,
  readyWrites: 30,
  conflictRetries: retries,
  reads: times.length,
  p50Ms: times[Math.floor(times.length * 0.5)],
  p95Ms: times[Math.floor(times.length * 0.95)],
  maxMs: times.at(-1),
  unauthenticatedReadRejected: true,
  playerTokenStorageReadRejected: true,
  allReadyAndRevisionsVerified: true,
  codes,
};
writeFileSync(
  ".sites-runtime/convex-storage-smoke.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
