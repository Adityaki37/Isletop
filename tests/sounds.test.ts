import { applyActionInSeatOrder as applyAction } from "./fixed-turn-start";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  player,
  addPlayer,
  view,
  type Game,
  type View,
} from "../lib/game";
import { gameSounds, needsMyAction } from "../lib/game-sounds";
import { SoundPlayer } from "../lib/sound-player";

function table(mode: "base" | "citiesKnights" = "base") {
  const g = createGame("SOUND1", player("a", "Alice"), 3, false, mode);
  addPlayer(g, player("b", "Bob"));
  addPlayer(g, player("c", "Carol"));
  return g;
}
function changed(g: Game, action: Parameters<typeof applyAction>[2], p = 0) {
  applyAction(g, p, action, () => 0.42);
  g.revision++;
  return structuredClone(view(g, "a"));
}
function start(g: Game) {
  applyAction(g, 1, { type: "ready" });
  applyAction(g, 2, { type: "ready" });
  return changed(g, { type: "start" });
}
test("sound projection is silent on initial load, duplicate/stale updates, room switches and rematches", () => {
  const g = table(),
    first = view(g, "a");
  assert.deepEqual(gameSounds(null, first), []);
  const next = changed(g, { type: "ready" });
  assert.deepEqual(gameSounds(next, next), []);
  assert.deepEqual(gameSounds(next, first), []);
  assert.deepEqual(gameSounds(first, { ...next, code: "OTHER1" }), []);
  assert.deepEqual(gameSounds({ ...first, phase: "finished" }, next), []);
  assert.deepEqual(gameSounds(first, { ...next, me: 1 }), []);
});
test("opening settlement and road sounds come from accepted board changes for player and spectator", () => {
  const g = table(),
    first = view(g, "a"),
    opening = start(g);
  assert(gameSounds(first, opening).includes("game_started"));
  assert(gameSounds(first, opening).includes("your_turn"));
  assert.deepEqual(gameSounds(first, opening), ["game_started", "your_turn"]);
  const settled = changed(g, {
    type: "settlement",
    id: opening.legal.settlement[0],
  });
  assert(gameSounds(opening, settled).includes("settlement_place"));
  const road = changed(g, { type: "road", id: settled.legal.road[0] });
  assert(gameSounds(settled, road).includes("road_place"));
  assert.deepEqual(gameSounds({ ...settled, me: -1 }, { ...road, me: -1 }), [
    "road_place",
  ]);
});
test("a repeated dice pair still sounds, while chat and no-op preferences do not replay it", () => {
  const g = table();
  start(g);
  const first = view(g, "a");
  const a = {
    ...first,
    phase: "action" as const,
    dice: [3, 3],
    rollCounts: { 6: 1 },
    revision: 10,
  };
  const b = { ...a, revision: 11, rollCounts: { 6: 2 } };
  assert(gameSounds(a, b).some((s) => s.startsWith("dice_roll_")));
  assert.deepEqual(gameSounds(b, { ...b, revision: 12 }), []);
  assert.deepEqual(
    gameSounds(b, {
      ...b,
      revision: 13,
      chat: [{ name: "Bob", text: "played monopoly" }],
    }),
    ["message_notification"],
  );
  assert.deepEqual(
    gameSounds(b, { ...b, revision: 14, chat: [{ name: "Alice", text: "m" }] }),
    [],
  );
});
test("private obligations and trade alerts are audible only to the eligible viewer", () => {
  const g = table();
  start(g);
  const a = view(g, "a");
  const next = {
    ...a,
    revision: a.revision + 1,
    phase: "discard" as const,
    discards: { 0: 4, 1: 4 },
  };
  assert(gameSounds(a, next).includes("discard_notification"));
  assert(
    !gameSounds({ ...a, me: 2 }, { ...next, me: 2 }).includes(
      "discard_notification",
    ),
  );
  assert(
    !gameSounds({ ...a, me: -1 }, { ...next, me: -1 }).includes(
      "discard_notification",
    ),
  );
  assert(needsMyAction(next));
  assert(!needsMyAction({ ...next, me: 2 }));
  const offer = {
    id: 1,
    from: 1,
    to: 0,
    targets: [0],
    replyTo: null,
    give: { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 },
    want: { wood: 0, brick: 1, sheep: 0, wheat: 0, ore: 0 },
    rejected: [],
    accepted: [],
    preparing: [],
    blocked: [],
    expired: [],
    responseDeadline: null,
    responseDuration: null,
    closeAt: null,
    pausedAt: null,
  };
  const action = { ...a, phase: "action" as const };
  const offered = { ...action, revision: action.revision + 1, offers: [offer] };
  assert(gameSounds(action, offered).includes("offer_not_acceptable"));
  assert(
    !gameSounds({ ...action, me: 2 }, { ...offered, me: 2 }).some((s) =>
      s.startsWith("offer_"),
    ),
  );
});
test("expansion sound cues preserve commodity/progress privacy and respond to actual public changes", () => {
  const g = table("citiesKnights");
  start(g);
  const a = view(g, "a");
  const b = structuredClone(a);
  b.revision++;
  b.cities!.knights.push({
    owner: 1,
    vertex: 4,
    level: 1,
    active: false,
    activatedAt: -1,
    upgradedAt: -1,
  });
  assert(gameSounds(a, b).includes("knight_place"));
  const c = structuredClone(b);
  c.revision++;
  c.cities!.knights[0].level = 2;
  assert(gameSounds(b, c).includes("knight_upgrade"));
  const d = structuredClone(c);
  d.revision++;
  d.cities!.knights[0].active = true;
  d.cities!.players[1].improvements.trade = 1;
  assert(gameSounds(c, d).includes("knight_equip"));
  assert(gameSounds(c, d).includes("city_improvement"));
  assert(!("progress" in d.cities!.players[1]));
  const e = structuredClone(d);
  e.revision++;
  e.cities!.choice = { kind: "defenderProgress", player: 1 };
  e.phase = "citiesChoice";
  assert(!needsMyAction(e));
  assert(needsMyAction({ ...e, me: 1 }));
});
test("public card-use logs survive bounded-log rollover; a win gets one terminal cue", () => {
  const g = table();
  start(g);
  const a = view(g, "a");
  a.log = Array.from({ length: 160 }, (_, i) => `public ${i}`);
  const b = {
    ...a,
    revision: a.revision + 1,
    log: [...a.log.slice(1), "Bob played monopoly."],
  };
  assert(gameSounds(a, b).includes("devcard_monopoly"));
  const c = {
    ...b,
    revision: b.revision + 1,
    phase: "finished" as const,
    winner: 1,
  };
  assert.deepEqual(gameSounds(b, c), ["victory"]);
});

test("audio waits for user activation, cancels pending muted audio, caches decoding and stops on disposal", async () => {
  const originalContext = globalThis.AudioContext,
    originalFetch = globalThis.fetch;
  let started = 0,
    stopped = 0,
    fetched = 0,
    decoded = 0;
  let release: (value: ArrayBuffer) => void = () => {};
  const pending = new Promise<ArrayBuffer>((resolve) => (release = resolve));
  class Context {
    state = "running";
    destination = {};
    createGain() {
      return { gain: { value: 1 }, connect() {} };
    }
    async decodeAudioData() {
      decoded++;
      return { duration: 0.2 };
    }
    createBufferSource() {
      return {
        buffer: null,
        connect() {},
        disconnect() {},
        onended: null,
        start() {
          started++;
        },
        stop() {
          stopped++;
        },
      };
    }
    async resume() {
      this.state = "running";
    }
    async close() {
      this.state = "closed";
    }
  }
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  globalThis.fetch = (async () => {
    fetched++;
    return { ok: true, arrayBuffer: () => pending };
  }) as unknown as typeof fetch;
  const audio = new SoundPlayer();
  try {
    await audio.play("your_turn");
    assert.equal(fetched, 0);
    await audio.unlock();
    const sound = audio.play("your_turn");
    audio.configure(0.7, true);
    release(new ArrayBuffer(20));
    await sound;
    assert.equal(started, 0);
    audio.configure(0.7, false);
    await audio.play("your_turn");
    await audio.play("your_turn");
    assert.equal(started, 2);
    assert.equal(fetched, 1);
    assert.equal(decoded, 1);
    audio.configure(0, true);
    assert.equal(stopped, 2);
    audio.dispose();
    await audio.play("your_turn");
    assert.equal(started, 2);
  } finally {
    audio.dispose();
    globalThis.AudioContext = originalContext;
    globalThis.fetch = originalFetch;
  }
});
