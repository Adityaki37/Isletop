import assert from "node:assert/strict";
import type { View, Action } from "../lib/game";
import type { MatchSummary, ArchivedResult } from "../lib/match-history";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
const endpoint = new URL(origin);
assert(
  endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(endpoint.hostname),
);
class Session {
  cookie = "";
  async request(path: string, body?: Record<string, unknown>) {
    const response = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const jar = new Map(
      this.cookie
        .split("; ")
        .filter(Boolean)
        .map((pair) => {
          const i = pair.indexOf("=");
          return [pair.slice(0, i), pair.slice(i + 1)] as [string, string];
        }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0],
        i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    this.cookie = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
    const data = (await response.json()) as {
      game: View;
      error?: string;
      matches: MatchSummary[];
      next: { at: number; id: string } | null;
    } & ArchivedResult;
    return { status: response.status, data };
  }
  async room(body: Record<string, unknown>) {
    const r = await this.request("/api/rooms", body);
    assert.equal(r.status, 200, r.data.error);
    return r.data.game;
  }
  move(code: string, action: Action, nonce = crypto.randomUUID()) {
    return this.room({ op: "action", code, action, nonce });
  }
}
const host = new Session(),
  guest = new Session(),
  outsider = new Session();
const ids: string[] = [];
for (let n = 0; n < 22; n++) {
  let game = await host.room({
    op: "create",
    name: "History Host",
    capacity: 2,
    mode: "duel",
    public: false,
  });
  const code = game.code;
  if (n === 0 && process.env.TEST_ACCOUNT_HOST === "1") {
    const registered = await host.request("/api/accounts", {
      op: "register",
      username: `history_${crypto.randomUUID().slice(0, 8)}`,
      password: `History test passphrase ${crypto.randomUUID()}`,
    });
    assert.equal(registered.status, 201, registered.data.error);
  }
  await guest.room({ op: "join", code, name: "History Guest" });
  await guest.move(code, { type: "ready" });
  game = await host.move(code, { type: "start" });
  assert.equal(game.statistics, null);
  if (n === 0) {
    const requests = await Promise.all([
      host.request("/api/rooms", {
        op: "action",
        code,
        action: { type: "resign" },
        nonce: crypto.randomUUID(),
      }),
      guest.request("/api/rooms", {
        op: "action",
        code,
        action: { type: "resign" },
        nonce: crypto.randomUUID(),
      }),
    ]);
    assert.deepEqual(requests.map((r) => r.status).sort(), [200, 400]);
    game = requests.find((r) => r.status === 200)!.data.game;
  } else {
    const nonce = crypto.randomUUID();
    game = await host.move(code, { type: "resign" }, nonce);
    const duplicate = await host.move(code, { type: "resign" }, nonce);
    assert.deepEqual(duplicate.statistics, game.statistics);
  }
  assert.equal(game.phase, "finished");
  assert(game.statistics);
  const id = game.statistics.id;
  ids.push(id);
  const saved = await outsider.request(`/api/matches?match=${id}`);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.summary.winner, game.winner);
  assert.deepEqual(saved.data.game.statistics, game.statistics);
  assert(saved.data.game.players.every((p) => !("id" in p) && !p.hand));
  assert(
    !("deck" in saved.data.game) &&
      !("diceState" in saved.data.game) &&
      !("receipts" in saved.data.game),
  );
  assert.equal(saved.data.game.me, -1);
  await host.room({ op: "rematch", code });
  const after = await outsider.request(`/api/matches?match=${id}`);
  assert.deepEqual(
    after.data,
    saved.data,
    "Rematch cannot overwrite a saved result.",
  );
  await guest.room({ op: "leave", code });
  await host.room({ op: "leave", code });
}
for (const session of [host, guest]) {
  const first = await session.request("/api/matches");
  assert.equal(first.status, 200);
  assert.equal(first.data.matches.length, 20);
  assert(first.data.next);
  const next = first.data.next;
  const last = await session.request(
    `/api/matches?before=${next.at}&id=${next.id}`,
  );
  assert.equal(last.status, 200);
  assert.equal(last.data.matches.length, 2);
  assert.equal(last.data.next, null);
  const all = [...first.data.matches, ...last.data.matches];
  assert.equal(new Set(all.map((m) => m.id)).size, 22);
  assert.deepEqual(new Set(all.map((m) => m.id)), new Set(ids));
  const restored = new Session();
  restored.cookie = session.cookie;
  assert.deepEqual((await restored.request("/api/matches")).data, first.data);
}
assert.deepEqual(
  (await outsider.request("/api/matches?player_id=History%20Host")).data
    .matches,
  [],
);
assert.equal(
  (await outsider.request("/api/matches?match=invalid")).status,
  400,
);
assert.equal(
  (await outsider.request(`/api/matches?match=${crypto.randomUUID()}`)).status,
  404,
);
assert.equal(
  (await outsider.request("/api/matches?before=NaN&id=invalid")).status,
  400,
);
console.log(
  "PASS: 22 saved 1v1 resignation results; concurrent finishes, duplicate receipts, two-page histories, reconnect, outsider privacy, shared-result redaction, rematch retention and invalid queries.",
);
