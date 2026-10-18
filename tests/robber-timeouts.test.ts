import test from "node:test";
import assert from "node:assert/strict";
import { createGame, player, addPlayer, applyAction, advanceClock, view, total, type Game } from "../lib/game";
import { botMove } from "../lib/disconnect-bots";

function fixture(mode: Game["mode"] = "base", seats = 4) {
  const g = createGame("ROBOPT", player("p0", "Seat 0"), seats, false, mode);
  for (let p = 1; p < seats; p++) addPlayer(g, player(`p${p}`, `Seat ${p}`));
  g.players.forEach(p => p.ready = true);
  applyAction(g, 0, {type:"start"}, () => 0.37, 1000);
  if (g.cities) g.cities.attacks = 1;
  const moving = seats === 2 ? 1 : 2;
  const opponent = moving === 1 ? 0 : 1;
  g.phase = "robber";
  g.resume = "action";
  g.active = moving;
  g.turnSeconds = 30;
  g.board.vertices.forEach(v => { v.owner = null; v.city = false; });
  g.board.tiles.filter(t => t.number > 0).forEach(t => t.number = 2);
  const own = g.board.tiles.find(t => t.number > 0)!;
  const target = g.board.tiles.find(t => t.number > 0 && t.vertices.every(id => !own.vertices.includes(id)))!;
  own.number = 6;
  target.number = 8;
  g.board.vertices[own.vertices[0]].owner = moving;
  Object.assign(g.board.vertices[target.vertices[0]], {owner:opponent, city:true});
  g.players[opponent].hand.ore = 2;
  g.bank.ore -= 2;
  g.clockKey = null;
  g.deadline = null;
  return {g, own, target, moving, opponent};
}

for (const [mode, seats] of [["base",4],["base",8],["duel",2],["citiesKnights",4],["seafarers",4],["seafarersCitiesKnights",4]] as const) {
  test(`${mode}/${seats}: robber timeout targets the opposing productive city from the moving seat's perspective`, () => {
    const {g, own, target, moving, opponent} = fixture(mode, seats);
    advanceClock(g, 1000, () => 0);
    const deadline = g.deadline!;
    const original = g.board.robber;
    const expected = botMove(g, moving);
    assert.deepEqual(expected, {type:"robber",id:target.id});
    advanceClock(g, deadline - 1, () => 0);
    assert.equal(g.board.robber, original, "The player's choice remains available before expiry");
    advanceClock(g, deadline, () => 0);
    assert.equal(g.board.robber, target.id);
    assert.notEqual(g.board.robber, own.id);
    assert.equal(g.players[moving].hand.ore, 1);
    assert.equal(g.players[opponent].hand.ore, 1);
    assert.equal(g.phase, "action");
    assert.equal(g.players[moving].bot, undefined, "One automatic choice does not change the human's persona");
    const cards = total(g.players[moving].hand);
    advanceClock(g, deadline, () => 0);
    assert.equal(total(g.players[moving].hand), cards, "Repeated clock checks do not steal again");
  });
}

test("robber timeout honors Friendly Robber protection when explicitly enabled", () => {
  const {g, target} = fixture("duel", 2);
  g.friendlyRobber = true;
  advanceClock(g, 1000);
  assert(!view(g, "p1").legal.robber.includes(target.id));
  advanceClock(g, g.deadline!, () => 0.99);
  assert.notEqual(g.board.robber, target.id);
  assert.equal(g.players[0].hand.ore, 2);
  assert.equal(g.phase, "action");
});

test("a Knight's expired robber choice uses strategy and restores the player's remaining turn time", () => {
  const {g, target, moving} = fixture();
  g.phase = "action";
  g.turn = 10;
  g.players[moving].dev = [{kind:"knight",bought:0}];
  advanceClock(g, 1000);
  assert.equal(g.deadline, 31000);
  applyAction(g, moving, {type:"knight"}, () => 0, 5000);
  assert.equal(g.phase, "robber");
  assert.equal(g.deadline, 15000);
  advanceClock(g, 15000, () => 0);
  assert.equal(g.board.robber, target.id);
  assert.equal(g.phase, "action");
  assert.equal(g.deadline, 41000);
});

test("expired theft chooses the stronger public opponent without using hidden victory cards", () => {
  const {g, moving, opponent} = fixture();
  g.phase = "steal";
  g.victims = [0, opponent];
  g.players[0].hand.wood = 5;
  g.bank.wood -= 5;
  g.players[0].dev = Array.from({length:8}, () => ({kind:"victory" as const, bought:0}));
  advanceClock(g, 1000);
  assert.deepEqual(botMove(g, moving), {type:"steal",id:opponent});
  advanceClock(g, g.deadline!, () => 0);
  assert.equal(g.players[moving].hand.ore, 1);
  assert.equal(g.players[0].hand.wood, 5);
  assert.equal(g.phase, "action");
});

test("Voyages timeout can choose the pirate when an opposing fleet is the best target", () => {
  const {g, moving, opponent} = fixture("seafarers");
  g.board.vertices.filter(v => v.owner === opponent).forEach(v => {v.owner = null; v.city = false;});
  const sea = g.board.tiles.find(t => t.resource === "sea" && !t.fog && t.id !== g.board.pirate)!;
  const ship = g.board.edges.find(e => e.tiles.includes(sea.id))!;
  Object.assign(ship, {kind:"ship",owner:opponent});
  advanceClock(g, 1000);
  const expected = botMove(g, moving)!;
  assert.equal(expected.type, "pirate");
  advanceClock(g, g.deadline!, () => 0.99);
  assert.equal(g.board.pirate, expected.id);
  assert.equal(g.players[moving].hand.ore, 1);
});

test("Rapid Play timeout ranks for the robber owner even when another seat is active", () => {
  const {g, target, moving} = fixture("rush");
  g.phase = "action";
  g.active = 0;
  Object.assign(g.rush!, {robberOwner:moving,robberStep:"robber",robberUntil:6000,rollAt:30000});
  const original = g.board.robber;
  assert.deepEqual(botMove(g, moving), {type:"robber",id:target.id});
  advanceClock(g, 5999, () => 0);
  assert.equal(g.board.robber, original);
  advanceClock(g, 6000, () => 0);
  assert.equal(g.board.robber, target.id);
  assert.equal(g.players[moving].hand.ore, 1);
  assert.equal(g.players[0].hand.ore, 0);
  assert.equal(g.rush!.robberOwner, null);
  assert.equal(g.phase, "action");
});
