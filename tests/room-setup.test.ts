import test from "node:test";
import assert from "node:assert/strict";
import { applyRoomCreationOptions } from "../lib/room-creation";
import { ROOM_MODES, ROOM_ROLL_SPEEDS, ROOM_TURN_SPEEDS, changeRoomCapacity, changeRoomMode, changeRoomScenario, defaultRoomSetup, restoreRoomSetup, roomCapacities, roomRuleDefaults, roomStep, roomTimerLabel } from "../lib/room-setup";
import { AVAILABLE_GAME_MODES, TURN_SPEEDS, addPlayer, applyAction, createGame, player, refreshLobbyBoard } from "../lib/game";
import { RUSH_SPEEDS } from "../lib/rush";
import { BASE_MAPS, baseMapAvailable, makeBaseBoard } from "../lib/base-maps";
import { SEAFARERS_SCENARIOS } from "../lib/scenarios";

test("setup exposes every supported mode, player count, and the engine's recommended rules", () => {
  assert.deepEqual(ROOM_MODES.map(m => m.id).toSorted(), AVAILABLE_GAME_MODES.toSorted());
  assert.deepEqual([...ROOM_TURN_SPEEDS], TURN_SPEEDS);
  assert.deepEqual([...ROOM_ROLL_SPEEDS], RUSH_SPEEDS);
  for (const {id: mode} of ROOM_MODES) for (const capacity of roomCapacities(mode)) {
    for (const scenario of mode.startsWith("seafarers") ? SEAFARERS_SCENARIOS : ["newShores"] as const) {
      const g = createGame("SETUP2", player("a", "Host"), capacity, false, mode, scenario);
      const defaults = roomRuleDefaults(mode, scenario);
      assert.equal(defaults.friendlyRobber, false, `${mode} ${scenario} uses the standard robber`);
      for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) assert.equal(defaults[key], g[key], `${mode} ${scenario} ${key}`);
    }
  }
});

test("switching modes resets Friendly Robber to off while explicit custom settings remain supported", () => {
  for (const {id: mode} of ROOM_MODES) {
    const draft = changeRoomMode({...defaultRoomSetup(), friendlyRobber:true}, mode);
    assert.equal(draft.friendlyRobber, false, `${mode} setup default`);
    const previousMode = mode === "base" ? "duel" : "base";
    const g = createGame("ROBBER", player("a", "Host"), previousMode === "duel" ? 2 : 4, false, previousMode);
    applyAction(g, 0, {type:"settings", friendlyRobber:true});
    applyAction(g, 0, {type:"settings", mode});
    assert.equal(g.friendlyRobber, false, `${mode} engine default`);
    applyAction(g, 0, {type:"settings", friendlyRobber:true});
    assert.equal(g.friendlyRobber, true, `${mode} explicit opt-in`);
  }
});

test("bot practice starts with the standard robber for one through seven bots", () => {
  for (let botCount = 1; botCount <= 7; botCount++) {
    const g = createGame("BOTROB", player("a", "Host"), botCount + 1, false, botCount === 1 ? "duel" : "base");
    applyRoomCreationOptions(g, {botCount, turnSeconds:60});
    g.players.forEach(p => p.ready = true);
    applyAction(g, 0, {type:"start"});
    assert.equal(g.friendlyRobber, false, `${botCount} bots`);
    assert.equal(g.phase, "setupSettlement");
  }
});
test("mode, capacity and scenario changes keep selections valid and reset dependent presets", () => {
  const custom = {...defaultRoomSetup(), map: "goldRush" as const, botCount: 3, title: "Friends table", target: 19, turnSeconds: 120};
  const large = changeRoomCapacity(custom, 8);
  assert.equal(large.map,"baseRandom"); assert.equal(large.title,custom.title);
  assert.equal(changeRoomCapacity(custom, 2).botCount,1);
  const duel = changeRoomMode(custom, "duel");
  assert.equal(duel.capacity,2); assert.equal(duel.map,"baseRandom"); assert.equal(duel.botCount,0);
  assert.equal(duel.target,15); assert.equal(duel.diceMode,"balanced"); assert.equal(duel.turnSeconds,30);
  const combined = changeRoomScenario(changeRoomMode(custom,"seafarersCitiesKnights"),"fourIslands");
  assert.equal(combined.target,15); assert.equal(combined.map,"base");
  const solo = changeRoomMode(custom,"solo"); assert.equal(solo.capacity,1); assert.equal(solo.botCount,0); assert.equal(solo.turnSeconds,0);
});
test("session draft restoration retains supported choices and rejects corrupt/dependent invalid data", () => {
  const saved = {...defaultRoomSetup(), capacity:8, map:"lakes" as const, title:"Long island", public:true, color:5, botCount:7, target:11, turnSeconds:120, discardLimit:9, diceMode:"balanced" as const, friendlyRobber:true,hideBank:true};
  assert.deepEqual(restoreRoomSetup(JSON.stringify(saved)),saved);
  for (const invalid of ["", "null", "[]", "{bad"]) assert.deepEqual(restoreRoomSetup(invalid),defaultRoomSetup());
  const repaired = restoreRoomSetup(JSON.stringify({...saved,mode:"solo",map:"lakes",target:21,capacity:8,botCount:7,color:12,turnSeconds:5,scenario:"fourIslands"}));
  assert.equal(repaired.mode,"base"); assert.equal(repaired.capacity,8); assert.equal(repaired.map,"lakes"); assert.equal(repaired.botCount,7); assert.equal(repaired.target,10); assert.equal(repaired.turnSeconds,60); assert.equal(repaired.scenario,"newShores"); assert.equal(repaired.color,undefined);
  assert.equal(roomStep("review"),"game"); assert.equal(roomStep("invalid"),"game");
});

test("Very Slow uses 200 seconds and restores old 200-minute setup drafts to the corrected setting", () => {
  assert.equal(roomTimerLabel(200), "200 seconds");
  assert.equal(restoreRoomSetup(JSON.stringify({...defaultRoomSetup(), turnSeconds:12000})).turnSeconds, 200);
  assert.equal(restoreRoomSetup(JSON.stringify({...defaultRoomSetup(), turnSeconds:200})).turnSeconds, 200);
});
test("creation applies all room choices and unique host/bot colors before a lobby starts", () => {
  const g = createGame("OPTIONS",player("a","Host"),8,true,"base",undefined,"lakes");
  applyRoomCreationOptions(g,{title:"Eight seats",target:11,diceMode:"balanced",turnSeconds:120,discardLimit:9,friendlyRobber:true,hideBank:true,color:5,botCount:6});
  assert.equal(g.title,"Eight seats"); assert.equal(g.target,11); assert.equal(g.diceMode,"balanced"); assert.equal(g.turnSeconds,120); assert.equal(g.discardLimit,9); assert.equal(g.friendlyRobber,true); assert.equal(g.hideBank,true); assert.equal(g.players[0].color,5); assert.equal(g.players.length,7); assert.equal(g.players.filter(p=>p.bot).length,6); assert.equal(new Set(g.players.map(p=>p.color)).size,7); assert.equal(g.phase,"lobby");
  addPlayer(g,player("friend","Friend")); g.players.forEach(p=>p.ready=true); applyAction(g,0,{type:"start"});
  assert.equal(g.map,"lakes"); assert.equal(g.target,11); assert.equal(g.turnSeconds,120); assert.equal(g.players.length,8); assert.equal(g.phase,"setupSettlement");
});
test("server rejects invalid rule fields, room names, colors and bot counts", () => {
  const bad = [{target:2},{target:20.5},{diceMode:"fixed"},{turnSeconds:301},{discardLimit:4},{friendlyRobber:"true"},{hideBank:1},{public:"true"},{public:null},{title:""},{title:"x".repeat(41)},{title:null},{color:12},{color:0.5},{botCount:4},{botCount:-1},{botCount:1.5},{botCount:"1"},{botCount:null}];
  for(const settings of bad) assert.throws(()=>applyRoomCreationOptions(createGame("BADOPT",player("a","Host")),settings));
  assert.throws(()=>applyRoomCreationOptions(createGame("BADSOL",player("a","Host"),1,false,"solo"),{botCount:1}));
  assert.throws(()=>applyRoomCreationOptions(createGame("BADRSH",player("a","Host"),4,false,"rush"),{turnSeconds:0}));
});
test("every supported map survives applying initial room options in each mode", () => {
  for(const {id:mode} of ROOM_MODES) for(const capacity of roomCapacities(mode)) for(const map of BASE_MAPS.filter(m=>baseMapAvailable(m,mode,capacity))) {
    const g=createGame("MAPOPT",player("a","Host"),capacity,false,mode,undefined,map);
    applyRoomCreationOptions(g,{title:"Chosen map",...roomRuleDefaults(mode),color:4,botCount:mode==="solo"?0:1});
    assert.equal(g.map,map); assert.equal(g.title,"Chosen map"); assert.equal(g.players[0].color,4);
  }
});
test("1v1 Base selection generates the standard sequence through create, refresh and start", () => {
  function standardRing(g: ReturnType<typeof createGame>) {
    const expected=[5,2,6,3,8,10,9,12,11,4,8,10,9,4,5,6,3,11];
    return Array.from({length:6},(_,rotation)=>{
      const coords: [number,number][]=[];
      for(const radius of [2,1]) {
        let q=radius,r=0;
        for(const [dq,dr] of [[0,-1],[-1,0],[-1,1],[0,1],[1,0],[1,-1]]) for(let i=0;i<radius;i++) {coords.push([q,r]);q+=dq;r+=dr;}
      }
      coords.push([0,0]);
      const numbers=coords.map(([q0,r0])=>{let q=q0,r=r0;for(let i=0;i<rotation;i++)[q,r]=[-r,q+r];return g.board.tiles.find(t=>t.q===q&&t.r===r)!;}).filter(t=>t.resource!=="desert").map(t=>t.number);
      return JSON.stringify(numbers)===JSON.stringify(expected);
    }).some(Boolean);
  }
  const g=createGame("DUELBA",player("a","Host"),2,false,"duel",undefined,"base");
  assert(standardRing(g)); refreshLobbyBoard(g); assert(standardRing(g));
  addPlayer(g,player("b","Friend")); g.players.forEach(p=>p.ready=true); applyAction(g,0,{type:"start"}); assert(standardRing(g));
  assert.equal(g.board.tiles.length,makeBaseBoard(2,"base").tiles.length);
});
