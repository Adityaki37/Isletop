import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { MatchmakingStatus } from "../lib/matchmaking-types";
import type { View } from "../lib/game";
const origin = process.env.TEST_ORIGIN ?? "http://localhost:5174";
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
class Client {
  cookie = "";
  ticket = crypto.randomUUID();
  async request<T = MatchmakingStatus>(path: string, body?: object, expected = 200): Promise<T> {
    const response = await fetch(origin + path, { method: body ? "POST" : "GET", headers: { Cookie: this.cookie, ...(body ? { "Content-Type": "application/json", Origin: origin } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) this.cookie = cookies.map(c => c.split(";")[0]).join("; ");
    const data = await response.json() as T & { error?: string };
    assert.equal(response.status, expected, data.error);
    return data;
  }
  join(map?: string, queue = "base4", expected = 200): Promise<MatchmakingStatus> {
    return this.request("/api/matchmaking", { op: "join", queue, map, ticket: this.ticket, name: "Map Choice QA" }, expected);
  }
  status(map: string): Promise<MatchmakingStatus> { return this.request(`/api/matchmaking?map=${map}`); }
}
const classic = Array.from({length:4}, () => new Client()), random = Array.from({length:4}, () => new Client());
for (let i=0;i<2;i++) {
  assert.equal((await classic[i].join("base")).status,"waiting");
  assert.equal((await random[i].join()).status,"waiting");
}
const classicCount = await classic[0].status("base"), randomCount = await random[0].status("baseRandom");
assert.equal(classicCount.status,"waiting"); assert.equal(randomCount.status,"waiting");
if (classicCount.status === "waiting" && randomCount.status === "waiting") {
  assert.equal(classicCount.waiting,2); assert.equal(randomCount.waiting,2);
  assert.equal(classicCount.map,"base"); assert.equal(randomCount.map,"baseRandom");
}
await classic[0].join("lakes", "base4", 409);
for (let i=2;i<4;i++) await classic[i].join("base");
assert.equal((await random[0].status("baseRandom")).status,"waiting");
for (let i=2;i<4;i++) await random[i].join();
const rooms: {code:string;created:number;map:string}[] = [];
for (const [clients,map] of [[classic,"base"],[random,"baseRandom"]] as const) {
  const codes = new Set<string>();
  for (const client of clients) {
    const status = await client.status(map);
    assert.equal(status.status,"matched");
    if (status.status !== "matched") throw Error("Missing room");
    codes.add(status.code);
    const { game } = await client.request<{game:View}>(`/api/rooms?code=${status.code}`);
    assert.equal(game.map,map); assert.equal(game.players.length,4); assert.equal(game.phase,"setupSettlement");
    if (codes.size === 1 && rooms.every(r=>r.code!==game.code)) rooms.push({code:game.code,created:game.created,map});
  }
  assert.equal(codes.size,1);
}
assert.notEqual(rooms[0].code,rooms[1].code);
await new Client().join("diamond","duel",400);
await new Client().join("bogus","base4",400);
const lakes = Array.from({length:4}, () => new Client());
for (const client of lakes) await client.join("lakes");
const lakeStatus = await lakes[0].status("lakes");
assert.equal(lakeStatus.status,"matched");
if (lakeStatus.status === "matched") {
  const {game} = await lakes[0].request<{game:View}>(`/api/rooms?code=${lakeStatus.code}`);
  assert.equal(game.map,"lakes"); assert.equal(game.board.tiles.filter(t=>t.resource!=="sea").length,39);
  rooms.push({code:game.code,created:game.created,map:game.map});
}
for (const [map,count] of [[undefined,1],["base",2],["lakes",3]] as const) {
  const client = new Client();
  const {game} = await client.request<{game:View}>("/api/rooms",{op:"create",practice:"bots",botCount:count,name:"Map Bots QA",map});
  assert.equal(game.map,map??"baseRandom"); assert.equal(game.players.length,count+1);
  rooms.push({code:game.code,created:game.created,map:game.map});
}
writeFileSync(".sites-runtime/map-choice-local-rooms.json",JSON.stringify(rooms,null,2));
console.log("PASS map-specific matching and counts, no mixed-map assignments, classic override, randomized defaults, custom Lakes assignment, invalid maps, map-change conflicts and bot maps");
