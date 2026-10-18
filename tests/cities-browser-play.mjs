import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { attachTestInspector } from "../scripts/test-inspector.mjs";
// Test-only UI decisions; no private application methods or direct action POSTs.
await build({
  entryPoints: ["tests/cities-browser-helpers.ts"],
  outfile: ".sites-runtime/cities-play-helpers.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const {
  candidates,
  citiesMatchActor,
  GOOD_LABELS,
  PROGRESS_LABELS,
  CHOICE_LABELS,
  roadTrails,
  score,
  scenarioTarget,
} = await import("../.sites-runtime/cities-play-helpers.mjs");
const inspector =
  process.env.GUI_SHARED_INSPECTOR === "1"
    ? null
    : await attachTestInspector("http://127.0.0.1:9230");
const ab = process.env.AGENT_BROWSER_BIN || "agent-browser";
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
assert(
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Local browser verification only.",
);
const n = Number(process.env.GUI_PLAYERS || 4),
  selectedMap = process.env.GUI_MAP || "base",
  selectedMode = process.env.GUI_MODE || "citiesKnights",
  selectedScenario = process.env.GUI_SCENARIO || "newShores",
  prefix = process.env.GUI_PREFIX || "cities-play",
  session = (i) => prefix + "-" + i;
assert(Number.isInteger(n) && n >= 3 && n <= 6);
assert(
  ["citiesKnights", "seafarers", "seafarersCitiesKnights"].includes(
    selectedMode,
  ),
);
const hasCities = selectedMode !== "seafarers";
const requirePlayerTrade = process.env.GUI_PLAYER_TRADE === "1";
assert(
  ["newShores", "fourIslands", "fogIslands", "throughDesert"].includes(
    selectedScenario,
  ),
);
const target =
  selectedMode === "citiesKnights"
    ? 13
    : scenarioTarget(selectedScenario, hasCities);
assert(/^[a-z0-9-]{1,64}$/.test(prefix), "Use a simple local session prefix");
const run = (s, ...a) => {
  // File descriptors avoid a Windows descendant retaining the CLI's response
  // pipes after it exits. The files contain ignored local test observations.
  const outPath = `.sites-runtime/${prefix}-cli-output.json`,
    errPath = `.sites-runtime/${prefix}-cli-error.txt`,
    out = openSync(outPath, "w"),
    err = openSync(errPath, "w");
  try {
    execFileSync(ab, ["--session", s, "--json", ...a], {
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", out, err],
    });
  } catch (error) {
    // Some Windows CLI invocations finish with a valid JSON response while an
    // inherited pipe delays process cleanup. Accept only successful, completed
    // read-only results. Never retry or infer success for a gameplay mutation.
    if (
      error.code !== "ETIMEDOUT" ||
      error.status !== 0 ||
      error.signal !== null ||
      !["snapshot", "get", "errors"].includes(a[0])
    )
      throw error;
  } finally {
    closeSync(out);
    closeSync(err);
  }
  const r = JSON.parse(readFileSync(outPath, "utf8"));
  assert(r.success, r.error);
  return r.data;
};
const ev = (s, c) => run(s, "eval", c).result,
  snap = (s) => run(s, "snapshot", "-i");
async function until(f, label = "UI") {
  for (let i = 0; i < 60; i++) {
    const v = f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error(label + " timed out");
}
function ref(s, role, name) {
  const d = snap(s),
    r = Object.entries(d.refs).find(
      ([, r]) =>
        r.role === role &&
        (r.name === name ||
          ([
            "Roll Dice",
            "Road",
            "Ship",
            "Move Ship",
            "Settlement",
            "City",
            "Buy Card",
            "Knight",
            "Road Building",
            "Year of Plenty",
            "Monopoly",
          ].includes(name) &&
            r.name.startsWith(name))),
    );
  assert(r, name + " missing: " + d.snapshot);
  return "@" + r[0];
}
const press = (s, name) => {
  run(s, "focus", ref(s, "button", name));
  run(s, "press", "Enter");
};
const fill = (s, role, name, val) =>
  run(s, "fill", ref(s, role, name), String(val));
const select = (s, name, val) =>
  run(s, "select", ref(s, "combobox", name), String(val));
function instrument(s) {
  ev(
    s,
    '(()=>{if(window.__gui)return;const raw=window.fetch.bind(window);window.__gui={raw,last:null,posts:[]};window.fetch=async(...args)=>{const response=await raw(...args);if(String(args[0]).includes("/api/rooms")){try{const data=await response.clone().json();if(data.game)window.__gui.last=data.game;if(args[1]?.method==="POST")window.__gui.posts.push({body:JSON.parse(args[1].body),status:response.status,revision:data.game?.revision,error:data.error});}catch{}}return response;}})()',
  );
}
let code = process.env.GUI_ROOM || "";
const get = (s) =>
  ev(
    s,
    `(async()=>{const r=await window.__gui.raw('/api/rooms?code=${code}');if(!r.ok)throw Error('Room '+r.status);return (await r.json()).game})()`,
  );
const path = ".sites-runtime/" + prefix + "-" + n + "-proof.json";
const proof = code
  ? JSON.parse(readFileSync(path))
  : {
      players: n,
      actions: 0,
      counts: {},
      progress: {},
      choices: {},
      highlights: {},
      screenshots: [],
      createdAndJoined: false,
    };
const save = () => writeFileSync(path, JSON.stringify(proof, null, 2));
proof.sharedDiagnosticConsumer = process.env.GUI_SHARED_INSPECTOR === "1";
const chooseVertex = (s, label, id) => press(s, label + " " + id);
const chooseTile = (s, id) => {
  const observed = ev(
    s,
    "[...document.querySelectorAll('.cities-choice-board .tile')].map(e=>({role:e.getAttribute('role'),label:e.getAttribute('aria-label')}))",
  );
  assert.equal(observed[id]?.role, "button");
  ev(
    s,
    `document.querySelectorAll('.cities-choice-board .tile')[${id}].focus()`,
  );
  run(s, "press", "Enter");
};
const counters = (s, title, resources) => {
  for (const [r, v] of Object.entries(resources))
    if (v) fill(s, "spinbutton", title + " " + GOOD_LABELS[r], v);
};
async function recordTradeMove(s, before, type) {
  await until(() => get(s).revision > before.revision, "accepted " + type);
  const next = get(s);
  proof.pending.acceptedRevision = next.revision;
  save();
  await until(
    () => ev(s, "window.__gui.posts.at(-1)?.revision") === next.revision,
  );
  const posted = ev(s, "window.__gui.posts.at(-1)");
  assert.equal(next.revision, before.revision + 1);
  assert.equal(posted.status, 200, posted.error);
  assert.equal(posted.body.action.type, type);
  proof.uiTrace ??= [];
  proof.uiTrace.push({
    seat: before.me,
    action: posted.body.action,
    revision: posted.revision,
  });
  proof.actions++;
  proof.counts[type] = (proof.counts[type] || 0) + 1;
  proof.last = { phase: next.phase, turn: next.turn, revision: next.revision };
  delete proof.pending;
  save();
  return next;
}
async function playerTrade(s, g) {
  const views = Array.from({ length: n }, (_, i) => get(session(i)));
  views.forEach((v, i) => assert.equal(v.me, i));
  const own = g.players[g.me].hand;
  let exchange;
  for (let i = 0; i < n && !exchange; i++) {
    if (i === g.me) continue;
    const other = views[i].players[i].hand;
    for (const give of Object.keys(own).filter((r) => own[r] > 0)) {
      const want = Object.keys(other).find((r) => r !== give && other[r] > 0);
      if (want) {
        exchange = { to: i, give, want };
        break;
      }
    }
  }
  if (!exchange) return false;
  const { to, give, want } = exchange;
  const hands = views.map((v, i) => v.players[i].hand);
  const assertNoTransfer = () => {
    for (let i = 0; i < n; i++) {
      const v = get(session(i));
      assert.deepEqual(
        v.players[i].hand,
        hands[i],
        "Consent alone transfers no cards",
      );
      assert.deepEqual(v.bank, g.bank);
    }
  };
  press(s, "Player Trade");
  run(s, "uncheck", ref(s, "checkbox", "Offer to anyone"));
  run(s, "check", ref(s, "checkbox", "Offer to " + g.players[to].name));
  counters(s, "You give", { [give]: 1 });
  counters(s, "You receive", { [want]: 1 });
  assert.equal(get(s).revision, g.revision, "Trade draft is private UI state");
  proof.pending = {
    seat: g.me,
    beforeRevision: g.revision,
    action: {
      type: "offer",
      give: { [give]: 1 },
      want: { [want]: 1 },
      targets: [to],
    },
  };
  save();
  press(s, "Offer Trade");
  const offered = await recordTradeMove(s, g, "offer");
  const offer = offered.offers.find(
    (o) => !g.offers.some((old) => old.id === o.id),
  );
  assert(offer);
  assertNoTransfer();
  const recipient = session(to);
  await until(
    () => ev(recipient, "window.__gui.last?.revision") >= offered.revision,
  );
  const recipientBefore = get(recipient);
  proof.pending = {
    seat: to,
    beforeRevision: recipientBefore.revision,
    action: { type: "accept", id: offer.id },
  };
  save();
  press(recipient, "Accept");
  const accepted = await recordTradeMove(recipient, recipientBefore, "accept");
  assert(accepted.offers.find((o) => o.id === offer.id).accepted.includes(to));
  assertNoTransfer();
  await until(() => ev(s, "window.__gui.last?.revision") >= accepted.revision);
  const executorBefore = get(s);
  proof.pending = {
    seat: g.me,
    beforeRevision: executorBefore.revision,
    action: { type: "completeTrade", id: offer.id, to },
  };
  save();
  press(s, "Trade with " + g.players[to].name);
  const finished = await recordTradeMove(s, executorBefore, "completeTrade");
  assert(!finished.offers.some((o) => o.id === offer.id));
  for (let i = 0; i < n; i++) {
    const v = get(session(i));
    assert.deepEqual(v.bank, g.bank);
    const expected = { ...hands[i] };
    if (i === g.me) {
      expected[give]--;
      expected[want]++;
    }
    if (i === to) {
      expected[give]++;
      expected[want]--;
    }
    assert.deepEqual(
      v.players[i].hand,
      expected,
      "Exactly the consented exchange",
    );
  }
  proof.playerTrade = {
    from: g.me,
    to,
    give,
    want,
    offer: offer.id,
    consentOnlyUntilConfirmation: true,
    bankUnchanged: true,
  };
  save();
  console.log(
    "PASS SEPARATE GUEST PLAYER TRADE",
    JSON.stringify(proof.playerTrade),
  );
  return true;
}
async function expansion(s, g, a) {
  const c = g.cities,
    choice = a.type === "citiesChoice" ? c.choice : null,
    card =
      a.type === "progress"
        ? c.players[g.me].progress.find((x) => x.id === a.cardId)
        : null;
  const labels = {
    placeKnight: "Build knight",
    activateKnight: "Activate knight",
    promoteKnight: "Promote knight",
    wall: "Build city wall",
    improve: "Improve city",
    harborExchange: "Commercial Harbor exchange",
  };
  if (choice) {
    if (
      !snap(s).snapshot.includes('heading "' + CHOICE_LABELS[choice.kind] + '"')
    )
      press(s, "Resolve Choice");
    await until(() =>
      snap(s).snapshot.includes('heading "' + CHOICE_LABELS[choice.kind] + '"'),
    );
  } else {
    press(
      s,
      card
        ? PROGRESS_LABELS[card.kind]
        : a.type === "harborExchange"
          ? "Offer Harbor Exchange"
          : labels[a.type],
    );
    await until(() =>
      snap(s).snapshot.includes(
        'heading "' +
          (card ? PROGRESS_LABELS[card.kind] : labels[a.type]) +
          '"',
      ),
    );
  }
  if (choice) {
    if (a.vertex !== undefined && a.vertex !== null)
      chooseVertex(s, CHOICE_LABELS[choice.kind], a.vertex);
    if (a.edge !== undefined && a.edge !== null)
      chooseVertex(s, "Relocate " + (choice.routeKind || "road"), a.edge);
    if (a.vertex === null || a.edge === null) {
      press(s, "Skip replacement");
      return true;
    }
    if (a.track) select(s, "Progress deck", a.track);
    if (a.resource) select(s, "Aqueduct resource", a.resource);
    if (a.good) select(s, "Commodity to exchange", a.good);
    if (a.cardId !== undefined) {
      const list =
        choice.kind === "spy" ? c.peek.progress : c.players[g.me].progress;
      press(s, PROGRESS_LABELS[list.find((x) => x.id === a.cardId).kind]);
    }
    if (a.resources)
      counters(
        s,
        choice.kind === "masterMerchant"
          ? "Take"
          : choice.kind === "wedding"
            ? "Give"
            : "Return",
        a.resources,
      );
  } else if (card) {
    if (a.track) select(s, "Improvement track", a.track);
    if (a.target !== undefined) select(s, "Choose opponent", a.target);
    if (a.good) select(s, "Choose card type", a.good);
    if (a.dice) {
      select(s, "Ordinary die", a.dice[0]);
      select(s, "Red die", a.dice[1]);
    }
    if (a.vertex !== undefined)
      chooseVertex(s, "Select intersection", a.vertex);
    if (a.edge !== undefined) chooseVertex(s, "Select route", a.edge);
    if (a.knights)
      for (const id of a.knights) chooseVertex(s, "Select intersection", id);
    if (a.tile !== undefined) chooseTile(s, a.tile);
    if (a.tiles) for (const id of a.tiles) chooseTile(s, id);
  } else {
    if (a.id !== undefined) chooseVertex(s, "Select intersection", a.id);
    if (a.track) select(s, "Improvement track", a.track);
    if (a.type === "harborExchange") {
      select(s, "Choose opponent", a.to);
      select(s, "Resource to offer", a.resource);
    }
  }
  const confirm =
    "Confirm " +
    (choice ? "Choice" : card ? PROGRESS_LABELS[card.kind] : labels[a.type]);
  const enabled = ev(
    s,
    `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(confirm)}&&!b.disabled)`,
  );
  if (!enabled) {
    assert(!choice, "mandatory choice disabled " + choice?.kind);
    press(s, "Cancel");
    await until(
      () => !ev(s, "document.querySelector('[role=dialog]')!==null"),
      "dialog closed",
    );
    proof.unavailableChoices = (proof.unavailableChoices || 0) + 1;
    return false;
  }
  if (
    !proof.screenshots.some(
      (x) => x.type === (card?.kind || choice?.kind || a.type),
    )
  )
    proof.screenshots.push({
      type: card?.kind || choice?.kind || a.type,
      path: run(s, "screenshot").path,
    });
  press(s, confirm);
  return true;
}
try {
  for (let i = 0; i < n; i++) {
    if (!code) run(session(i), "open", origin);
    else if (!run(session(i), "get", "url").url.startsWith(origin)) {
      run(
        session(i),
        "state",
        "load",
        `.sites-runtime/${prefix}-${i}-auth.json`,
      );
      run(session(i), "open", origin + "/?room=" + code);
    }
    instrument(session(i));
    run(session(i), "set", "viewport", "1280", "900");
  }
  if (!code) {
    const s = session(0);
    press(s, "Create Room");
    fill(s, "textbox", "Your name", "Cities GUI Host " + n);
    select(s, "Create game mode", selectedMode);
    select(s, "Max players", n);
    if (selectedMode === "citiesKnights")
      select(s, "Create base map", selectedMap);
    else select(s, "Seafarers scenario", selectedScenario);
    press(s, "Create Room");
    await until(() => ev(s, "window.__gui.last?.code"));
    code = ev(s, "window.__gui.last.code");
    proof.code = code;
    save();
  }
  if (!proof.createdAndJoined) {
    const host = session(0);
    await until(() => snap(host).snapshot.includes("Turn timer"));
    if (get(host).turnSeconds !== 0) select(host, "Turn timer", "0");
    for (let i = 1; i < n; i++) {
      const s = session(i);
      if (get(s).me < 0) {
        if (i > 1) {
          run(s, "open", origin + "/?room=" + code);
          instrument(s);
          await until(() => snap(s).snapshot.includes('textbox "Your name"'));
          fill(s, "textbox", "Your name", "Cities GUI Seat " + i);
          press(s, "Join Room");
        } else {
          press(s, "Join Room");
          fill(s, "textbox", "Room code", code);
          fill(s, "textbox", "Your name", "Cities GUI Seat " + i);
          press(s, "Join Room");
        }
      }
      await until(() => get(s).me === i);
      if (!get(s).players[i].ready) press(s, "I’m Ready");
    }
    await until(() =>
      get(host)
        .players.slice(1)
        .every((p) => p.ready),
    );
    await until(() =>
      ev(
        host,
        "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Start Game'&&!b.disabled)",
      ),
    );
    // Actual owned cookies, saved only in ignored local browser state, allow
    // legitimate guest recovery after an automation browser process fails.
    for (let i = 0; i < n; i++)
      run(
        session(i),
        "state",
        "save",
        `.sites-runtime/${prefix}-${i}-auth.json`,
      );
    press(host, "Start Game");
    await until(() => get(host).phase === "setupSettlement");
    proof.createdAndJoined = true;
    save();
    console.log("CREATED AND JOINED CITIES GUI", n, code);
  }
  let latest = get(session(0));
  proof.startRevision ??= latest.revision - proof.actions;
  assert.equal(latest.mode, selectedMode);
  assert.equal(latest.map, selectedMap);
  proof.map = selectedMap;
  proof.mode = selectedMode;
  proof.scenario = latest.scenario;
  assert.equal(latest.target, target);
  while (latest.phase !== "finished" && proof.actions < 6000) {
    const p = citiesMatchActor(latest),
      s = session(p);
    await until(
      () => ev(s, "window.__gui.last?.revision") >= latest.revision,
      "actor view",
    );
    const g = get(s);
    assert.equal(g.me, p);
    assert(!("deck" in g));
    assert(g.players.every((x, i) => i === p || (!x.hand && !x.dev)));
    if (hasCities) {
      assert(!("decks" in g.cities));
      assert(g.cities.players.every((x, i) => i === p || !x.progress));
    }
    if (!["citiesChoice", "discard", "gold"].includes(g.phase))
      await until(
        () => !ev(s, "document.querySelector('[role=dialog]')!==null"),
        "previous dialog closed",
      );
    if (
      requirePlayerTrade &&
      !proof.playerTrade &&
      g.phase === "action" &&
      (await playerTrade(s, g))
    ) {
      latest = get(s);
      continue;
    }
    const before = g.revision,
      postCount = ev(s, "window.__gui.posts.length");
    let action;
    for (const a of candidates(g)) {
      proof.pending = { seat: p, beforeRevision: before, action: a };
      save();
      if (
        [
          "progress",
          "citiesChoice",
          "placeKnight",
          "activateKnight",
          "promoteKnight",
          "wall",
          "improve",
          "harborExchange",
        ].includes(a.type)
      ) {
        if (!(await expansion(s, g, a))) continue;
      } else if (a.type === "moveShip") {
        press(s, "Move Ship");
        const highlighted = ev(
          s,
          "[...document.querySelectorAll('.board-canvas [role=button]')].map(e=>e.getAttribute('aria-label')).filter(x=>x?.startsWith('Select ship ')).map(x=>Number(x.match(/\\d+$/)[0]))",
        );
        assert.deepEqual(
          highlighted.sort((a, b) => a - b),
          [...g.legal.moveShips].sort((a, b) => a - b),
        );
        chooseVertex(s, "Select ship", a.id);
        const destinations = ev(
          s,
          "[...document.querySelectorAll('.board-canvas [role=button]')].map(e=>e.getAttribute('aria-label')).filter(x=>x?.startsWith('Move ship to ')).map(x=>Number(x.match(/\\d+$/)[0]))",
        );
        assert.deepEqual(
          destinations.sort((a, b) => a - b),
          [...g.legal.shipDestinations[a.id]].sort((a, b) => a - b),
        );
        chooseVertex(s, "Move ship to", a.to);
        assert.equal(get(s).revision, before);
        if (!proof.highlights.moveShip) {
          press(s, "Cancel");
          assert.equal(get(s).revision, before);
          chooseVertex(s, "Move ship to", a.to);
          proof.highlights.moveShip = {
            legal: true,
            preview: true,
            cancel: true,
          };
        }
        press(s, "Confirm Placement");
      } else if (
        ["settlement", "road", "ship", "city", "robber", "pirate"].includes(
          a.type,
        )
      ) {
        if (
          (!g.phase.startsWith("setup") &&
            !["roadBuilding", "robber"].includes(g.phase)) ||
          a.type === "ship"
        )
          press(s, a.type[0].toUpperCase() + a.type.slice(1));
        const label =
          a.type === "settlement" &&
          g.phase === "setupSettlement" &&
          g.setupStep >= n &&
          hasCities
            ? "Build city at"
            : "Build " + a.type;
        const raider = ["robber", "pirate"].includes(a.type);
        const expected = raider
          ? [...g.legal.robber, ...g.legal.pirate]
          : g.legal[a.type];
        const targets = raider
          ? ev(
              s,
              "[...document.querySelectorAll('.board-canvas .tile')].flatMap((e,i)=>e.getAttribute('role')==='button'?[i]:[])",
            )
          : ev(
              s,
              `[...document.querySelectorAll('.board-canvas [role=button]')].map(e=>e.getAttribute('aria-label')).filter(x=>x?.startsWith('${label} ')).map(x=>Number(x.match(/\\d+$/)[0]))`,
            );
        assert.deepEqual(
          [...targets].sort((a, b) => a - b),
          [...expected].sort((a, b) => a - b),
        );
        const pick = () => {
          if (raider) {
            ev(
              s,
              `document.querySelectorAll('.board-canvas .tile')[${a.id}].focus()`,
            );
            run(s, "press", "Enter");
          } else chooseVertex(s, label, a.id);
        };
        pick();
        assert.equal(get(s).revision, before);
        if (!proof.highlights[label]) {
          press(s, "Cancel");
          assert.equal(get(s).revision, before);
          pick();
          proof.highlights[label] = {
            legal: true,
            preview: true,
            cancel: true,
          };
        }
        press(s, "Confirm Placement");
      } else if (a.type === "bankTrade") {
        press(s, "Bank Trade");
        select(
          s,
          "Give",
          Object.keys(a.give).find((r) => a.give[r]),
        );
        select(
          s,
          "Receive",
          Object.keys(a.want).find((r) => a.want[r]),
        );
        press(s, "Confirm Trade");
      } else if (a.type === "gold") {
        if (!snap(s).snapshot.includes('heading "Choose Gold Resources"'))
          press(s, "Choose " + g.goldAmount + " Gold Resources");
        await until(() =>
          snap(s).snapshot.includes('heading "Choose Gold Resources"'),
        );
        const selectors = Object.values(snap(s).refs).filter(
          (x) => x.role === "spinbutton",
        );
        assert.equal(selectors.length, 5, "Gold offers only resource counters");
        counters(s, "Take", a.resources);
        press(s, "Confirm");
      } else if (a.type === "plenty") {
        press(s, "Year of Plenty");
        counters(s, "Take", a.resources);
        press(s, "Confirm");
      } else if (a.type === "monopoly") {
        press(s, "Monopoly");
        select(s, "Monopoly resource", a.resource);
        press(s, "Play Monopoly");
      } else if (a.type === "discard") {
        if (
          !snap(s).snapshot.includes('heading "Discard Cards"') &&
          !snap(s).snapshot.includes('heading "Discard Resources"')
        )
          press(s, "Discard " + g.discards[p] + " Cards");
        counters(s, "Return", a.resources);
        press(s, "Confirm");
      } else if (a.type === "steal")
        press(
          s,
          "Steal from " +
            g.players[a.id].name +
            " · " +
            g.players[a.id].publicScore +
            " points",
        );
      else
        press(
          s,
          {
            roll: "Roll Dice",
            end: "End Turn",
            pass: "Finish Building",
            skipRoads: "Skip Free Roads",
            buyDev: "Buy Card",
            knight: "Knight",
            roadBuilding: "Road Building",
            finishHarbor: "Finish Harbor",
          }[a.type] || a.type,
        );
      action = a;
      break;
    }
    assert(action, "No projected legal UI action");
    await until(() => get(s).revision > before, "accepted " + action.type);
    proof.pending.acceptedRevision = get(s).revision;
    save();
    await until(() => ev(s, "window.__gui.posts.length") > postCount);
    const posted = ev(s, "window.__gui.posts.at(-1)");
    assert.equal(posted.status, 200, posted.error);
    assert.equal(posted.body.action.type, action.type);
    latest = get(s);
    proof.uiTrace ??= [];
    proof.uiTrace.push({
      seat: p,
      action: posted.body.action,
      revision: posted.revision,
    });
    proof.actions++;
    proof.counts[action.type] = (proof.counts[action.type] || 0) + 1;
    if (action.type === "progress") {
      const k = g.cities.players[p].progress.find(
        (x) => x.id === action.cardId,
      ).kind;
      proof.progress[k] = (proof.progress[k] || 0) + 1;
    }
    if (action.type === "citiesChoice") {
      const k = g.cities.choice.kind;
      proof.choices[k] = (proof.choices[k] || 0) + 1;
    }
    if (hasCities) assert.equal(latest.army, null);
    latest.players.forEach((x, i) => {
      assert.equal(x.score, score(latest, i));
      assert.equal(
        x.publicScore,
        x.score -
          (hasCities
            ? 0
            : (x.dev?.filter((d) => d.kind === "victory").length ?? 0)),
      );
      assert.equal(x.roadLength, roadTrails(latest, i));
    });
    if (!hasCities && action.type === "buyDev") {
      const cards = latest.players[p].dev;
      const drawn = cards.at(-1).kind;
      proof.developmentDraws ??= {};
      proof.developmentDraws[drawn] = (proof.developmentDraws[drawn] || 0) + 1;
      if (latest.phase !== "finished") {
        await until(
          () =>
            ev(
              s,
              "document.querySelectorAll('.development-hand button').length",
            ) === cards.length,
        );
        const buttons = ev(
          s,
          "[...document.querySelectorAll('.development-hand button')].map(b=>({disabled:b.disabled,title:b.title,text:b.textContent}))",
        );
        cards.forEach((card, i) => {
          if (
            card.kind === "victory" ||
            card.bought >= latest.turn ||
            latest.devPlayed
          )
            assert(buttons[i].disabled);
        });
      }
      const shown = ev(
        s,
        "[...document.querySelectorAll('.player')].map(e=>[...e.querySelectorAll('[title]')].find(x=>x.title==='Victory points')?.textContent.trim())",
      );
      assert.deepEqual(
        shown,
        latest.players.map((x) => "★ " + x.score),
      );
    }
    proof.last = {
      phase: latest.phase,
      turn: latest.turn,
      revision: latest.revision,
    };
    delete proof.pending;
    save();
    if (proof.actions % 25 === 0) {
      save();
      console.log(
        JSON.stringify({
          progress: true,
          n,
          code,
          actions: proof.actions,
          phase: latest.phase,
          turn: latest.turn,
          cards: proof.progress,
          choices: proof.choices,
          attacks: latest.cities?.attacks ?? 0,
          scores: latest.players.map((x) => x.score),
        }),
      );
    }
  }
  assert.equal(latest.phase, "finished");
  assert(latest.players[latest.winner].score >= target);
  if (requirePlayerTrade)
    assert(proof.playerTrade, "Required natural player trade completed");
  proof.finished = {
    winner: latest.winner,
    score: latest.players[latest.winner].score,
    target,
    turn: latest.turn,
    matchId: latest.statistics.id,
  };
  assert.equal(latest.revision - proof.startRevision, proof.actions);
  if (proof.uiTrace.length !== proof.actions)
    throw Error("Incomplete captured UI trace");
  proof.uiTrace.sort((a, b) => a.revision - b.revision);
  assert.equal(proof.uiTrace.length, proof.actions);
  proof.errors = [];
  for (let i = 0; i < n; i++) {
    const e = run(session(i), "errors");
    assert.equal(e.errors.length, 0);
    proof.errors.push(e);
  }
  proof.screenshots.push({
    type: "finished",
    path: run(session(latest.active), "screenshot").path,
  });
  save();
  console.log(
    "PASS COMPLETE CITIES GUI",
    JSON.stringify({
      n,
      code,
      actions: proof.actions,
      counts: proof.counts,
      cards: proof.progress,
      choices: proof.choices,
      finished: proof.finished,
    }),
  );
} catch (e) {
  save();
  throw e;
} finally {
  inspector?.close();
}
