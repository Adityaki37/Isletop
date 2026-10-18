import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  player,
  addPlayer,
  actor,
  view,
  normalizeGame,
  advanceClock,
  type Game,
} from "../lib/game";
import { chooseMove } from "./autoplay";

function table(capacity = 6, seats = capacity): Game {
  const g = createGame("FLAG22", player("0", "Host"), capacity, false, "base");
  for (let seat = 1; seat < seats; seat++) {
    addPlayer(g, player(String(seat), `Seat ${seat}`));
  }
  for (let seat = 1; seat < seats; seat++)
    applyAction(g, seat, { type: "ready" });
  applyAction(g, 0, { type: "start" });
  while (g.phase.startsWith("setup")) applyAction(g, actor(g), chooseMove(g)!);
  g.phase = "action";
  return g;
}

test("expanded turns skip special building when nobody requests it", () => {
  const g = table();
  applyAction(g, 0, { type: "end" });
  assert.equal(g.phase, "roll");
  assert.equal(g.active, 1);
  assert.equal(g.turn, 2);
  assert.equal(g.specialPlayer, null);
  assert.deepEqual(g.specialQueue, []);
});

test("requests are private, idempotent and do not reset the active player's clock", () => {
  const g = table();
  g.turnSeconds = 30;
  const now = Date.now();
  applyAction(g, 0, { type: "chat", text: "Clock starts" }, undefined, now);
  const deadline = g.deadline;
  const logs = [...g.log];
  applyAction(
    g,
    4,
    { type: "specialBuild", requested: true },
    undefined,
    now + 1000,
  );
  applyAction(
    g,
    4,
    { type: "specialBuild", requested: true },
    undefined,
    now + 2000,
  );
  assert.deepEqual(g.specialRequests, [4]);
  assert.equal(g.deadline, deadline);
  assert.deepEqual(g.log, logs);
  assert.equal(g.phase, "action");
  for (const id of ["0", "1", "4", null]) {
    const v = view(g, id);
    assert.equal(v.specialRequested, id === "4");
    assert(!("specialRequests" in v) && !("specialQueue" in v));
  }
  applyAction(g, 4, { type: "specialBuild", requested: false });
  applyAction(g, 0, { type: "end" });
  assert.equal(g.phase, "roll");
});

test("requested seats run in cyclic order, cancellation and later pending requests are honored", () => {
  const g = table(8);
  g.active = 3;
  for (const seat of [2, 6, 0, 5])
    applyAction(g, seat, { type: "specialBuild", requested: true });
  applyAction(g, 3, { type: "end" });
  assert.equal(actor(g), 5);
  assert.equal(view(g, "5").specialRequested, false);
  applyAction(g, 6, { type: "specialBuild", requested: false });
  applyAction(g, 2, { type: "specialBuild", requested: false });
  applyAction(g, 1, { type: "specialBuild", requested: true });
  applyAction(g, 5, { type: "pass" });
  assert.equal(actor(g), 0);
  applyAction(g, 0, { type: "pass" });
  assert.equal(actor(g), 1);
  applyAction(g, 1, { type: "pass" });
  assert.equal(g.phase, "roll");
  assert.equal(g.active, 4);
  assert.deepEqual(g.specialRequests, []);
  assert.equal(g.turn, 2);
});

test("special building requests last for one phase and can be made again for a later turn", () => {
  const g = table(6);
  applyAction(g, 1, { type: "specialBuild", requested: true });
  applyAction(g, 0, { type: "end" });
  assert.equal(g.phase, "special");
  assert.equal(actor(g), 1);
  applyAction(g, 1, { type: "pass" });
  assert.equal(g.active, 1);
  assert.equal(g.phase, "roll");
  g.phase = "action";
  applyAction(g, 1, { type: "end" });
  assert.equal(g.phase, "roll");
  g.phase = "action";
  g.active = 0;
  applyAction(g, 1, { type: "specialBuild", requested: true });
  applyAction(g, 0, { type: "end" });
  assert.equal(g.phase, "special");
  assert.equal(actor(g), 1);
});

test("unavailable and malformed special requests fail without changing state", () => {
  for (const g of [
    createGame("FLAG22", player("0", "Host")),
    table(4),
    table(),
  ]) {
    if (g.capacity === 6) {
      g.phase = "gold";
      g.turn = 0;
      g.goldResume = "setupRoad";
    }
    const before = structuredClone(g);
    assert.throws(() =>
      applyAction(g, 0, { type: "specialBuild", requested: true }),
    );
    assert.deepEqual(g, before);
  }
  const g = table();
  const before = structuredClone(g);
  assert.throws(() =>
    applyAction(g, 2, {
      type: "specialBuild",
      requested: "yes" as unknown as boolean,
    }),
  );
  assert.deepEqual(g, before);
  g.phase = "finished";
  assert.throws(() =>
    applyAction(g, 2, { type: "specialBuild", requested: true }),
  );
});

test("timeout processes requested seats and skips non-requesters without an extra clock", () => {
  const g = table();
  g.turnSeconds = 15;
  const now = Date.now();
  applyAction(g, 4, { type: "specialBuild", requested: true }, undefined, now);
  advanceClock(g, now + 15001);
  assert.equal(g.phase, "special");
  assert.equal(actor(g), 4);
  assert.equal(g.deadline, now + 30001);
  advanceClock(g, now + 30002);
  assert.equal(g.phase, "roll");
  assert.equal(g.active, 1);
  assert.deepEqual(g.specialRequests, []);
});

test("legacy in-progress special queues survive normalization without enabling future automatic phases", () => {
  const g = table();
  g.phase = "special";
  g.specialPlayer = 1;
  g.specialQueue = [2, 3, 4, 5];
  delete (g as Partial<Game>).specialRequests;
  normalizeGame(g);
  assert.deepEqual(g.specialRequests, [2, 3, 4, 5]);
  for (const seat of [1, 2, 3, 4, 5]) {
    assert.equal(actor(g), seat);
    applyAction(g, seat, { type: "pass" });
  }
  assert.equal(g.phase, "roll");
  assert.equal(g.active, 1);
  g.phase = "action";
  applyAction(g, 1, { type: "end" });
  assert.equal(g.phase, "roll");
});
