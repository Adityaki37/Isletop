import test from "node:test";
import assert from "node:assert/strict";
import { resultImageModel } from "../lib/result-image";
import { createGame, player, view } from "../lib/game";

test("result image rows retain every seat's final score and crown only the declared winner at 1–12 seats", () => {
  for (let n = 1; n <= 12; n++)
    for (let winner = 0; winner < n; winner++) {
      const g = createGame("IMAGE2", player("0", "Host"), n);
      g.players = Array.from({ length: n }, (_, p) => ({
        ...player(String(p), `Seat ${p}`),
        color: p,
      }));
      g.phase = "finished";
      g.winner = winner;
      const v = view(g, null);
      v.players.forEach((p, seat) => (p.score = seat + 3));
      const model = resultImageModel(v),
        all = model.rows.flat();
      assert.equal(all.length, n);
      assert.equal(new Set(all.map((p) => p.seat)).size, n);
      assert.equal(model.rows[0][0].seat, winner);
      assert.equal(all.filter((p) => p.winner).length, n === 1 ? 0 : 1);
      for (const p of all)
        assert.deepEqual(p, {
          seat: p.seat,
          name: `Seat ${p.seat}`,
          color: p.seat,
          avatar: "player",
          score: p.seat + 3,
          winner: n > 1 && p.seat === winner,
        });
      assert(model.rows.every((row) => row.length <= 6));
    }
});
test("result export model copies public names/colors/scores and omits all hidden or unrelated fields", () => {
  const g = createGame(
    "IMAGE2",
    player("secret-identity", '<name & quotes " >'),
    2,
  );
  g.phase = "finished";
  g.winner = 0;
  const v = view(g, "secret-identity");
  const model = resultImageModel(v),
    p = model.rows.flat()[0];
  assert.deepEqual(Object.keys(p).sort(), [
    "avatar",
    "color",
    "name",
    "score",
    "seat",
    "winner",
  ]);
  assert.equal(p.name, '<name & quotes " >');
  const text = JSON.stringify(model);
  for (const secret of [
    "secret-identity",
    "hand",
    "deck",
    "chat",
    "statistics",
    "pauseCooldowns",
    "token",
  ])
    assert(!text.includes(secret));
  p.name = "changed";
  assert.notEqual(v.players[0].name, p.name);
});
test("result images reject live, empty, oversized or winnerless tables", () => {
  const g = createGame("IMAGE2", player("0", "Host"), 2),
    v = view(g, null);
  assert.throws(() => resultImageModel(v), /after/);
  v.phase = "finished";
  assert.throws(() => resultImageModel(v), /after/);
  v.winner = 4;
  assert.throws(() => resultImageModel(v), /after/);
  v.winner = 0;
  v.players = [];
  assert.throws(() => resultImageModel(v));
  v.players = Array(13).fill(view(g, null).players[0]);
  assert.throws(() => resultImageModel(v), /twelve/);
});
