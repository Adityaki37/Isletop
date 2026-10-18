// Local QA driver using agent-browser's observed accessibility references.
// Fixtures require a named unlisted table. This is not a full-game test or bot.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const code = process.argv[2];
let passed = 0;
assert(/^[A-Z2-9]{6}$/.test(code));
const browser = process.env.AGENT_BROWSER_BIN;
assert(browser, "Set AGENT_BROWSER_BIN to the installed executable.");
const ab = (...args) =>
  execFileSync(browser, args, { encoding: "utf8", timeout: 30000 });
const url = new URL(ab("get", "url").trim());
assert(["localhost", "127.0.0.1"].includes(url.hostname), "Local QA only.");
assert.equal(url.searchParams.get("room"), code);
const read = (script) =>
  JSON.parse(
    execFileSync(browser, ["eval", "--stdin"], {
      input: script,
      encoding: "utf8",
      timeout: 30000,
    }),
  );
const state = () =>
  read(
    `(async()=>{const {game}=await (await fetch('/api/rooms?code=${code}')).json(); return game})()`,
  );
const snap = () => ab("snapshot", "-i");
function ref(role, label, snapshot = snap()) {
  const line = snapshot
    .split("\n")
    .find((line) => line.includes(`- ${role} "${label}" `));
  assert(line, `Missing ${role}: ${label}\n${snapshot}`);
  assert(!line.includes("[disabled"), `Disabled ${label}`);
  return "@" + line.match(/ref=(e\d+)/)[1];
}
function click(label) {
  const id = ref("button", label);
  ab("scrollintoview", id);
  ab("click", id);
}
function board(count = 1, prefix = "Select ") {
  const names = snap()
    .split("\n")
    .filter((line) => line.includes('- button "' + prefix))
    .map((line) => line.match(/- button "([^"]+)"/)[1]);
  assert(
    names.length >= count,
    `Need ${count} board choices; got ${names.length}`,
  );
  for (const name of names.slice(0, count)) click(name);
}
function seed(scenario) {
  execFileSync(
    process.execPath,
    [
      resolve(".sites-runtime/tests/browser-cities-fixture.mjs"),
      code,
      scenario,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  ab("reload");
  ab("wait", '[aria-label="Island game board"]');
}
function healthy() {
  const errors = read(
    `(()=>[...document.querySelectorAll('[role=alert]')].map(x=>x.textContent))()`,
  );
  assert.deepEqual(errors, []);
  assert.equal(ab("errors").trim(), "");
}
const cards = {
  alchemist: "Alchemist",
  crane: "Crane",
  engineer: "Engineer",
  inventor: "Inventor",
  irrigation: "Irrigation",
  medicine: "Medicine",
  mining: "Mining",
  roadBuilding: "Road Building",
  smith: "Smith",
  commercialHarbor: "Commercial Harbor",
  masterMerchant: "Master Merchant",
  merchantFleet: "Merchant Fleet",
  merchant: "Merchant",
  resourceMonopoly: "Resource Monopoly",
  commodityMonopoly: "Commodity Monopoly",
  bishop: "Bishop",
  deserter: "Deserter",
  diplomat: "Diplomat",
  intrigue: "Intrigue",
  saboteur: "Saboteur",
  spy: "Spy",
  warlord: "Warlord",
  wedding: "Wedding",
};
ab("set", "viewport", "1280", "900");
for (const [kind, label] of Object.entries(cards).filter(
  () => process.argv[3] !== "choices",
)) {
  seed(kind);
  click(label);
  if (
    [
      "engineer",
      "medicine",
      "merchant",
      "bishop",
      "diplomat",
      "intrigue",
    ].includes(kind)
  )
    board();
  if (["inventor", "smith"].includes(kind)) board(2);
  if (kind === "alchemist") {
    ab("select", ref("combobox", "Ordinary die"), "3");
    ab("select", ref("combobox", "Red die"), "4");
  }
  if (kind === "merchantFleet")
    ab("select", ref("combobox", "Choose card type"), "coin");
  if (kind === "commodityMonopoly")
    ab("select", ref("combobox", "Choose card type"), "cloth");
  click("Confirm " + label);
  healthy();
  assert(
    !state().cities.players[0].progress.some((card) => card.kind === kind),
    `Card was not consumed: ${label}`,
  );
  console.log(`PASS progress ${label}`);
  passed++;
}
for (const kind of [
  "pillage",
  "aqueduct",
  "metropolis",
  "defenderProgress",
  "discardProgress",
  "relocateKnight",
  "deserterPlace",
  "relocateRoad",
  "wedding",
  "saboteur",
  "deserter",
  "commercialHarbor",
].filter(
  (kind, i, kinds) => !process.argv[4] || i >= kinds.indexOf(process.argv[4]),
)) {
  seed("choice-" + kind);
  const before = state(),
    seq = before.citiesChoiceSeq;
  assert.equal(before.cities.choice.player, 0);
  if (
    [
      "pillage",
      "metropolis",
      "relocateKnight",
      "deserterPlace",
      "relocateRoad",
      "deserter",
    ].includes(kind)
  )
    board(
      1,
      kind === "metropolis"
        ? "Choose a metropolis city "
        : kind === "pillage"
          ? "Choose a city to pillage "
          : kind === "relocateKnight"
            ? "Relocate your displaced knight "
            : kind === "deserterPlace"
              ? "Place your free Deserter knight "
              : kind === "deserter"
                ? "Choose a knight to remove "
                : "Relocate road ",
    );
  if (kind === "discardProgress") click("Alchemist");
  if (kind === "wedding") {
    ab("fill", ref("spinbutton", "Give Paper"), "1");
    ab("fill", ref("spinbutton", "Give Coin"), "1");
  }
  if (kind === "saboteur") {
    // The owned hand contains exactly 36 cards; select a valid 18-card discard.
    for (const [good, n] of [
      ["Lumber", 4],
      ["Brick", 4],
      ["Wool", 4],
      ["Grain", 4],
      ["Paper", 2],
    ])
      ab("fill", ref("spinbutton", "Return " + good), String(n));
  }
  click("Confirm Choice");
  healthy();
  const after = state();
  assert(
    after.phase !== "citiesChoice" ||
      after.citiesChoiceSeq !== seq ||
      after.cities.choice.player !== 0,
    `Choice did not advance: ${kind}`,
  );
  console.log(`PASS owned choice ${kind}`);
  passed++;
}
for (const kind of ["spy", "masterMerchant"]) {
  seed(kind);
  click(cards[kind]);
  click("Confirm " + cards[kind]);
  const peek = state().cities.peek;
  assert(peek);
  if (kind === "spy") click("Merchant");
  else ab("fill", ref("spinbutton", "Take Cloth"), "2");
  click("Confirm Choice");
  healthy();
  assert.equal(state().cities.peek, null);
  console.log(`PASS private choice ${kind}`);
  passed++;
}
console.log(
  `${passed} progress and owned-choice browser flows passed; full matches remain required.`,
);
