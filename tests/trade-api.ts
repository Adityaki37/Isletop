import assert from "node:assert/strict";
import { Action, Game, View, actor } from "../lib/game";
import { Hand, Resource, RESOURCES, emptyHand } from "../lib/board";
import { chooseMove } from "./autoplay";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
class Session {
  cookie = "";
  async request(body: unknown, code = "") {
    const r = await fetch(`${origin}/api/rooms${body ? "" : `?code=${code}`}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body ? { Origin: origin, "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const cookie = r.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    return {
      status: r.status,
      ...((await r.json()) as { game: View; error?: string }),
    };
  }
  async move(code: string, action: Action, nonce = crypto.randomUUID()) {
    return this.request({ op: "action", code, action, nonce });
  }
}
const seats = Array.from({ length: 8 }, () => new Session()),
  spectator = new Session();
const made = await seats[0].request({
  op: "create",
  name: "Trade API QA",
  capacity: 8,
  public: false,
});
assert.equal(made.status, 200, made.error);
const code = made.game.code;
const move = async (p: number, action: Action) => {
  const r = await seats[p].move(code, action);
  assert.equal(r.status, 200, `${action.type}: ${r.error}`);
  return r.game;
};
await move(0, { type: "settings", turnSeconds: 0 });
for (let p = 1; p < 8; p++) {
  assert.equal(
    (await seats[p].request({ op: "join", code, name: `Trade QA ${p}` }))
      .status,
    200,
  );
}
// Joining regenerates the board and clears prior readiness; ready after seating.
for (let p = 1; p < 8; p++) await move(p, { type: "ready" });
let g = await move(0, { type: "start" });
let hands: Hand[] = [],
  giveResource: Resource = RESOURCES[0],
  wantResource: Resource = RESOURCES[1],
  partners: number[] = [];
for (let step = 0; step < 500; step++) {
  if (g.phase === "action" && g.active === 0) {
    const views = await Promise.all(seats.map((s) => s.request(null, code)));
    hands = views.map((r, p) => r.game.players[p].hand!);
    for (const r of RESOURCES.filter((r) => hands[0][r] > 0)) {
      for (const w of RESOURCES.filter((w) => w !== r)) {
        const choices = hands.flatMap((h, p) => (p > 0 && h[w] > 0 ? [p] : []));
        if (choices.length >= 2) {
          giveResource = r;
          wantResource = w;
          partners = choices.slice(0, 2);
          break;
        }
      }
      if (partners.length) break;
    }
    if (partners.length) break;
  }
  const p =
    g.phase === "discard"
      ? Number(Object.keys(g.discards)[0])
      : actor(g as unknown as Game);
  const mine = (await seats[p].request(null, code)).game;
  const proxy = {
    ...mine,
    players: mine.players.map((pl) => ({
      ...pl,
      hand: pl.hand ?? emptyHand(),
      dev: pl.dev ?? [],
    })),
    deck: [],
  } as unknown as Game;
  const action =
    mine.phase === "action"
      ? { type: "end" }
      : mine.phase === "special"
        ? { type: "pass" }
        : chooseMove(proxy, p);
  assert(action);
  g = await move(p, action!);
}
assert.equal(
  partners.length,
  2,
  "Real starting hands/dice must supply two willing partners.",
);
const give = { ...emptyHand(), [giveResource]: 1 },
  want = { ...emptyHand(), [wantResource]: 1 };
const before = hands.map((h) => ({ ...h }));
// Untimed turns still expire unanswered offers. A held offer survives both the
// response deadline and the cleanup grace; deadlines never expose other hands.
await move(partners[1], { type: "tradePreference", autoReject: false });
g = await move(0, { type: "offer", give, want, targets: [partners[0]] });
const expiring = g.offers.at(-1)!.id;
g = await move(0, { type: "offer", give, want, targets: [partners[1]] });
const held = g.offers.at(-1)!.id;
const recipient = (await seats[partners[0]].request(null, code)).game;
const deadline = recipient.offers.find(
  (o) => o.id === expiring,
)!.responseDeadline!;
assert(deadline > Date.now());
assert.equal(recipient.players[partners[0]].autoRejectTrades, true);
assert(
  recipient.players.every(
    (p, i) => i === partners[0] || p.autoRejectTrades === undefined,
  ),
);
const publicView = (await spectator.request(null, code)).game;
assert(
  publicView.offers.every(
    (o) =>
      o.responseDeadline === null &&
      !("responseDeadlines" in o) &&
      !("preparingUntil" in o),
  ),
);
assert.equal(
  (await seats[partners[1]].move(code, { type: "accept", id: expiring }))
    .status,
  400,
);
console.log("Waiting for real untimed-room trade expiry (20 seconds)...");
await new Promise((resolve) =>
  setTimeout(resolve, Math.max(0, deadline - Date.now()) + 150),
);
g = (await spectator.request(null, code)).game;
assert(g.offers.find((o) => o.id === expiring)!.expired.includes(partners[0]));
assert.equal(g.offers.find((o) => o.id === held)!.responseDeadline, null);
await new Promise((resolve) => setTimeout(resolve, 2150));
g = (await spectator.request(null, code)).game;
assert(!g.offers.some((o) => o.id === expiring));
assert(g.offers.some((o) => o.id === held));
g = await move(partners[1], { type: "tradePreference", autoReject: true });
assert(
  g.offers.find((o) => o.id === held)!.responseDeadline! > Date.now() + 19000,
);
await move(0, { type: "cancelOffer", id: held });
for (let p = 1; p < 8; p++)
  await move(p, { type: "tradePreference", autoReject: false });

g = await move(0, { type: "offer", give, want, targets: partners });
const selected = g.offers.at(-1)!.id;
const outside = Array.from({ length: 8 }, (_, i) => i).find(
  (p) => p > 0 && !partners.includes(p),
)!;
assert.equal(
  (
    await seats[outside].move(code, {
      type: "counterOffer",
      id: selected,
      give: want,
      want: give,
    })
  ).status,
  400,
);
await move(partners[0], { type: "accept", id: selected });
g = await move(0, { type: "embargo", to: partners[0], blocked: true });
assert(g.offers[0].blocked.includes(partners[0]));
assert(!g.offers[0].accepted.includes(partners[0]));
assert.equal(
  (await seats[partners[0]].move(code, { type: "accept", id: selected }))
    .status,
  400,
);
await move(0, { type: "embargo", to: partners[0], blocked: false });
assert.equal(
  (
    await seats[0].move(code, {
      type: "completeTrade",
      id: selected,
      to: partners[0],
    })
  ).status,
  400,
);
g = await move(partners[0], {
  type: "counterOffer",
  id: selected,
  give: want,
  want: give,
});
const joinedCounter = g.offers.at(-1)!;
assert.deepEqual(joinedCounter.targets, partners);
assert.equal(
  (await seats[outside].move(code, { type: "accept", id: joinedCounter.id }))
    .status,
  400,
);
await move(partners[1], { type: "accept", id: joinedCounter.id });
g = await move(0, {
  type: "completeTrade",
  id: joinedCounter.id,
  to: partners[1],
});
assert.equal(
  (await seats[partners[0]].request(null, code)).game.players[partners[0]]
    .hand![wantResource],
  before[partners[0]][wantResource],
);
assert.equal(
  (await seats[partners[1]].request(null, code)).game.players[partners[1]]
    .hand![giveResource],
  before[partners[1]][giveResource] + 1,
);
g = await move(0, {
  type: "offer",
  give: want,
  want: give,
  targets: [partners[1]],
});
await move(partners[1], { type: "accept", id: g.offers[0].id });
await move(0, { type: "completeTrade", id: g.offers[0].id, to: partners[1] });
for (let p = 0; p < 8; p++)
  assert.deepEqual(
    (await seats[p].request(null, code)).game.players[p].hand,
    before[p],
  );

g = await move(0, { type: "offer", give, want });
const old = g.offers.at(-1)!.id;
await move(partners[0], { type: "prepareCounter", id: old, preparing: true });
assert.deepEqual(
  (await spectator.request(null, code)).game.offers[0].preparing,
  [partners[0]],
);
await move(partners[0], { type: "prepareCounter", id: old, preparing: false });
await move(partners[0], { type: "accept", id: old });
g = await move(0, { type: "editOffer", id: old, give, want });
const edited = g.offers.at(-1)!.id;
assert.notEqual(old, edited);
assert.deepEqual(g.offers[0].accepted, []);
assert.equal(
  (
    await seats[partners[0]].move(code, {
      type: "counterOffer",
      id: old,
      give: want,
      want: give,
    })
  ).status,
  400,
);
assert.equal(
  (
    await spectator.request({
      op: "action",
      code,
      nonce: crypto.randomUUID(),
      action: { type: "accept", id: edited },
    })
  ).status,
  400,
);
await Promise.all(partners.map((p) => move(p, { type: "accept", id: edited })));
g = (await spectator.request(null, code)).game;
assert.equal(g.offers[0].accepted.length, 2);
assert(g.players.every((p) => !p.hand && !p.dev));
for (let p = 0; p < 8; p++)
  assert.deepEqual(
    (await seats[p].request(null, code)).game.players[p].hand,
    before[p],
  );
const nonces = partners.map(() => crypto.randomUUID());
const competing = await Promise.all(
  partners.map((p, i) =>
    seats[0].move(
      code,
      { type: "completeTrade", id: edited, to: p },
      nonces[i],
    ),
  ),
);
assert.deepEqual(competing.map((r) => r.status).sort(), [200, 400]);
const winner = competing.findIndex((r) => r.status === 200),
  chosen = partners[winner];
const after = await Promise.all(seats.map((s) => s.request(null, code)));
assert.equal(
  after[0].game.players[0].hand![giveResource],
  before[0][giveResource] - 1,
);
assert.equal(
  after[0].game.players[0].hand![wantResource],
  before[0][wantResource] + 1,
);
assert.equal(
  after[chosen].game.players[chosen].hand![giveResource],
  before[chosen][giveResource] + 1,
);
assert.deepEqual(
  after[partners[1 - winner]].game.players[partners[1 - winner]].hand,
  before[partners[1 - winner]],
);
assert.equal(
  (
    await seats[0].move(
      code,
      { type: "completeTrade", id: edited, to: chosen },
      nonces[winner],
    )
  ).status,
  200,
);
g = await move(0, { type: "offer", give: want, want: emptyHand() });
const open = g.offers[0].id;
assert.equal(
  (await seats[chosen].move(code, { type: "accept", id: open })).status,
  400,
);
g = await move(chosen, { type: "counterOffer", id: open, give, want });
const counter = g.offers.at(-1)!;
assert.equal(counter.replyTo, open);
assert.equal(g.offers.length, 2);
g = await move(0, { type: "completeTrade", id: counter.id });
assert.equal(g.offers.length, 0);
for (let p = 0; p < 8; p++)
  assert.deepEqual(
    (await seats[p].request(null, code)).game.players[p].hand,
    before[p],
  );
assert.deepEqual(
  (await spectator.request(null, code)).game.bank,
  after[0].game.bank,
);
console.log(
  "Eight-session trade API passed: real setup/dice, live expiry, held offers, private deadlines, multiple recipients, embargo/revoked consent, joining counters, edits, competing confirmations, duplicate receipts and open-ended exchanges.",
);
