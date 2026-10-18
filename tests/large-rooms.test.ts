import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { makeBoard, RESOURCES } from "../lib/board";
import { MAX_PLAYERS, PLAYER_COLORS } from "../lib/player-colors";
import { addPlayer, actor, applyAction, createGame, player, total } from "../lib/game";
import { roomCapacities, changeRoomCapacity, defaultRoomSetup } from "../lib/room-setup";
import { chooseMove } from "./autoplay";

test("nine through twelve players have complete, separated-red boards and distinct piece colors", () => {
  for(let n=9;n<=MAX_PLAYERS;n++) {
    for(let sample=0;sample<10;sample++) {
      const board=makeBoard(n);
      assert.equal(board.tiles.length,61);
      assert(board.tiles.every(t => t.resource === "desert" ? t.number === 0 : [2,3,4,5,6,8,9,10,11,12].includes(t.number)));
      assert(!board.edges.some(e=>e.tiles.length===2&&e.tiles.every(id=>[6,8].includes(board.tiles[id].number))));
    }
    const g=createGame("LARGE",player("0","Host"),n,false,"base");
    for(let seat=1;seat<n;seat++)addPlayer(g,player(String(seat),`Seat ${seat}`));
    assert.equal(new Set(g.players.map(p=>p.color)).size,n);
    g.players.forEach(p=>p.ready=true);applyAction(g,0,{type:"start"});
    assert.equal(g.deck.length,65);assert(RESOURCES.every(r=>g.bank[r]===39));
    let steps=0;
    while(g.phase.startsWith("setup")&&steps++<100) {const move=chooseMove(g);assert(move);applyAction(g,actor(g),move);}
    assert.equal(steps,4*n);assert.equal(g.phase,"roll");assert.equal(g.board.vertices.filter(v=>v.owner!==null).length,2*n);
    assert.equal(g.board.edges.filter(e=>e.owner!==null).length,2*n);
    for(const resource of RESOURCES)assert.equal(g.bank[resource]+g.players.reduce((sum,p)=>sum+p.hand[resource],0),39);
    for(const p of g.players)for(const kind of ["road","settlement","city"])assert(existsSync(`public/art/${kind}_${PLAYER_COLORS[p.color]}.svg`));
    assert(g.players.every(p=>total(p.hand)<=3));
  }
});
test("larger lobbies expose supported modes and reject a thirteenth seat", () => {
  for(const mode of ["base","rush"] as const)assert.equal(roomCapacities(mode).at(-1),12);
  for(const mode of ["seafarers","citiesKnights","seafarersCitiesKnights"] as const)assert.equal(roomCapacities(mode).at(-1),6);
  const draft=changeRoomCapacity({...defaultRoomSetup(),map:"lakes"},12);assert.equal(draft.map,"baseRandom");
  const g=createGame("LIMIT",player("0","Host"),12,false,"base");
  for(let seat=1;seat<12;seat++)addPlayer(g,player(String(seat),"Seat"));
  assert.throws(()=>addPlayer(g,player("extra","Extra")),/full/);
  assert.throws(()=>createGame("LIMIT",player("0","Host"),13,false,"base"));
});
