import test from "node:test";
import assert from "node:assert/strict";
import {
  matchedGame,
  casualQueue,
  CASUAL_QUEUES,
  type QueuePlayer,
} from "../lib/matchmaking";
import {
  view,
  advanceClock,
  applyAction,
  legalSettlements,
  legalRoads,
  actor,
} from "../lib/game";
const seats: QueuePlayer[] = Array.from({ length: 4 }, (_, i) => ({
  id: `private-${i}`,
  name: `Human ${i}`,
  color: 4,
  avatar: "player",
}));
for (const queue of ["duel", "base4"] as const)
  test(`${queue} assignment starts the normal human engine and recorder with its full preset`, () => {
    const { game: g, replay } = matchedGame(
      "CASUAL",
      queue,
      seats.slice(0, CASUAL_QUEUES[queue].players),
    );
    assert.equal(g.phase, "setupSettlement");
    assert.equal(g.mode, queue === "duel" ? "duel" : "base");
    assert.equal(g.target, queue === "duel" ? 15 : 10);
    assert.equal(g.turnSeconds, queue === "duel" ? 30 : 60);
    assert(Number.isFinite(g.deadline) && g.deadline! > g.updated);
    // The actual durable boundary must retain a finite, usable clock.
    const restored = JSON.parse(JSON.stringify(g));
    advanceClock(restored, restored.updated);
    assert.equal(restored.phase, "setupSettlement");
    assert.equal(restored.revision, g.revision);
    while (restored.phase.startsWith("setup")) {
      const p = actor(restored),
        settlement = restored.phase === "setupSettlement";
      applyAction(
        restored,
        p,
        {
          type: settlement ? "settlement" : "road",
          id: (settlement
            ? legalSettlements(restored, p, true)
            : legalRoads(restored, p, true))[0],
        },
        undefined,
        restored.updated,
      );
      assert(Number.isFinite(restored.deadline));
    }
    assert.equal(restored.phase, "roll");
    advanceClock(restored, restored.updated);
    assert.equal(restored.phase, "roll");
    assert.equal(g.capacity, CASUAL_QUEUES[queue].players);
    assert(g.public && g.players.every((p) => p.ready));
    assert.equal(new Set(g.players.map((p) => p.color)).size, g.players.length);
    assert.equal(g.players[0].color, 4);
    assert(Object.values(g.bank).every((n) => n === 19));
    assert.equal(g.deck.length, 25);
    assert.equal(g.matchmaking, queue);
    assert.equal(replay.id, g.statistics!.id);
    assert.equal(replay.initialSequence, 0);
    assert.deepEqual(replay.frames, []);
    assert.equal(replay.initial!.phase, g.phase);
    const watch = view(g, null);
    assert(watch.players.every((p) => !("id" in p) && !p.hand && !p.dev));
    assert(!JSON.stringify(replay.initial).includes("private-"));
    assert.deepEqual(
      watch.players.map((p) => p.avatar),
      g.players.map((p) => p.avatar),
    );
  });
test("incomplete or duplicate seats cannot be assigned; only verified Casual queues are accepted", () => {
  assert.throws(() => matchedGame("CASUAL", "base4", seats.slice(0, 3)));
  assert.throws(() => matchedGame("CASUAL", "duel", [seats[0], seats[0]]));
  for (const key of [null, "ranked", "shuffle", "base", {}, 3])
    assert.throws(() => casualQueue(key));
  assert.equal(casualQueue("duel"), "duel");
  assert.equal(casualQueue("base4"), "base4");
});
