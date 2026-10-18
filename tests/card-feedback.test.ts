import test from "node:test";
import assert from "node:assert/strict";
import { addPlayer, applyAction, createGame, legalSettlements, player, view } from "../lib/game";
import { emptyHand, RESOURCES } from "../lib/board";
import { chooseMove } from "./autoplay";
import { recordCardFeedback } from "../lib/card-feedback";

const cards = (values: Partial<ReturnType<typeof emptyHand>>) => ({ ...emptyHand(), ...values });
function table(capacity = 2) {
  const g = createGame("CARDS2", player("a", "Alice"), capacity, false);
  addPlayer(g, player("b", "Bob"));
  g.turnSeconds = 0;
  return g;
}
test("only paid second-settlement income flies from its actual hexes", () => {
  const g = table(); g.phase = "setupSettlement"; g.setupStep = 0; g.active = 0;
  applyAction(g, 0, { type: "settlement", id: legalSettlements(g, 0, true)[0] });
  assert.equal(g.cardFeedback, undefined);
  while (g.setupStep < 2) applyAction(g, g.active, chooseMove(g)!);
  const seat = g.active, before = { ...g.players[seat].hand };
  g.bank.wood = 0;
  applyAction(g, seat, { type: "settlement", id: legalSettlements(g, seat, true)[0] });
  const event = g.cardFeedback!.at(-1)!;
  assert.equal(event.source, "setup");
  for (const good of RESOURCES) assert.equal(
    event.transfers.filter(t => t.card === good).reduce((n, t) => n + t.amount, 0),
    g.players[seat].hand[good] - before[good],
  );
  assert(event.transfers.every(t => t.from.type === "tile" && g.board.tiles[t.from.tile].resource === t.card));
  assert(!event.transfers.some(t => t.card === "wood"));
});
test("a deployment purchase animates its back without disclosing its kind", () => {
  const g = table(); g.phase = "action"; g.active = 0; g.turn = 3;
  g.players[0].hand = cards({ sheep: 2, wheat: 2, ore: 2 }); g.deck = ["victory"];
  applyAction(g, 0, { type: "buyDev" });
  assert.deepEqual(g.cardFeedback!.at(-1)!.transfers, [{ card: "development", amount: 1, from: { type: "bank" }, to: { type: "player", seat: 0 } }]);
  assert.equal(view(g, "b").players[0].dev, undefined);
  assert(!JSON.stringify(view(g, "b").cardFeedback).includes("victory"));
  assert.equal(g.players[0].dev[0].bought, 3);
});
test("bank exchanges animate exact payments and receipts only after success", () => {
  const g = table(); g.phase = "action"; g.active = 0; g.turn = 1;
  g.players[0].hand = cards({ wood: 4 });
  assert.throws(() => applyAction(g, 0, { type: "bankTrade", give: cards({ wood: 3 }), want: cards({ brick: 1 }) }));
  assert.equal(g.cardFeedback, undefined);
  applyAction(g, 0, { type: "bankTrade", give: cards({ wood: 4 }), want: cards({ brick: 1 }) });
  assert.deepEqual(g.cardFeedback!.at(-1)!.transfers, [
    { card: "wood", amount: 4, from: { type: "player", seat: 0 }, to: { type: "bank" } },
    { card: "brick", amount: 1, from: { type: "bank" }, to: { type: "player", seat: 0 } },
  ]);
});
test("accepted offers wait for completion before emitting both player directions", () => {
  const g = table(); g.phase = "action"; g.active = 0; g.turn = 1;
  g.players[0].hand = cards({ wood: 2 }); g.players[1].hand = cards({ brick: 1 });
  applyAction(g, 0, { type: "offer", give: cards({ wood: 2 }), want: cards({ brick: 1 }) });
  const id = g.offers[0].id;
  applyAction(g, 1, { type: "accept", id });
  assert.equal(g.cardFeedback, undefined);
  applyAction(g, 0, { type: "completeTrade", id, to: 1 });
  assert.deepEqual(g.cardFeedback!.at(-1)!.transfers, [
    { card: "wood", amount: 2, from: { type: "player", seat: 0 }, to: { type: "player", seat: 1 } },
    { card: "brick", amount: 1, from: { type: "player", seat: 1 }, to: { type: "player", seat: 0 } },
  ]);
});
test("choosing a robber victim animates one stolen card and hides its kind from other viewers", () => {
  const g = table(3); addPlayer(g, player("c", "Carol"));
  g.phase = "steal"; g.active = 0; g.turn = 1; g.resume = "action"; g.victims = [1, 2];
  g.players[1].hand = cards({ ore: 1 }); g.players[2].hand = cards({ sheep: 1 });
  applyAction(g, 0, { type: "steal", id: 1 });
  assert.equal(g.phase, "action");
  assert.equal(g.players[0].hand.ore, 1); assert.equal(g.players[1].hand.ore, 0);
  const expected = [{ card: "ore", amount: 1, from: { type: "player", seat: 1 }, to: { type: "player", seat: 0 } }];
  assert.equal(g.cardFeedback!.at(-1)!.source, "steal");
  for (const id of ["a", "b"]) assert.deepEqual(view(g, id).cardFeedback!.at(-1)!.transfers, expected);
  for (const id of ["c", null]) {
    const event = view(g, id).cardFeedback!.at(-1)!;
    assert.deepEqual(event.transfers, [{ ...expected[0], card: "hidden" }]);
    assert(!JSON.stringify(event).includes("ore"));
  }
  assert.deepEqual(g.cardFeedback!.at(-1)!.transfers, expected);
  const reloaded = JSON.parse(JSON.stringify(g));
  assert.equal(view(reloaded, "c").cardFeedback!.at(-1)!.transfers[0].card, "hidden");
});
test("moving the robber onto a single victim emits the same steal animation automatically", () => {
  const g = table(); g.phase = "robber"; g.active = 0; g.turn = 1; g.resume = "action";
  const tile = g.board.tiles.find(t => t.id !== g.board.robber)!;
  g.board.vertices[tile.vertices[0]].owner = 1; g.players[1].hand = cards({ brick: 1 });
  applyAction(g, 0, { type: "robber", id: tile.id });
  assert.equal(g.phase, "action");
  assert.deepEqual(g.cardFeedback!.at(-1)!.transfers, [{ card: "brick", amount: 1, from: { type: "player", seat: 1 }, to: { type: "player", seat: 0 } }]);
});
test("feedback retains missed transfers with bounded, monotonic history", () => {
  const g = table();
  for (let i = 0; i < 30; i++) recordCardFeedback(g, "purchase", [{ card: "development", amount: 1, from: { type: "bank" }, to: { type: "player", seat: 0 } }]);
  assert.equal(g.cardFeedback!.length, 24);
  assert.equal(g.cardFeedback![0].sequence, 7);
  assert.equal(g.cardFeedback!.at(-1)!.sequence, 30);
});
