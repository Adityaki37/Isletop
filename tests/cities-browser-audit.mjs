import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { replayRules } from "./browser-replay-rules.mjs";
await build({
  entryPoints: ["tests/cities-browser-helpers.ts"],
  outfile: ".sites-runtime/cities-audit-helpers.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const { applyReplayPatch, roadTrails, score } =
  await import("../.sites-runtime/cities-audit-helpers.mjs");
const n = Number(process.argv[2] || 4),
  prefix = process.env.GUI_PREFIX || "cities-play",
  path = ".sites-runtime/" + prefix + "-" + n + "-proof.json",
  proof = JSON.parse(readFileSync(path));
assert(/^[a-z0-9-]{1,64}$/.test(prefix), "Use a simple local session prefix");
assert(proof.finished);
const ab = process.env.AGENT_BROWSER_BIN || "agent-browser";
const ev = (c, seat = 0) => {
  const outPath = `.sites-runtime/${prefix}-audit-cli-output.json`,
    out = openSync(outPath, "w"),
    err = openSync(`.sites-runtime/${prefix}-audit-cli-error.txt`, "w");
  try {
    execFileSync(ab, ["--session", prefix + "-" + seat, "--json", "eval", c], {
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", out, err],
    });
  } finally {
    closeSync(out);
    closeSync(err);
  }
  const r = JSON.parse(readFileSync(outPath, "utf8"));
  assert(r.success, r.error);
  return r.data.result;
};
const moves = proof.uiTrace;
const rejected = [];
for (let seat = 0; seat < n; seat++)
  rejected.push(
    ...ev("window.__gui.posts", seat).filter(
      (p) =>
        p.body.op === "action" &&
        p.body.code === proof.code &&
        p.status !== 200,
    ),
  );
assert.equal(
  rejected.length,
  0,
  "No rejected gameplay requests in the accepted UI playthrough.",
);
assert.equal(moves.length, proof.actions);
assert.equal(new Set(moves.map((x) => x.revision)).size, moves.length);
let after = null,
  first = null,
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
const initialFog = state.board.tiles.filter((t) => t.fog).length;
const goods = [
    "wood",
    "brick",
    "sheep",
    "wheat",
    "ore",
    "paper",
    "cloth",
    "coin",
  ],
  tracks = ["science", "trade", "politics"];
const cards = {},
  choices = {},
  effects = {},
  awards = [],
  ties = { longest: 0 },
  barbarians = [];
const inc = (o, k) => (o[k] = (o[k] || 0) + 1);
const holder = (lengths, prior) => {
  const max = Math.max(...lengths);
  if (max < 5) return null;
  if (prior !== null && lengths[prior] === max) return prior;
  const leaders = lengths.flatMap((v, i) => (v === max ? [i] : []));
  return leaders.length === 1 ? leaders[0] : null;
};
function validate(s, old = s) {
  assert(!("fogDeck" in s) && !("fogNumbers" in s));
  assert(
    s.board.tiles
      .filter((t) => t.fog)
      .every((t) => t.resource === "sea" && t.number === 0),
  );
  assert.equal(s.army, null);
  if (s.map === "blackForest") {
    assert.equal(s.board.tiles.length, 61);
    assert.equal(s.board.tiles.filter((t) => t.home).length, 24);
    assert.equal(
      s.board.tiles.filter((t) => !t.fog && t.resource === "wood").length,
      24,
    );
    assert.equal(
      s.board.tiles.filter((t) => !t.fog && t.resource === "sea").length,
      6,
    );
    assert.equal(
      s.board.tiles.filter((t) => t.resource === "desert").length,
      1,
    );
    assert.equal(s.board.ports.length, 6);
    assert(s.board.ports.every((port) => port.resource === "wood"));
    assert(s.board.tiles.filter((t) => t.fog).every((t) => !t.home));
    assert(
      s.board.edges
        .filter((e) => e.owner !== null)
        .every((e) => e.kind !== "ship"),
    );
  }
  const lengths = s.players.map((_, i) => roadTrails(s, i));
  assert.equal(
    s.longest,
    s.cities.choice?.kind === "relocateRoad"
      ? old.longest
      : holder(lengths, old.longest),
  );
  if (
    Math.max(...lengths) >= 5 &&
    lengths.filter((x) => x === Math.max(...lengths)).length > 1
  )
    ties.longest++;
  const allCards = s.players
    .flatMap((p) => p.progress)
    .concat(s.cities.players.flatMap((p) => p.revealed));
  assert.equal(
    allCards.length +
      Object.values(s.cities.deckCounts).reduce((a, x) => a + x, 0),
    54,
  );
  assert.equal(new Set(allCards.map((c) => c.id)).size, allCards.length);
  for (const track of tracks)
    assert.equal(
      allCards.filter((c) => c.track === track).length +
        s.cities.deckCounts[track],
      18,
    );
  for (const [i, p] of s.players.entries()) {
    assert.equal(p.score, score(s, i));
    assert.equal(p.publicScore, p.score);
    assert.equal(p.roadLength, lengths[i]);
    assert.equal(
      p.resources,
      goods.reduce((sum, r) => sum + p.hand[r], 0),
    );
    for (const r of goods)
      assert(Number.isInteger(p.hand[r]) && p.hand[r] >= 0);
    assert(
      s.board.edges.filter((e) => e.owner === i && e.kind !== "ship").length <=
        15,
    );
    assert(
      s.board.edges.filter((e) => e.owner === i && e.kind === "ship").length <=
        15,
    );
    const vertices = s.board.vertices.filter((v) => v.owner === i);
    assert(vertices.filter((v) => v.city).length <= 4);
    assert(
      vertices.filter((v) => !v.city).length <=
        5 + s.cities.players[i].demotedCities.length,
    );
    assert(
      s.cities.walls.filter((v) => s.board.vertices[v].owner === i).length <= 3,
    );
    assert(
      s.cities.players[i].revealed.every((c) =>
        ["printer", "constitution"].includes(c.kind),
      ),
    );
    for (const level of [1, 2, 3])
      assert(
        s.cities.knights.filter((k) => k.owner === i && k.level === level)
          .length <= 2,
      );
  }
  for (const r of goods) {
    assert(Number.isInteger(s.bank[r]) && s.bank[r] >= 0);
    assert.equal(
      s.bank[r] + s.players.reduce((sum, p) => sum + p.hand[r], 0),
      ["paper", "cloth", "coin"].includes(r)
        ? n <= 4
          ? 12
          : 18
        : n <= 4
          ? 19
          : 24,
    );
  }
  for (const v of s.board.vertices.filter((v) => v.owner !== null))
    assert(
      v.edges.every((id) => {
        const e = s.board.edges[id];
        return s.board.vertices[e.a === v.id ? e.b : e.a].owner === null;
      }),
    );
  assert.equal(new Set(s.cities.walls).size, s.cities.walls.length);
  for (const v of s.cities.walls) assert(s.board.vertices[v].city);
  for (const k of s.cities.knights) {
    assert.equal(s.board.vertices[k.vertex].owner, null);
    assert(k.level >= 1 && k.level <= 3);
  }
  for (const track of tracks) {
    const m = s.cities.metropolises[track];
    if (m) {
      assert.equal(s.board.vertices[m.vertex].owner, m.owner);
      assert(s.board.vertices[m.vertex].city);
      assert(s.cities.players[m.owner].improvements[track] >= 4);
    }
  }
}
validate(state);
frames.forEach((frame, i) => {
  const old = structuredClone(state);
  state = applyReplayPatch(state, frame.patch);
  const move = moves[i],
    a = move.action,
    p = move.seat;
  state = rules.advance(state, old, move);
  assert.equal(move.revision, proof.startRevision + i + 1);
  assert.equal(frame.sequence, i + 1);
  assert.equal(frame.seat, p);
  assert.equal(frame.action, a.type);
  validate(state, old);
  inc(effects, a.type);
  for (const track of tracks) {
    const prior = old.cities.metropolises[track],
      current = state.cities.metropolises[track];
    if (prior && current && prior.owner !== current.owner)
      inc(effects, "metropolisTransfer");
  }
  if (
    old.cities.merchant &&
    state.cities.merchant &&
    old.cities.merchant.owner !== state.cities.merchant.owner
  )
    inc(effects, "merchantTransfer");
  const before = old.players[p],
    now = state.players[p];
  if (
    state.map === "blackForest" &&
    a.type === "settlement" &&
    old.phase === "setupSettlement"
  ) {
    assert(
      old.board.vertices[a.id].tiles.some((id) => old.board.tiles[id].home),
    );
    inc(effects, "originalForestSetup");
  }
  const discovered = state.board.tiles.filter(
      (t) => !t.fog && old.board.tiles[t.id].fog,
    ),
    discoveryRewards = Object.fromEntries(goods.map((r) => [r, 0]));
  const paidRoad =
    a.type === "road" && ["action", "special"].includes(old.phase);
  const paidShip =
    a.type === "ship" && ["action", "special"].includes(old.phase);
  if (discovered.length) {
    assert(
      ["road", "ship", "moveShip", "citiesChoice"].includes(a.type),
      "Fog reveals on a placed or relocated road",
    );
    for (const t of discovered) {
      assert(t.resource !== "desert");
      assert(
        t.resource === "sea"
          ? t.number === 0
          : t.number >= 2 && t.number <= 12 && t.number !== 7,
      );
      if (
        !["gold", "sea"].includes(t.resource) &&
        old.bank[t.resource] +
          Number(paidRoad && ["wood", "brick"].includes(t.resource)) +
          Number(paidShip && ["wood", "sheep"].includes(t.resource)) >
          discoveryRewards[t.resource]
      )
        discoveryRewards[t.resource]++;
    }
    inc(effects, "fogDiscoveries");
  }
  if (a.type === "gold") {
    assert.equal(old.phase, "gold");
    assert.equal(
      goods.reduce((s, r) => s + (a.resources[r] || 0), 0),
      Math.min(
        old.goldClaims[p],
        goods.slice(0, 5).reduce((s, r) => s + old.bank[r], 0),
      ),
    );
    for (const r of goods) {
      assert.equal(now.hand[r], before.hand[r] + (a.resources[r] || 0));
      assert.equal(state.bank[r], old.bank[r] - (a.resources[r] || 0));
      if (["paper", "cloth", "coin"].includes(r))
        assert.equal(a.resources[r] || 0, 0);
    }
    assert(!state.goldClaims[p]);
  }
  if (["offer", "accept"].includes(a.type)) {
    assert.deepEqual(state.bank, old.bank);
    state.players.forEach((player, seat) =>
      assert.deepEqual(player.hand, old.players[seat].hand),
    );
  }
  if (a.type === "completeTrade") {
    const offer = old.offers.find((o) => o.id === a.id);
    assert(offer);
    assert.equal(offer.from, p);
    assert(offer.accepted.includes(a.to));
    assert.deepEqual(state.bank, old.bank);
    state.players.forEach((player, seat) =>
      goods.forEach((r) => {
        const change =
          seat === p
            ? (offer.want[r] || 0) - (offer.give[r] || 0)
            : seat === a.to
              ? (offer.give[r] || 0) - (offer.want[r] || 0)
              : 0;
        assert.equal(player.hand[r], old.players[seat].hand[r] + change);
      }),
    );
  }
  if (a.type === "progress") {
    const card = before.progress.find((c) => c.id === a.cardId);
    assert(card);
    assert(!now.progress.some((c) => c.id === card.id));
    inc(cards, card.kind);
    if (card.kind === "merchant") {
      const tile = old.board.tiles[a.tile];
      assert(
        !tile.fog && !["sea", "gold"].includes(tile.resource),
        "Merchant cannot occupy sea, fog or gold",
      );
      assert(tile.vertices.some((id) => old.board.vertices[id].owner === p));
      assert.deepEqual(state.cities.merchant, { owner: p, tile: a.tile });
    }
    if (card.kind === "bishop") {
      assert(old.cities.attacks > 0);
      const tile = old.board.tiles[a.tile];
      assert(!tile.fog && tile.resource !== "sea");
      assert.notEqual(a.tile, old.board.robber);
      assert.equal(state.board.robber, a.tile);
      assert.equal(state.board.pirate, old.board.pirate);
      assert.deepEqual(state.bank, old.bank);
      const victims = new Set(
        tile.vertices
          .map((id) => old.board.vertices[id].owner)
          .filter((owner) => owner !== null && owner !== p),
      );
      let stolen = 0;
      state.players.forEach((player, seat) => {
        if (seat === p) return;
        const take = Number(
          victims.has(seat) && old.players[seat].resources > 0,
        );
        stolen += take;
        assert.equal(player.resources, old.players[seat].resources - take);
        goods.forEach((r) =>
          assert([0, 1].includes(old.players[seat].hand[r] - player.hand[r])),
        );
      });
      assert.equal(now.resources, before.resources + stolen);
      goods.forEach((r) =>
        assert.equal(
          now.hand[r] - before.hand[r],
          old.players.reduce(
            (sum, player, seat) =>
              sum +
              (seat === p ? 0 : player.hand[r] - state.players[seat].hand[r]),
            0,
          ),
        ),
      );
    }
    if (card.kind === "intrigue") {
      const victim = old.cities.knights.find((k) => k.vertex === a.vertex);
      assert(victim && victim.owner !== p);
      assert(
        old.board.vertices[a.vertex].edges.some(
          (id) => old.board.edges[id].owner === p,
        ),
      );
      assert(!state.cities.knights.some((k) => k.vertex === a.vertex));
      assert.deepEqual(
        state.cities.knights,
        old.cities.knights.filter((k) => k.vertex !== a.vertex),
      );
      assert.deepEqual(now.hand, before.hand);
      assert.deepEqual(state.bank, old.bank);
      if (state.cities.choice?.kind === "relocateKnight")
        assert.equal(state.cities.choice.player, victim.owner);
    }
    if (card.kind === "medicine") {
      assert.equal(old.board.vertices[a.vertex].owner, p);
      assert(!old.board.vertices[a.vertex].city);
      assert.equal(state.board.vertices[a.vertex].owner, p);
      assert(state.board.vertices[a.vertex].city);
      for (const r of goods) {
        const cost = r === "ore" ? 2 : r === "wheat" ? 1 : 0;
        assert.equal(now.hand[r], before.hand[r] - cost);
        assert.equal(state.bank[r], old.bank[r] + cost);
      }
    }
    if (card.kind === "crane") {
      const level = old.cities.players[p].improvements[a.track],
        resource = { science: "paper", trade: "cloth", politics: "coin" }[
          a.track
        ];
      assert.equal(state.cities.players[p].improvements[a.track], level + 1);
      for (const r of goods) {
        assert.equal(
          now.hand[r],
          before.hand[r] - (r === resource ? level : 0),
        );
        assert.equal(state.bank[r], old.bank[r] + (r === resource ? level : 0));
      }
    }
    if (card.kind === "inventor") {
      const [aTile, bTile] = a.tiles;
      assert(aTile !== bTile);
      assert(
        [aTile, bTile].every(
          (id) =>
            !old.board.tiles[id].fog &&
            [3, 4, 5, 9, 10, 11].includes(old.board.tiles[id].number),
        ),
      );
      assert.equal(
        state.board.tiles[aTile].number,
        old.board.tiles[bTile].number,
      );
      assert.equal(
        state.board.tiles[bTile].number,
        old.board.tiles[aTile].number,
      );
    }
    if (["irrigation", "mining"].includes(card.kind)) {
      const resource = card.kind === "irrigation" ? "wheat" : "ore";
      const hexes = old.board.tiles.filter(
        (t) =>
          t.resource === resource &&
          t.vertices.some((id) => old.board.vertices[id].owner === p),
      ).length;
      const amount = Math.min(2 * hexes, old.bank[resource]);
      for (const r of goods) {
        assert.equal(
          now.hand[r],
          before.hand[r] + (r === resource ? amount : 0),
        );
        assert.equal(
          state.bank[r],
          old.bank[r] - (r === resource ? amount : 0),
        );
      }
    }
  }
  if (a.type === "citiesChoice") inc(choices, old.cities.choice.kind);
  if (
    [
      "placeKnight",
      "activateKnight",
      "promoteKnight",
      "wall",
      "improve",
    ].includes(a.type)
  ) {
    const cost =
      a.type === "improve"
        ? {
            [{ science: "paper", trade: "cloth", politics: "coin" }[a.track]]:
              old.cities.players[p].improvements[a.track] + 1,
          }
        : a.type === "wall"
          ? { brick: 2 }
          : a.type === "activateKnight"
            ? { wheat: 1 }
            : { sheep: 1, ore: 1 };
    for (const r of goods) {
      assert.equal(now.hand[r], before.hand[r] - (cost[r] || 0));
      assert.equal(state.bank[r], old.bank[r] + (cost[r] || 0));
    }
    if (a.type === "improve")
      assert.equal(
        state.cities.players[p].improvements[a.track],
        old.cities.players[p].improvements[a.track] + 1,
      );
    if (a.type === "placeKnight") {
      assert(!old.cities.knights.some((k) => k.vertex === a.id));
      assert(
        state.cities.knights.some(
          (k) =>
            k.vertex === a.id && k.owner === p && k.level === 1 && !k.active,
        ),
      );
    }
    if (a.type === "activateKnight")
      assert(
        state.cities.knights.some(
          (k) => k.vertex === a.id && k.owner === p && k.active,
        ),
      );
    if (a.type === "promoteKnight")
      assert.equal(
        state.cities.knights.find((k) => k.vertex === a.id).level,
        old.cities.knights.find((k) => k.vertex === a.id).level + 1,
      );
  }
  if (["settlement", "city", "road", "ship"].includes(a.type)) {
    const piece = ["road", "ship"].includes(a.type)
      ? state.board.edges[a.id]
      : state.board.vertices[a.id];
    assert.equal(piece.owner, p);
    if (a.type === "city") assert(piece.city);
    if (a.type === "ship") {
      assert.equal(piece.kind, "ship");
      assert.equal(piece.built, old.turn);
    }
    if (!old.phase.startsWith("setup") && !old.cities.freeRoutes) {
      const cost = {
        road: { wood: 1, brick: 1 },
        ship: { wood: 1, sheep: 1 },
        settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
        city: { ore: 3, wheat: 2 },
      }[a.type];
      for (const r of goods)
        assert.equal(
          now.hand[r],
          before.hand[r] - (cost[r] || 0) + discoveryRewards[r],
        );
    }
  }
  if (a.type === "discard")
    for (const r of goods) {
      assert.equal(now.hand[r], before.hand[r] - (a.resources[r] || 0));
      assert.equal(state.bank[r], old.bank[r] + (a.resources[r] || 0));
    }
  if (a.type === "bankTrade")
    for (const r of goods) {
      assert.equal(
        now.hand[r],
        before.hand[r] - (a.give[r] || 0) + (a.want[r] || 0),
      );
      assert.equal(
        state.bank[r],
        old.bank[r] + (a.give[r] || 0) - (a.want[r] || 0),
      );
    }
  if (
    a.type === "bankTrade" &&
    state.map === "blackForest" &&
    a.give.wood > 0 &&
    old.board.ports.some((port) => {
      const e = old.board.edges[port.edge];
      return [e.a, e.b].some((id) => old.board.vertices[id].owner === p);
    })
  ) {
    assert.equal(
      a.give.wood,
      2 * goods.reduce((sum, r) => sum + (a.want[r] || 0), 0),
    );
    inc(effects, "woodPortTrade");
  }
  if (
    a.type === "citiesChoice" &&
    old.cities.choice.kind === "harborExchange"
  ) {
    const c = old.cities.choice;
    // Spectator replay projections omit the offered resource. Reconcile it
    // against the captured offer that actually opened this owned choice.
    const offer = moves[i - 1];
    assert.equal(offer.action.type, "harborExchange");
    assert.equal(offer.seat, c.to);
    assert.equal(offer.action.to, p);
    const resource = offer.action.resource;
    assert(old.players[c.to].hand[resource] > 0);
    assert(before.hand[a.good] > 0);
    for (const r of goods) {
      const delta = (r === resource ? 1 : 0) - (r === a.good ? 1 : 0);
      assert.equal(now.hand[r], before.hand[r] + delta);
      assert.equal(
        state.players[c.to].hand[r],
        old.players[c.to].hand[r] - delta,
      );
    }
    assert.deepEqual(state.bank, old.bank);
  }
  if (a.type === "robber") assert.equal(state.board.robber, a.id);
  if (a.type === "pirate") {
    assert.equal(state.board.pirate, a.id);
    assert.equal(old.board.tiles[a.id].resource, "sea");
    assert(!old.board.tiles[a.id].fog);
  }
  if (a.type === "moveShip") {
    assert.equal(old.board.edges[a.id].owner, p);
    assert.equal(old.board.edges[a.id].kind, "ship");
    assert.notEqual(old.board.edges[a.id].built, old.turn);
    assert.equal(state.board.edges[a.id].owner, null);
    assert.equal(state.board.edges[a.to].owner, p);
    assert.equal(state.board.edges[a.to].kind, "ship");
    assert.equal(state.board.edges[a.to].built, old.turn);
    assert(state.shipMoved);
    for (const r of goods)
      assert.equal(now.hand[r], before.hand[r] + discoveryRewards[r]);
  }
  if (a.type === "steal") {
    const gain = old.players[a.id].resources ? 1 : 0;
    assert.equal(now.resources, before.resources + gain);
    assert.equal(
      state.players[a.id].resources,
      old.players[a.id].resources - gain,
    );
    assert.deepEqual(state.bank, old.bank);
  }
  if (state.longest !== old.longest)
    awards.push({
      from: old.longest,
      to: state.longest,
      sequence: frame.sequence,
    });
  if (state.cities.attacks !== old.cities.attacks)
    barbarians.push({
      sequence: frame.sequence,
      attack: state.cities.attacks,
      scores: state.players.map((p) => p.score),
    });
});
assert.equal(state.phase, "finished");
assert.equal(state.winner, state.active);
assert.equal(state.winner, proof.finished.winner);
assert.equal(state.target, proof.finished.target);
assert(state.players[state.winner].score >= state.target);
proof.replayAudit = {
  reconstructedLegacyPublicFields: rules.legacy,
  frames: frames.length,
  rejectedRequests: rejected.length,
  cards,
  choices,
  effects,
  awards,
  ties,
  barbarians,
  finalScoreBreakdown: state.players.map((player, seat) => ({
    seat,
    settlements: state.board.vertices.filter((v) => v.owner === seat && !v.city)
      .length,
    cities:
      state.board.vertices.filter((v) => v.owner === seat && v.city).length * 2,
    longest: state.longest === seat ? 2 : 0,
    islandBonus: player.islandBonus,
    defenders: state.cities.players[seat].defenders,
    revealed: state.cities.players[seat].revealed.map((card) => card.kind),
    merchant: state.cities.merchant?.owner === seat ? 1 : 0,
    metropolises:
      Object.values(state.cities.metropolises).filter((m) => m?.owner === seat)
        .length * 2,
    total: player.score,
  })),
  finiteInventories: true,
  independentRoadsAndPoints: true,
  everyAcceptedMoveFromUi: true,
  fogRevealed: initialFog - state.board.tiles.filter((t) => t.fog).length,
  goldTiles: state.board.tiles.filter((t) => t.resource === "gold").length,
  resourceOnlyGoldChoices: effects.gold || 0,
};
writeFileSync(path, JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof.replayAudit));
