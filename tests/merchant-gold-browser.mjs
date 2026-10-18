// Local, named and deliberately controlled fixture; excluded from full games.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import assert from "node:assert/strict";
import { build } from "esbuild";
const ab = process.env.AGENT_BROWSER_BIN || "agent-browser";
const origin = "http://127.0.0.1:5173",
  session = "merchant-gold-check";
function run(...args) {
  const path = ".sites-runtime/merchant-gold-cli-output.json";
  const out = openSync(path, "w"),
    err = openSync(".sites-runtime/merchant-gold-cli-error.txt", "w");
  try {
    execFileSync(ab, ["--session", session, "--json", ...args], {
      timeout: 30000,
      stdio: ["ignore", out, err],
    });
  } finally {
    closeSync(out);
    closeSync(err);
  }
  const result = JSON.parse(readFileSync(path, "utf8"));
  assert(result.success, result.error);
  return result.data;
}
const ev = (code) => run("eval", code).result;
function ref(role, name) {
  const snapshot = run("snapshot", "-i");
  const entry = Object.entries(snapshot.refs).find(
    ([, r]) => r.role === role && r.name === name,
  );
  assert(entry, `${name}: ${snapshot.snapshot}`);
  return "@" + entry[0];
}
function press(name) {
  run("focus", ref("button", name));
  run("press", "Enter");
}
run("open", origin);
const code = ev(
  `(async()=>{const r=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'create',name:'Cities Preview',capacity:4,public:false,mode:'seafarersCitiesKnights',scenario:'newShores'})});if(!r.ok)throw Error('Create '+r.status);return (await r.json()).game.code})()`,
);
for (let seat = 1; seat < 4; seat++) {
  const response = await fetch(origin + "/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ op: "join", code, name: "Merchant QA " + seat }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).game.me, seat);
}
await build({
  entryPoints: ["tests/browser-cities-fixture.ts"],
  outfile: ".sites-runtime/tests/browser-cities-fixture.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const fixture = JSON.parse(
  execFileSync(
    process.execPath,
    [".sites-runtime/tests/browser-cities-fixture.mjs", code, "merchantGold"],
    { encoding: "utf8" },
  ),
);
run("open", origin + "/?room=" + code);
const get = () =>
  ev(
    `(async()=>{const r=await fetch('/api/rooms?code=${code}');if(!r.ok)throw Error('Room '+r.status);return (await r.json()).game})()`,
  );
const before = get(),
  card = before.cities.players[0].progress.find((c) => c.kind === "merchant");
assert(card);
assert.equal(before.me, 0);
assert.equal(before.mode, "seafarersCitiesKnights");
const bad = ev(
  `(async()=>{const r=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'action',code:${JSON.stringify(code)},nonce:crypto.randomUUID(),action:{type:'progress',cardId:${card.id},tile:${fixture.gold}}})});const data=await r.json();return {status:r.status,error:data.error}})()`,
);
assert.equal(bad.status, 400);
assert.match(bad.error, /other than gold/);
const fields = (g) => ({
  revision: g.revision,
  board: g.board,
  bank: g.bank,
  cities: g.cities,
  players: g.players,
  log: g.log,
});
assert.deepEqual(
  fields(get()),
  fields(before),
  "Rejected placement consumes no card, resource or point",
);
press("Merchant");
const targets = ev(
  "[...document.querySelectorAll('.cities-choice-board .tile')].map(t=>({role:t.getAttribute('role'),tabIndex:t.tabIndex}))",
);
assert.notEqual(targets[fixture.gold].role, "button");
assert(targets[fixture.gold].tabIndex < 0);
assert.equal(targets[fixture.land].role, "button");
ev(
  `document.querySelectorAll('.cities-choice-board .tile')[${fixture.land}].focus()`,
);
run("press", "Enter");
const screenshot = run("screenshot").path;
assert.equal(get().revision, before.revision, "Card draft remains local");
writeFileSync(
  ".sites-runtime/merchant-gold-pending-proof.json",
  JSON.stringify(
    {
      code,
      fixture,
      bad,
      beforeScores: before.players.map((p) => p.score),
      screenshot,
    },
    null,
    2,
  ),
);
press("Confirm Merchant");
let after;
for (let attempts = 0; attempts < 50; attempts++) {
  after = get();
  if (after.revision === before.revision + 1) break;
  await new Promise((r) => setTimeout(r, 100));
}
assert.equal(after.revision, before.revision + 1);
assert.deepEqual(after.cities.merchant, { owner: 0, tile: fixture.land });
assert(!after.cities.players[0].progress.some((c) => c.id === card.id));
assert.equal(after.players[0].score, before.players[0].score + 1);
assert.equal(after.players[1].score, before.players[1].score - 1);
assert.deepEqual(after.bank, before.bank);
const errors = run("errors");
assert.equal(errors.errors.length, 0);
const proof = {
  controlledFixture: true,
  excludedFromNaturalGames: true,
  code,
  gold: fixture.gold,
  land: fixture.land,
  serverRejectsGold: bad,
  atomicRejection: true,
  goldNotSelectable: true,
  landSelectedAndConfirmedThroughUi: true,
  merchantPointTransfers: true,
  screenshot,
  errors,
};
writeFileSync(
  ".sites-runtime/merchant-gold-browser-proof.json",
  JSON.stringify(proof, null, 2),
);
console.log(JSON.stringify(proof));
