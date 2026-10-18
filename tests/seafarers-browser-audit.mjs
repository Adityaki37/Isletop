import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { replayRules } from "./browser-replay-rules.mjs";
await build({
  entryPoints: ["tests/cities-browser-helpers.ts"],
  outfile: ".sites-runtime/seafarers-audit-helpers.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const { applyReplayPatch, roadTrails, score, scenarioTarget } =
  await import("../.sites-runtime/seafarers-audit-helpers.mjs");
const n = Number(process.argv[2] || 4),
  prefix = process.env.GUI_PREFIX || "seafarers-play";
assert(/^[a-z0-9-]{1,64}$/.test(prefix));
const path = `.sites-runtime/${prefix}-${n}-proof.json`,
  proof = JSON.parse(readFileSync(path));
assert(proof.finished);
assert.equal(proof.mode, "seafarers");
const ab = process.env.AGENT_BROWSER_BIN || "agent-browser";
function ev(code, seat = 0) {
  const output = `.sites-runtime/${prefix}-audit-cli-output.json`;
  const out = openSync(output, "w"),
    err = openSync(`.sites-runtime/${prefix}-audit-cli-error.txt`, "w");
  try {
    execFileSync(
      ab,
      ["--session", `${prefix}-${seat}`, "--json", "eval", code],
      { timeout: 30000, stdio: ["ignore", out, err] },
    );
  } finally {
    closeSync(out);
    closeSync(err);
  }
  const result = JSON.parse(readFileSync(output, "utf8"));
  assert(result.success, result.error);
  return result.data.result;
}
for (let i = 0; i < n; i++)
  assert.equal(
    ev("window.__gui.posts", i).filter(
      (p) =>
        p.body.op === "action" &&
        p.body.code === proof.code &&
        p.status !== 200,
    ).length,
    0,
  );
const moves = proof.uiTrace;
const recoveries = moves.filter((m) => m.source === "persistedReplayRecovery");
assert.equal(recoveries.length, proof.captureRecovery ? 1 : 0);
if (proof.captureRecovery) {
  assert.equal(recoveries[0].revision, proof.captureRecovery.revision);
  assert.equal(recoveries[0].seat, proof.captureRecovery.seat);
  assert.equal(recoveries[0].action.type, proof.captureRecovery.type);
  assert.equal(proof.captureRecovery.rawPostRecovered, false);
}
assert.equal(moves.length, proof.actions);
assert.equal(new Set(moves.map((m) => m.revision)).size, moves.length);
let first = null,
  after = null,
  frames = [];
do {
  const page = ev(
    `(async()=>{const r=await window.__gui.raw('/api/replays?match=${proof.finished.matchId}${after === null ? "" : "&after=" + after}');if(!r.ok)throw Error('Replay '+r.status);return r.json()})()`,
  );
  first ??= page;
  frames.push(...page.frames);
  after = page.next;
} while (after !== null);
assert(first.complete);
assert.equal(first.initialSequence, 0);
assert.equal(frames.length, moves.length);
const rules = replayRules(first.initial, first.summary, proof);
let state = rules.state;
assert.equal(state.deckCount, n <= 4 ? 25 : 34);
const initialFog = state.board.tiles.filter((t) => t.fog).length;
const resources = ["wood", "brick", "sheep", "wheat", "ore"],
  effects = {},
  drawn = {},
  awards = [],
  ties = { longest: 0, army: 0 },
  playedTurns = new Set();
const inc = (object, key) => (object[key] = (object[key] || 0) + 1);
const award = (values, prior, threshold) => {
  const max = Math.max(...values);
  if (max < threshold) return null;
  if (prior !== null && values[prior] === max) return prior;
  const leaders = values.flatMap((v, i) => (v === max ? [i] : []));
  return leaders.length === 1 ? leaders[0] : null;
};
function validate(s, previous = s) {
  assert.equal(s.mode, "seafarers");
  assert.equal(s.cities, null);
  assert.equal(s.target, scenarioTarget(proof.scenario, false));
  assert(!("deck" in s) && !("fogDeck" in s) && !("fogNumbers" in s));
  assert(
    s.board.tiles
      .filter((t) => t.fog)
      .every((t) => t.resource === "sea" && t.number === 0),
  );
  const lengths = s.players.map((_, i) => roadTrails(s, i));
  assert.equal(s.longest, award(lengths, previous.longest, 5));
  assert.equal(
    s.army,
    award(
      s.players.map((p) => p.knights),
      previous.army,
      3,
    ),
  );
  for (const [kind, values, minimum] of [
    ["longest", lengths, 5],
    ["army", s.players.map((p) => p.knights), 3],
  ])
    if (
      Math.max(...values) >= minimum &&
      values.filter((v) => v === Math.max(...values)).length > 1
    )
      ties[kind]++;
  s.players.forEach((p, i) => {
    assert.equal(p.roadLength, lengths[i]);
    assert.equal(p.score, score(s, i));
    assert.equal(
      p.publicScore,
      p.score - p.dev.filter((d) => d.kind === "victory").length,
    );
    assert(
      s.board.edges.filter((e) => e.owner === i && e.kind !== "ship").length <=
        15,
    );
    assert(
      s.board.edges.filter((e) => e.owner === i && e.kind === "ship").length <=
        15,
    );
    assert(
      s.board.vertices.filter((v) => v.owner === i && !v.city).length <= 5,
    );
    assert(s.board.vertices.filter((v) => v.owner === i && v.city).length <= 4);
    resources.forEach((r) =>
      assert(Number.isInteger(p.hand[r]) && p.hand[r] >= 0),
    );
    if (proof.scenario === "fogIslands") assert.equal(p.islandBonus, 0);
  });
  resources.forEach((r) =>
    assert.equal(
      s.bank[r] + s.players.reduce((sum, p) => sum + p.hand[r], 0),
      n <= 4 ? 19 : 24,
    ),
  );
  for (const v of s.board.vertices.filter((v) => v.owner !== null))
    assert(
      v.edges.every((id) => {
        const e = s.board.edges[id];
        return s.board.vertices[e.a === v.id ? e.b : e.a].owner === null;
      }),
    );
}
validate(state);
frames.forEach((frame, i) => {
  const old = structuredClone(state),
    { action: a, seat: p } = moves[i];
  state = applyReplayPatch(state, frame.patch);
  state = rules.advance(state, old, moves[i]);
  assert.equal(frame.sequence, i + 1);
  assert.equal(frame.action, a.type);
  assert.equal(frame.seat, p);
  if (moves[i].source === "persistedReplayRecovery")
    assert.equal(frame.sequence, proof.captureRecovery.sequence);
  validate(state, old);
  inc(effects, a.type);
  const before = old.players[p],
    now = state.players[p];
  const cost = ["action", "special"].includes(old.phase)
    ? {
        road: { wood: 1, brick: 1 },
        ship: { wood: 1, sheep: 1 },
        settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
        city: { wheat: 2, ore: 3 },
      }[a.type] || {}
    : {};
  const discovered = state.board.tiles.filter(
      (t) => !t.fog && old.board.tiles[t.id].fog,
    ),
    reward = Object.fromEntries(resources.map((r) => [r, 0]));
  if (discovered.length) {
    assert(["road", "ship", "moveShip"].includes(a.type));
    const edge = state.board.edges[a.type === "moveShip" ? a.to : a.id];
    for (const t of discovered) {
      assert(
        [edge.a, edge.b].some((v) =>
          state.board.vertices[v].tiles.includes(t.id),
        ),
      );
      assert(t.resource !== "desert");
      assert(
        t.resource === "sea"
          ? t.number === 0
          : t.number >= 2 && t.number <= 12 && t.number !== 7,
      );
      if (
        resources.includes(t.resource) &&
        old.bank[t.resource] + (cost[t.resource] || 0) > reward[t.resource]
      )
        reward[t.resource]++;
    }
    effects.fogDiscoveries = (effects.fogDiscoveries || 0) + discovered.length;
  }
  if (["road", "ship"].includes(a.type)) {
    const e = old.board.edges[a.id],
      placed = state.board.edges[a.id];
    assert.equal(e.owner, null);
    assert.equal(placed.owner, p);
    assert.equal(placed.kind, a.type);
    assert(
      (a.type === "ship" && e.tiles.length === 1) ||
        e.tiles.some((id) =>
          a.type === "ship"
            ? old.board.tiles[id].resource === "sea"
            : old.board.tiles[id].resource !== "sea",
        ),
    );
    assert(
      [e.a, e.b].some((id) => {
        const v = old.board.vertices[id];
        return (
          v.owner === p ||
          (v.owner === null &&
            v.edges.some(
              (id) =>
                old.board.edges[id].owner === p &&
                (old.board.edges[id].kind || "road") === a.type,
            ))
        );
      }),
    );
    for (const r of resources) {
      assert.equal(now.hand[r], before.hand[r] - (cost[r] || 0) + reward[r]);
      assert.equal(state.bank[r], old.bank[r] + (cost[r] || 0) - reward[r]);
    }
  }
  if (a.type === "moveShip") {
    const source = old.board.edges[a.id];
    assert.equal(source.owner, p);
    assert.equal(source.kind, "ship");
    assert.notEqual(source.built, old.turn);
    assert(!old.shipMoved);
    assert.equal(state.board.edges[a.id].owner, null);
    assert.equal(old.board.edges[a.to].owner, null);
    assert.equal(state.board.edges[a.to].owner, p);
    assert.equal(state.board.edges[a.to].kind, "ship");
    assert.equal(state.board.edges[a.to].built, old.turn);
    assert(state.shipMoved);
    resources.forEach((r) =>
      assert.equal(now.hand[r], before.hand[r] + reward[r]),
    );
  }
  if (["settlement", "city"].includes(a.type)) {
    const v = old.board.vertices[a.id];
    assert.equal(state.board.vertices[a.id].owner, p);
    if (a.type === "city") {
      assert.equal(v.owner, p);
      assert(!v.city);
      assert(state.board.vertices[a.id].city);
    } else {
      assert.equal(v.owner, null);
      assert(
        v.tiles.some(
          (id) =>
            !old.board.tiles[id].fog && old.board.tiles[id].resource !== "sea",
        ),
      );
      if (old.phase !== "setupSettlement")
        assert(v.edges.some((id) => old.board.edges[id].owner === p));
      else assert(v.tiles.some((id) => old.board.tiles[id].home));
    }
    if (!old.phase.startsWith("setup"))
      resources.forEach((r) =>
        assert.equal(now.hand[r], before.hand[r] - (cost[r] || 0)),
      );
  }
  if (a.type === "gold") {
    assert.equal(old.phase, "gold");
    assert.equal(
      Object.values(a.resources).reduce((s, v) => s + v, 0),
      Math.min(
        old.goldClaims[p],
        resources.reduce((s, r) => s + old.bank[r], 0),
      ),
    );
    for (const r of resources) {
      assert.equal(now.hand[r], before.hand[r] + a.resources[r]);
      assert.equal(state.bank[r], old.bank[r] - a.resources[r]);
    }
    assert(!state.goldClaims[p]);
  }
  if (a.type === "buyDev") {
    assert.equal(state.deckCount, old.deckCount - 1);
    assert.equal(now.dev.length, before.dev.length + 1);
    const card = now.dev.at(-1);
    assert.equal(card.bought, old.turn);
    inc(drawn, card.kind);
    for (const r of resources)
      assert.equal(
        now.hand[r],
        before.hand[r] - (["sheep", "wheat", "ore"].includes(r) ? 1 : 0),
      );
  }
  if (["knight", "roadBuilding", "plenty", "monopoly"].includes(a.type)) {
    const key = `${old.turn}:${p}`;
    assert(!playedTurns.has(key));
    playedTurns.add(key);
    assert(["roll", "action"].includes(old.phase));
    assert(before.dev.some((d) => d.kind === a.type && d.bought < old.turn));
    assert.equal(now.dev.length, before.dev.length - 1);
    if (a.type === "knight") assert.equal(now.knights, before.knights + 1);
    if (a.type === "roadBuilding") assert.deepEqual(now.hand, before.hand);
    if (a.type === "plenty") {
      assert.equal(
        Object.values(a.resources).reduce((s, v) => s + v, 0),
        2,
      );
      resources.forEach((r) => {
        assert.equal(now.hand[r], before.hand[r] + a.resources[r]);
        assert.equal(state.bank[r], old.bank[r] - a.resources[r]);
      });
    }
    if (a.type === "monopoly") {
      assert.deepEqual(state.bank, old.bank);
      const taken = old.players.reduce((s, pl) => s + pl.hand[a.resource], 0);
      state.players.forEach((pl, seat) =>
        resources.forEach((r) =>
          assert.equal(
            pl.hand[r],
            r === a.resource
              ? seat === p
                ? taken
                : 0
              : old.players[seat].hand[r],
          ),
        ),
      );
    }
  }
  if (a.type === "robber") assert.equal(state.board.robber, a.id);
  if (a.type === "pirate") {
    assert.equal(state.board.pirate, a.id);
    assert.notEqual(old.board.pirate, a.id);
    assert.equal(old.board.tiles[a.id].resource, "sea");
    assert(!old.board.tiles[a.id].fog);
  }
  if (["offer", "accept"].includes(a.type)) {
    assert.deepEqual(state.bank, old.bank);
    state.players.forEach((pl, seat) =>
      assert.deepEqual(pl.hand, old.players[seat].hand),
    );
  }
  if (a.type === "completeTrade") {
    const offer = old.offers.find((o) => o.id === a.id);
    assert(offer);
    assert.equal(offer.from, p);
    assert(offer.accepted.includes(a.to));
    assert.deepEqual(state.bank, old.bank);
    state.players.forEach((pl, seat) =>
      resources.forEach((r) =>
        assert.equal(
          pl.hand[r],
          old.players[seat].hand[r] +
            (seat === p
              ? (offer.want[r] || 0) - (offer.give[r] || 0)
              : seat === a.to
                ? (offer.give[r] || 0) - (offer.want[r] || 0)
                : 0),
        ),
      ),
    );
  }
  if (a.type === "bankTrade") {
    const give = resources.find((r) => a.give[r]),
      want = resources.find((r) => a.want[r]);
    let rate = 4;
    for (const port of old.board.ports) {
      const e = old.board.edges[port.edge];
      if ([e.a, e.b].some((v) => old.board.vertices[v].owner === p))
        rate = Math.min(
          rate,
          port.resource === give ? 2 : port.resource === "any" ? 3 : 4,
        );
    }
    assert.equal(a.give[give], rate);
    assert.equal(a.want[want], 1);
    resources.forEach((r) => {
      assert.equal(
        now.hand[r],
        before.hand[r] - (a.give[r] || 0) + (a.want[r] || 0),
      );
      assert.equal(
        state.bank[r],
        old.bank[r] + (a.give[r] || 0) - (a.want[r] || 0),
      );
    });
  }
  if (a.type === "discard")
    resources.forEach((r) => {
      assert.equal(now.hand[r], before.hand[r] - a.resources[r]);
      assert.equal(state.bank[r], old.bank[r] + a.resources[r]);
    });
  if (a.type === "steal") {
    assert.equal(now.resources, before.resources + 1);
    assert.equal(
      state.players[a.id].resources,
      old.players[a.id].resources - 1,
    );
    assert.deepEqual(state.bank, old.bank);
  }
  for (const kind of ["longest", "army"])
    if (state[kind] !== old[kind])
      awards.push({
        kind,
        from: old[kind],
        to: state[kind],
        sequence: frame.sequence,
      });
});
assert.equal(state.phase, "finished");
assert.equal(state.winner, proof.finished.winner);
assert.equal(state.target, proof.finished.target);
assert(state.players[state.winner].score >= state.target);
const supply =
  n <= 4
    ? { knight: 14, roadBuilding: 2, plenty: 2, monopoly: 2, victory: 5 }
    : { knight: 20, roadBuilding: 3, plenty: 3, monopoly: 3, victory: 5 };
for (const [kind, count] of Object.entries(drawn))
  assert(count <= supply[kind]);
assert.equal(
  state.deckCount,
  Object.values(supply).reduce((s, v) => s + v, 0) -
    Object.values(drawn).reduce((s, v) => s + v, 0),
);
proof.replayAudit = {
  reconstructedLegacyPublicFields: rules.legacy,
  rawUiRequestsCaptured: moves.length - recoveries.length,
  recoveredAcceptedUiMoves: recoveries.length,
  contextRecovery: proof.captureRecovery ?? null,
  frames: frames.length,
  drawn,
  effects,
  awards,
  ties,
  fogRevealed: initialFog - state.board.tiles.filter((t) => t.fog).length,
  finiteInventories: true,
  independentMixedRoutesAndPoints: true,
  everyMoveInitiatedThroughUi: true,
  finalScoreBreakdown: state.players.map((pl, seat) => ({
    seat,
    buildings: state.board.vertices
      .filter((v) => v.owner === seat)
      .reduce((s, v) => s + (v.city ? 2 : 1), 0),
    longest: state.longest === seat ? 2 : 0,
    army: state.army === seat ? 2 : 0,
    island: pl.islandBonus,
    hiddenVictory: pl.dev.filter((d) => d.kind === "victory").length,
    total: pl.score,
  })),
};
writeFileSync(path, JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof.replayAudit));
