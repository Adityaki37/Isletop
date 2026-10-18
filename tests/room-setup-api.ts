import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { View } from "../lib/game";
import { ROOM_MODES, roomCapacities, roomRuleDefaults } from "../lib/room-setup";
const origin=process.env.TEST_ORIGIN??"http://localhost:5174";
assert(["localhost","127.0.0.1"].includes(new URL(origin).hostname),"Local QA required");
class Client {
  cookie="";
  async request(path:string,body?:object,expected=200):Promise<{game:View;error?:string}> {
    if(body && "op" in body && body.op==="action") body={...body,nonce:crypto.randomUUID()};
    const response=await fetch(origin+path,{method:body?"POST":"GET",headers:{Cookie:this.cookie,...(body?{"Content-Type":"application/json",Origin:origin}:{})},body:body?JSON.stringify(body):undefined});
    const cookies=response.headers.getSetCookie();if(cookies.length)this.cookie=cookies.map(c=>c.split(";")[0]).join("; ");
    const data=await response.json() as {game:View;error?:string};assert.equal(response.status,expected,data.error);return data;
  }
}
const rooms:{code:string;created:number;mode:string;map:string}[]=[];
function record(g:View){rooms.push({code:g.code,created:g.created,mode:g.mode,map:g.map});}
const host=new Client(),friend=new Client();
const {game:created}=await host.request("/api/rooms",{op:"create",name:"Setup Host",mode:"base",capacity:8,map:"lakes",public:true,title:"Eight seat setup",target:11,diceMode:"balanced",turnSeconds:120,discardLimit:9,friendlyRobber:true,hideBank:true,color:5,botCount:6});
record(created);
function chosen(g:View) {
  assert.equal(g.title,"Eight seat setup");assert.equal(g.capacity,8);assert.equal(g.map,"lakes");assert.equal(g.public,true);assert.equal(g.target,11);assert.equal(g.diceMode,"balanced");assert.equal(g.turnSeconds,120);assert.equal(g.discardLimit,9);assert.equal(g.friendlyRobber,true);assert.equal(g.hideBank,true);assert.equal(g.players[0].color,5);
}
chosen(created);assert.equal(created.phase,"lobby");assert.equal(created.players.length,7);assert.equal(created.players.filter(p=>p.bot).length,6);
const {game:joined}=await friend.request("/api/rooms",{op:"join",name:"Setup Friend",code:created.code});chosen(joined);assert.equal(joined.players.length,8);assert.equal(new Set(joined.players.map(p=>p.color)).size,8);
await host.request("/api/rooms",{op:"action",code:created.code,action:{type:"ready"}});
await friend.request("/api/rooms",{op:"action",code:created.code,action:{type:"ready"}});
const {game:started}=await host.request("/api/rooms",{op:"action",code:created.code,action:{type:"start"}});chosen(started);assert.equal(started.phase,"setupSettlement");assert.equal(started.board.tiles.length,49);
chosen((await host.request(`/api/rooms?code=${created.code}`)).game);
for(const {id:mode} of ROOM_MODES) {
  const capacity=mode==="solo"?1:mode==="duel"?2:4;
  const map=mode.startsWith("seafarers")?"base":"baseRandom";
  const {game}=await new Client().request("/api/rooms",{op:"create",name:"Mode Setup",mode,capacity,...roomRuleDefaults(mode),color:4,botCount:mode==="solo"?0:1});
  record(game);assert.equal(game.phase,"lobby");assert.equal(game.mode,mode);assert.equal(game.map,map);assert.equal(game.capacity,capacity);assert.equal(game.players.length,mode==="solo"?1:2);
  for(const [key,value] of Object.entries(roomRuleDefaults(mode)))assert.equal(game[key as keyof View],value,`${mode}:${key}`);
  assert(roomCapacities(mode).includes(capacity));
}
const voyageHost=new Client();
const {game:voyages}=await voyageHost.request("/api/rooms",{op:"create",name:"Combined Setup",mode:"seafarersCitiesKnights",capacity:6,scenario:"fourIslands",map:"base",target:17,turnSeconds:30,botCount:3,title:"Island party"});
record(voyages);assert.equal(voyages.scenario,"fourIslands");assert.equal(voyages.target,17);assert.equal(voyages.players.length,4);
await voyageHost.request("/api/rooms",{op:"action",code:voyages.code,action:{type:"ready"}});
const {game:combinedStart}=await voyageHost.request("/api/rooms",{op:"action",code:voyages.code,action:{type:"start"}});
assert(combinedStart.cities);assert.equal(combinedStart.scenario,"fourIslands");assert.equal(combinedStart.target,17);assert.equal(combinedStart.mode,"seafarersCitiesKnights");
for(const bad of [{target:2},{diceMode:"fixed"},{turnSeconds:301},{discardLimit:4},{friendlyRobber:"true"},{hideBank:1},{public:"true"},{title:""},{title:"x".repeat(41)},{color:12},{botCount:4},{botCount:null}]) {
  const response=await new Client().request("/api/rooms",{op:"create",name:"Invalid setup",mode:"base",capacity:4,...bad},400);assert(response.error);assert.equal(response.game,undefined);
}
const page=await fetch(origin+"/create");assert.equal(page.status,200);assert((await page.text()).includes("Create Room"));
writeFileSync(".sites-runtime/create-room-local-rooms.json",JSON.stringify(rooms,null,2));
console.log("PASS room creation persists all setup choices, host/bot colors, friend join, eight-seat game start, all seven modes, expansion scenarios, invalid options and full-page route");
