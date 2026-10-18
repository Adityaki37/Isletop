// Local-only targeted verification against real HTTP sessions and D1.
// Edge-case state fixtures affect only the named unlisted QA table.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Action, Game, View, moveContext, normalizeGame } from "../lib/game";
import {
  CitiesHand,
  GOODS,
  TRACKS,
  ProgressKind,
  citiesHand,
} from "../lib/cities-knights";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
const url = new URL(origin);
assert(
  ["127.0.0.1", "localhost"].includes(url.hostname) &&
    url.protocol === "http:" &&
    url.port === "5173",
  "This harness only accesses the local preview.",
);
class Session {
  cookie = "";
  async request(body: Record<string, unknown> | null, code?: string) {
    const res = await fetch(
      `${origin}/api/rooms${body ? "" : code ? `?code=${code}` : ""}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          ...(this.cookie ? { Cookie: this.cookie } : {}),
          ...(body
            ? { "Content-Type": "application/json", Origin: origin }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    const cookie = res.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    return {
      status: res.status,
      ...((await res.json()) as { game: View; error?: string }),
    };
  }
  async move(
    code: string,
    action: Action,
    context?: string,
    nonce = crypto.randomUUID(),
  ) {
    const r = await this.request({
      op: "action",
      code,
      action,
      nonce,
      ...(context ? { context } : {}),
    });
    assert.equal(r.status, 200, `${action.type}: ${r.error}`);
    return r.game;
  }
}
function database() {
  const directory = resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  const file = readdirSync(directory).find((name) =>
    /^[a-f0-9]{64}\.sqlite$/.test(name),
  );
  assert(file);
  const db = new DatabaseSync(join(directory, file));
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}
function fixture(code: string, change: (g: Game) => void) {
  const db = database();
  try {
    const row = db
      .prepare("SELECT state,revision FROM rooms WHERE code=?")
      .get(code) as { state: string; revision: number };
    assert(row);
    const g = normalizeGame(JSON.parse(row.state));
    assert(
      g.players[0].name === "Cities API Preview" &&
        !g.public &&
        [4, 6].includes(g.players.length),
      "Only this unlisted local QA table may be seeded.",
    );
    change(g);
    g.revision = row.revision + 1;
    g.updated = Date.now();
    const result = db
      .prepare(
        "UPDATE rooms SET state=?,revision=?,updated=? WHERE code=? AND revision=?",
      )
      .run(JSON.stringify(g), g.revision, g.updated, code, row.revision);
    assert.equal(result.changes, 1);
  } finally {
    db.close();
  }
}
function zero(g: Game) {
  for (const p of g.players)
    for (const r of GOODS) {
      g.bank[r] = (g.bank[r] ?? 0) + (p.hand[r] ?? 0);
      p.hand[r] = 0;
    }
}
function fund(g: Game, p: number, h: Partial<CitiesHand>) {
  for (const r of GOODS) {
    const amount = h[r] ?? 0;
    g.bank[r] = (g.bank[r] ?? 0) - amount;
    g.players[p].hand[r] = (g.players[p].hand[r] ?? 0) + amount;
  }
}
function grant(g: Game, p: number, kind: ProgressKind) {
  const track = TRACKS.find((track) =>
    g.cities!.decks[track].some((c) => c.kind === kind),
  );
  assert(track);
  const deck = g.cities!.decks[track],
    at = deck.findIndex((c) => c.kind === kind),
    card = deck.splice(at, 1)[0];
  g.cities!.players[p].progress.push(card);
  return card.id;
}
function action(g: Game) {
  g.phase = "action";
  g.active = 0;
  g.turn = 10;
  g.offers = [];
  g.deadline = null;
  g.clockKey = null;
  g.clockResume = null;
  g.citiesFlow = null;
  g.cities!.choices = [];
}
for (const n of [4, 6]) {
  const seats = Array.from({ length: n }, () => new Session()),
    spectator = new Session();
  const denied = await seats[0].request({
    op: "create",
    name: "Cities API Preview",
    capacity: 8,
    mode: "citiesKnights",
  });
  assert.equal(
    denied.status,
    400,
    "Unsupported expansion capacity must be rejected.",
  );
  let result = await seats[0].request({
    op: "create",
    name: "Cities API Preview",
    capacity: n,
    public: false,
    mode: "citiesKnights",
  });
  assert.equal(result.status, 200);
  let g = result.game;
  const code = g.code;
  g = await seats[0].move(code, { type: "settings", turnSeconds: 0 });
  for (let p = 1; p < n; p++) {
    const joined = await seats[p].request({
      op: "join",
      code,
      name: `Cities seat ${p}`,
    });
    assert.equal(joined.status, 200);
    await seats[p].move(code, { type: "ready" });
  }
  g = await seats[0].move(code, { type: "start" });
  while (g.phase.startsWith("setup")) {
    const p = g.active,
      mine = (await seats[p].request(null, code)).game;
    g = await seats[p].move(
      code,
      mine.phase === "setupSettlement"
        ? { type: "settlement", id: mine.legal.settlement[0] }
        : { type: "road", id: mine.legal.road[0] },
      moveContext(mine),
    );
  }
  assert.equal(g.phase, "roll");
  assert.equal(g.deckCount, 0);
  assert(g.cities);
  assert(
    g.players.every(
      (p) => p.score === 3 && p.pieces.city === 1 && p.pieces.settlement === 1,
    ),
  );
  const watch = (await spectator.request(null, code)).game;
  assert(watch.players.every((p) => !p.hand && !p.dev));
  assert(!("decks" in watch.cities!));
  assert(!("citiesFlow" in watch));
  // The seven is deterministic; its independent event die still comes from the server.
  let alchemist = 0;
  fixture(code, (g) => {
    zero(g);
    fund(g, 0, { coin: 8 });
    alchemist = grant(g, 0, "alchemist");
  });
  g = await seats[0].move(code, {
    type: "progress",
    cardId: alchemist,
    dice: [3, 4],
  });
  assert.deepEqual(g.dice, [3, 4]);
  assert.equal(g.phase, "discard");
  assert.equal(g.discards[0], 4);
  g = await seats[0].move(code, {
    type: "discard",
    resources: { ...citiesHand(), coin: 4 },
  });
  assert.equal(g.phase, "action");
  assert.equal(g.players[0].hand!.coin, 4);
  // One commodity exchange is executed despite two concurrent confirmations.
  fixture(code, (g) => {
    action(g);
    zero(g);
    fund(g, 0, { paper: 2 });
    fund(g, 1, { coin: 2 });
  });
  g = await seats[0].move(code, {
    type: "offer",
    give: { ...citiesHand(), paper: 1 },
    want: { ...citiesHand(), coin: 1 },
    targets: [1],
  });
  const offer = g.offers[0].id;
  await seats[1].move(code, { type: "accept", id: offer });
  const race = await Promise.all(
    [0, 1].map(() =>
      seats[0].request({
        op: "action",
        code,
        nonce: crypto.randomUUID(),
        context: moveContext(g),
        action: { type: "completeTrade", id: offer, to: 1 },
      }),
    ),
  );
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 400]);
  g = (await seats[0].request(null, code)).game;
  assert.equal(g.players[0].hand!.paper, 1);
  assert.equal(g.players[0].hand!.coin, 1);
  assert.equal(
    (await seats[1].request(null, code)).game.players[1].hand!.paper,
    1,
  );
  // Private Spy grant persists across GET/rejoin but is absent for peers and spectators.
  let spy = 0,
    victim = 0;
  fixture(code, (g) => {
    action(g);
    spy = grant(g, 0, "spy");
    victim = grant(g, 1, "merchant");
  });
  g = await seats[0].move(code, { type: "progress", cardId: spy, target: 1 });
  assert.equal(g.phase, "citiesChoice");
  assert.equal(g.cities!.peek!.progress![0].id, victim);
  assert.equal((await spectator.request(null, code)).game.cities!.peek, null);
  assert.equal((await seats[2].request(null, code)).game.cities!.peek, null);
  const reconnect = await seats[0].request({
    op: "join",
    code,
    name: "Ignored rename",
  });
  assert.equal(reconnect.game.cities!.peek!.progress![0].id, victim);
  assert.equal(reconnect.game.players[0].name, "Cities API Preview");
  const nonce = crypto.randomUUID(),
    context = moveContext(g);
  g = await seats[0].move(
    code,
    { type: "citiesChoice", cardId: victim },
    context,
    nonce,
  );
  assert.equal(g.cities!.peek, null);
  const replay = await seats[0].move(
    code,
    { type: "citiesChoice", cardId: victim },
    context,
    nonce,
  );
  assert.equal(replay.revision, g.revision);
  assert.equal(
    replay.cities!.players[0].progress!.filter((c) => c.id === victim).length,
    1,
  );
  // Each foreign-owned response has a new context; stale contexts cannot pay the next player.
  let wedding = 0;
  fixture(code, (g) => {
    action(g);
    zero(g);
    g.cities!.players[1].defenders = 1;
    g.cities!.players[2].defenders = 1;
    fund(g, 1, { paper: 2 });
    fund(g, 2, { cloth: 2 });
    wedding = grant(g, 0, "wedding");
  });
  g = await seats[0].move(code, { type: "progress", cardId: wedding });
  const firstContext = moveContext(g),
    before = g.revision;
  const wrong = await seats[0].request({
    op: "action",
    code,
    nonce: crypto.randomUUID(),
    action: { type: "citiesChoice", resources: { ...citiesHand(), paper: 2 } },
  });
  assert.equal(wrong.status, 400);
  g = await seats[1].move(
    code,
    { type: "citiesChoice", resources: { ...citiesHand(), paper: 2 } },
    firstContext,
  );
  assert.equal(g.revision, before + 1);
  assert.equal(g.cities!.choice!.player, 2);
  const stale = await seats[2].request({
    op: "action",
    code,
    nonce: crypto.randomUUID(),
    context: firstContext,
    action: { type: "citiesChoice", resources: { ...citiesHand(), cloth: 2 } },
  });
  assert.equal(stale.status, 400);
  g = await seats[2].move(
    code,
    { type: "citiesChoice", resources: { ...citiesHand(), cloth: 2 } },
    moveContext(g),
  );
  assert.equal(g.phase, "action");
  const host = (await seats[0].request(null, code)).game;
  assert.equal(host.players[0].hand!.paper, 2);
  assert.equal(host.players[0].hand!.cloth, 2);
  // An actual choice timeout is persisted by the GET path, then does not replay.
  let saboteur = 0;
  fixture(code, (g) => {
    action(g);
    zero(g);
    g.turnSeconds = 30;
    g.cities!.players[1].defenders = 1;
    g.cities!.players[2].defenders = 0;
    fund(g, 1, { coin: 3 });
    saboteur = grant(g, 0, "saboteur");
  });
  g = await seats[0].move(code, { type: "progress", cardId: saboteur });
  const pendingRevision = g.revision;
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, g.deadline! - Date.now()) + 100),
  );
  g = (await seats[1].request(null, code)).game;
  assert.equal(g.phase, "action");
  assert.equal(g.players[1].hand!.coin, 2);
  assert.equal(g.revision, pendingRevision + 1);
  assert.equal((await seats[1].request(null, code)).game.revision, g.revision);
  // Play the Merchant actually stolen by Spy to reach a rules-checked custom
  // four-point winner; then verify reset of expansion state and private hands.
  fixture(code, (g) => {
    action(g);
    g.turnSeconds = 0;
    g.target = 4;
  });
  g = (await seats[0].request(null, code)).game;
  const merchantTile = g.board.tiles.find((t) =>
    t.vertices.some((id) => g.board.vertices[id].owner === 0),
  )!.id;
  g = await seats[0].move(code, {
    type: "progress",
    cardId: victim,
    tile: merchantTile,
  });
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 0);
  const rematch = await seats[0].request({ op: "rematch", code });
  assert.equal(rematch.status, 200);
  assert.equal(rematch.game.phase, "lobby");
  assert.equal(rematch.game.mode, "citiesKnights");
  assert.equal(rematch.game.cities, null);
  assert(rematch.game.players.every((p) => p.score === 0));
  assert.equal(rematch.game.target, 4);
  for (let p = n - 1; p >= 0; p--)
    await seats[p].request({ op: "leave", code });
  console.log(
    `PASS: Cities & Knights / ${n} real HTTP seats: setup, commodities, seven, trade race, private Spy/reconnect, nonce replay, owned/stale choices, actual timeout, winner and rematch. Public expansion creation is enabled for 3–6 seats.`,
  );
}
