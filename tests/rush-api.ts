import assert from "node:assert/strict";
import { RESOURCES } from "../lib/board";
import { Action, View, moveContext } from "../lib/game";
import { chooseRushMove } from "./rush-match-driver";
import { pauseMatchProof } from "./pause-match-proof";

const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:5173";
assert(
  ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
  "Local verification only.",
);
class Seat {
  cookie = "";
  async request(body: Record<string, unknown> | null, code?: string) {
    const response = await fetch(
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
    const cookie = response.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    return {
      status: response.status,
      ...((await response.json()) as {
        game: View;
        rooms: { code: string }[];
        games: { code: string }[];
        error?: string;
      }),
    };
  }
  async move(
    code: string,
    action: Action,
    nonce = crypto.randomUUID(),
    context?: string,
  ) {
    return this.request({
      op: "action",
      code,
      action,
      nonce,
      ...(context ? { context } : {}),
    });
  }
}
const sizes = process.argv.slice(2).map(Number);
for (const n of sizes.length ? sizes : [3, 4, 8]) {
  const seats = Array.from({ length: n }, () => new Seat()),
    spectator = new Seat();
  const made = await seats[0].request({
    op: "create",
    name: `Rush QA ${n}`,
    capacity: n,
    public: true,
    mode: "rush",
  });
  assert.equal(made.status, 200, made.error);
  let g = made.game;
  const code = g.code;
  assert.equal(g.mode, "rush");
  assert.equal(g.target, 10);
  assert.equal(g.turnSeconds, 5);
  assert.equal(g.discardLimit, 9);
  assert((await spectator.request(null)).rooms.some((r) => r.code === code));
  for (let p = 1; p < n; p++) {
    assert.equal(
      (await seats[p].request({ op: "join", code, name: `Rush seat ${p}` }))
        .status,
      200,
    );
    assert.equal((await seats[p].move(code, { type: "ready" })).status, 200);
  }
  const started = await seats[0].move(code, { type: "start" });
  assert.equal(started.status, 200, started.error);
  g = started.game;
  let moves = 0,
    earlyRolls = 0,
    automatic = false,
    replayChecked = false;
  const actions = new Set<string>();
  if (process.env.TEST_PAUSE === "1")
    g = await pauseMatchProof(g, async (p, a) => {
      const r = await seats[p].move(code, a);
      assert.equal(r.status, 200, r.error);
      moves++;
      actions.add(a.type);
      return r.game;
    });
  for (let cycle = 0; cycle < 5000 && g.phase !== "finished"; cycle++) {
    let changed = false;
    for (let p = 0; p < n && g.phase !== "finished"; p++) {
      const mine = (await seats[p].request(null, code)).game;
      assert.equal(mine.me, p);
      assert(mine.players.every((pl, i) => i === p || !pl.hand));
      assert(
        !("deck" in mine) && !("diceState" in mine) && !("receipts" in mine),
      );
      const action = chooseRushMove(mine);
      if (!action) {
        g = mine;
        continue;
      }
      const nonce = crypto.randomUUID();
      const result = await seats[p].move(
        code,
        action,
        nonce,
        moveContext(mine),
      );
      if (result.status !== 200) {
        assert.match(result.error ?? "", /turn has changed|table changed/);
        g = (await seats[p].request(null, code)).game;
        changed = true;
        continue;
      }
      g = result.game;
      moves++;
      changed = true;
      actions.add(action.type);
      if (!replayChecked) {
        const again = await seats[p].move(
          code,
          action,
          nonce,
          moveContext(mine),
        );
        assert.equal(again.status, 200, again.error);
        assert.deepEqual(again.game.board, g.board);
        replayChecked = true;
      }
    }
    if (g.phase === "finished") break;
    if (moves && moves % 40 === 0) {
      const watch = (await spectator.request(null, code)).game;
      assert.equal(watch.me, -1);
      assert(watch.players.every((p) => !p.hand && !p.dev));
      const mine = (await seats[1].request(null, code)).game;
      const returning = (
        await seats[1].request({ op: "join", code, name: "Ignored new name" })
      ).game;
      assert.equal(returning.players[1].name, mine.players[1].name);
    }
    if (!changed && !g.phase.startsWith("setup")) {
      if (n === 3 && !automatic) {
        const rolls = g.turn;
        await new Promise((resolve) => setTimeout(resolve, 5200));
        g = (await seats[0].request(null, code)).game;
        assert(g.turn > rolls, "Server clock rolls without a player's action.");
        automatic = true;
      } else {
        // Concurrent votes exercise the room's compare-and-swap retry path.
        const before = (await seats[0].request(null, code)).game;
        const responses = await Promise.all(
          seats.map(async (seat) => {
            const mine = (await seat.request(null, code)).game;
            if (mine.phase !== "action" || mine.rush!.votes.includes(mine.me))
              return null;
            return seat.move(
              code,
              { type: "voteRoll" },
              crypto.randomUUID(),
              moveContext(mine),
            );
          }),
        );
        if (n === 8 && before.turn === 0) {
          assert.equal(responses.filter(Boolean).length, 8);
          for (const response of responses)
            assert.equal(response!.status, 200, response!.error);
        }
        for (const response of responses)
          if (response && response.status !== 200)
            assert.match(
              response.error ?? "",
              /turn has changed|table changed|already recorded/,
            );
        g = (await seats[0].request(null, code)).game;
        if (g.turn > before.turn) earlyRolls++;
      }
    }
    // Read one consistent revision through each seat, without changing stored data.
    if (cycle % 25 === 0) {
      const views = await Promise.all(seats.map((s) => s.request(null, code)));
      if (views.every((v) => v.game.revision === views[0].game.revision)) {
        const bank = views[0].game.bank!;
        for (const resource of RESOURCES) {
          const stock = [
            bank[resource],
            ...views.map((v) => v.game.players[v.game.me].hand![resource]),
          ];
          assert(
            stock.every((amount) => Number.isInteger(amount) && amount >= 0),
          );
          assert.equal(
            stock.reduce((sum, amount) => sum + amount, 0),
            n <= 4 ? 19 : 29,
          );
        }
      }
    }
  }
  assert.equal(
    g.phase,
    "finished",
    `${n} seats / ${moves} moves / ${g.turn} rolls`,
  );
  assert(g.winner !== null && g.players[g.winner!].score >= 10);
  assert(earlyRolls > 0);
  const rematch = await seats[0].request({ op: "rematch", code });
  assert.equal(rematch.status, 200, rematch.error);
  assert.equal(rematch.game.phase, "lobby");
  assert.equal(rematch.game.mode, "rush");
  assert.equal(rematch.game.rush, null);
  assert.equal(rematch.game.turnSeconds, 5);
  assert.equal(rematch.game.players.length, n);
  assert(rematch.game.players.every((p) => p.score === 0));
  await seats[0].move(code, { type: "settings", public: false });
  for (let p = n - 1; p >= 0; p--)
    await seats[p].request({ op: "leave", code });
  console.log(
    JSON.stringify({
      status: "PASS",
      seats: n,
      code,
      moves,
      rolls: g.turn,
      earlyRolls,
      automatic,
      winner: g.winner,
      score: g.players[g.winner!].score,
      actions: [...actions],
      privacy: true,
      replay: true,
      reconnect: true,
      rematch: true,
    }),
  );
}
