// Real profile writes through HTTP; trusted Convex reads verify the rating ledger.
// Uses local accounts produced by the completed Ranked-game proof.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { api, storageClient } from "../lib/convex-client";
import type { AccountProfile } from "../lib/account-types";
import type { LeaderboardData, RankedProfileData } from "../lib/ranked-types";
import { EMPTY_REGION } from "../lib/regions";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
async function ratingLedger() {
  const data = (await storageClient().query(api.inspection.read, {
    op: "ratings",
    key: "",
  })) as { ratings: Record<string, unknown>[] };
  return data.ratings.sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
}
const credentials = JSON.parse(
  readFileSync(".sites-runtime/ranked-browser-accounts.json", "utf8"),
) as { username: string; password: string }[];
class Session {
  jar = new Map<string, string>();
  async request<T>(
    path: string,
    body?: unknown,
    status = 200,
    extra: Record<string, string> = {},
  ) {
    const r = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: [...this.jar.values()].join("; "),
        ...(body === undefined
          ? {}
          : { Origin: origin, "Content-Type": "application/json" }),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    for (const c of r.headers.getSetCookie()) {
      const pair = c.split(";")[0];
      this.jar.set(pair.split("=")[0], pair);
    }
    const result = (await r.json()) as T & { error?: string };
    assert.equal(r.status, status, `${path}: ${result.error}`);
    assert.equal(r.headers.get("cache-control"), "no-store");
    return result;
  }
  async region(region: unknown, status = 200) {
    return this.request<{ account: AccountProfile }>(
      "/api/accounts",
      { op: "region", region },
      status,
    );
  }
}
const sessions = credentials.map(() => new Session()),
  guest = new Session();
for (const [i, s] of sessions.entries())
  await s.request("/api/accounts", { op: "login", ...credentials[i] });
const before = await ratingLedger();
const boards = await guest.request<LeaderboardData>(
  "/api/leaderboards?mode=duel",
);
const placed = credentials
  .slice(0, 2)
  .map((c, i) => ({
    i,
    row: boards.rows.find((r) => r.username === c.username)!,
  }))
  .sort((a, b) => b.row.rating! - a.row.rating!);
assert(placed.every((p) => p.row.rating !== null && p.row.games >= 10));
const high = placed[0],
  low = placed[1],
  us = { continentCode: "NA", countryCode: "US", regionCode: "OH" },
  ca = { continentCode: "NA", countryCode: "CA", regionCode: "ON" };
assert(high.row.rating! > low.row.rating!);
await sessions[low.i].region(us);
await sessions[high.i].region(ca);
await sessions[2].region(us);
const publicProfile = await guest.request<{ account: AccountProfile }>(
  "/api/accounts?username=" + low.row.username,
);
assert.deepEqual(publicProfile.account.region, us);
assert.deepEqual(Object.keys(publicProfile.account).sort(), [
  "avatar",
  "bio",
  "color",
  "createdAt",
  "displayName",
  "region",
  "username",
]);
for (const invalid of [
  null,
  [],
  { countryCode: "ZZ" },
  { countryCode: "US", continentCode: "EU" },
  { countryCode: "US", regionCode: "ON" },
  { regionCode: "OH" },
  { countryCode: "US' OR 1=1--" },
])
  await sessions[low.i].region(invalid, 400);
await guest.region(us, 401);
await sessions[low.i].request(
  "/api/accounts",
  { op: "region", region: ca },
  403,
  { Origin: "https://other.example" },
);
assert.deepEqual(
  (await sessions[low.i].request<{ account: AccountProfile }>("/api/accounts"))
    .account.region,
  us,
);
for (const q of [
  "country=ZZ",
  "country=US&continent=EU",
  "country=CA&region=OH",
  "region=OH",
  "country=__proto__",
])
  await guest.request("/api/leaderboards?" + q, undefined, 400);
await sessions[low.i].request(
  "/api/leaderboards?friends=1&country=US",
  undefined,
  400,
);
const country = await sessions[low.i].request<LeaderboardData>(
  "/api/leaderboards?mode=duel&country=us",
);
assert(
  country.rows.some((p) => p.username === low.row.username && p.rank === 1),
);
assert(
  !country.rows.some(
    (p) =>
      p.username === high.row.username ||
      p.username === credentials[2].username,
  ),
);
assert.deepEqual(country.region, { ...us, regionCode: "" });
assert.equal(country.me?.rank, 1);
const outside = await sessions[high.i].request<LeaderboardData>(
  "/api/leaderboards?mode=duel&country=US",
);
assert.equal(outside.me?.rank, null);
assert.equal(outside.me?.rating, high.row.rating);
const placement = await sessions[2].request<LeaderboardData>(
  "/api/leaderboards?mode=duel&country=US",
);
assert.equal(placement.me?.rating, null);
assert.equal(placement.me?.rank, null);
const both = await guest.request<LeaderboardData>(
  "/api/leaderboards?mode=duel&continent=NA",
);
assert(both.rows.some((p) => p.username === high.row.username));
assert(both.rows.some((p) => p.username === low.row.username));
await sessions[high.i].region({ ...us, regionCode: "CA" });
const updated = await sessions[low.i].request<LeaderboardData>(
  "/api/leaderboards?mode=duel&country=US&search=" + low.row.username,
);
assert.equal(updated.rows[0].username, low.row.username);
assert.equal(updated.rows[0].rank, 2);
assert.equal(updated.me?.rank, 2);
const state = await sessions[low.i].request<LeaderboardData>(
  "/api/leaderboards?mode=duel&country=US&region=OH",
);
assert.equal(state.rows.find((p) => p.username === low.row.username)?.rank, 1);
assert(!state.rows.some((p) => p.username === high.row.username));
const blank = await guest.request<LeaderboardData>(
  "/api/leaderboards?mode=duel&country=NZ",
);
assert.equal(blank.total, 0);
const literal = await guest.request<LeaderboardData>(
  "/api/leaderboards?mode=duel&country=US&search=%25",
);
assert.equal(literal.total, 0);
const ranked = await guest.request<RankedProfileData>(
  "/api/leaderboards?profile=" + low.row.username,
);
assert.equal(ranked.ratings.find((p) => p.mode === "duel")?.rank, low.row.rank);
assert(
  ranked.ratings
    .filter((p) => p.mode !== "duel")
    .every((p) => p.rating === null),
);
const original = (
  await sessions[low.i].request<{ account: AccountProfile }>("/api/accounts")
).account;
await sessions[low.i].request("/api/accounts", {
  op: "profile",
  displayName: original.displayName,
  bio: original.bio,
  color: original.color,
  avatar: original.avatar,
});
assert.deepEqual(
  (await sessions[low.i].request<{ account: AccountProfile }>("/api/accounts"))
    .account.region,
  us,
);
await sessions[high.i].region(EMPTY_REGION);
const removed = await guest.request<LeaderboardData>(
  "/api/leaderboards?mode=duel&country=US",
);
assert(!removed.rows.some((p) => p.username === high.row.username));
await sessions[high.i].region(ca);
assert.deepEqual(await ratingLedger(), before);
writeFileSync(
  ".sites-runtime/regions-api-proof.json",
  JSON.stringify(
    {
      passed: true,
      profilePublic: true,
      regionRankBeforeSearch: true,
      placementPrivacy: true,
      ratingLedgerUnchanged: true,
      low: low.row.username,
      high: high.row.username,
      rows: country.rows.length,
    },
    null,
    2,
  ),
);
console.log(
  "PASS: regional profiles, hierarchy validation, continent/country/state ranks, search, removal, placement privacy and unchanged rating ledger.",
);
