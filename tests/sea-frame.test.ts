import test from "node:test";
import assert from "node:assert/strict";
import { type Board, type Port, RESOURCES } from "../lib/board";
import { makeBaseBoard } from "../lib/base-maps";
import { seededRandom } from "./seeded-game";
import { createGame, player, addPlayer, applyAction, actor, view, normalizeGame, bankRate } from "../lib/game";
import { chooseMove } from "./autoplay";

// Independent fixture for the six sea-frame pieces.
// Do not derive it from the production frame definitions.
type Slot = Port["resource"] | null;
const printedPieces: Slot[][] = [
  [null, null, "any", null, null],
  [null, null, "wood", null, null],
  [null, "sheep", null, null, "any"],
  [null, "brick", null, null, "any"],
  [null, null, "ore", null, null],
  [null, "wheat", null, null, "any"],
];
const pieceInventory = printedPieces.map(p => JSON.stringify(p)).sort();
function coastalSlots(b: Board): Slot[] {
  const cx = (Math.min(...b.vertices.map(v => v.x)) + Math.max(...b.vertices.map(v => v.x))) / 2;
  const cy = (Math.min(...b.vertices.map(v => v.y)) + Math.max(...b.vertices.map(v => v.y))) / 2;
  const angle = (id: number) => {
    const e = b.edges[id], a = b.vertices[e.a], c = b.vertices[e.b];
    return Math.atan2((a.y + c.y) / 2 - cy, (a.x + c.x) / 2 - cx);
  };
  return b.edges.filter(e => e.tiles.length === 1).sort((a, c) => angle(a.id) - angle(c.id))
    .map(e => b.ports.find(p => p.edge === e.id)?.resource ?? null);
}
function matchesPhysicalFrames(slots: Slot[], insertsPerSide: number[], inserts: Slot[]) {
  // The frame has no absolute top: compare every cyclic rotation against
  // the real printed pieces and the separate extension-piece inventory.
  for (let rotation = 0; rotation < slots.length; rotation++) {
    const cycle = [...slots.slice(rotation), ...slots.slice(0, rotation)];
    const pieces: string[] = [], small: Slot[] = [];
    let offset = 0, valid = true;
    for (const n of insertsPerSide) {
      pieces.push(JSON.stringify(cycle.slice(offset, offset + 5)));
      offset += 5;
      for (let i = 0; i < n; i++) {
        if (cycle[offset] !== null) valid = false;
        small.push(cycle[offset + 1]);
        offset += 2;
      }
    }
    if (valid && JSON.stringify(pieces.sort()) === JSON.stringify(pieceInventory)
      && JSON.stringify(small.sort()) === JSON.stringify([...inserts].sort())) return true;
  }
  return false;
}

test("Base harbors shuffle as intact 2025 sea frames and retain the correct extension inventory", () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const insertCounts = n <= 4 ? [0, 0, 0, 0, 0, 0] : n <= 6 ? [0, 1, 1, 0, 1, 1]
      : n <= 8 ? [1, 1, 1, 1, 1, 1] : [2, 2, 2, 2, 2, 2];
    const insertTypes: Slot[] = n <= 4 ? [] : n <= 6 ? [null, null, "any", "sheep"]
      : n <= 8 ? [null, null, null, "any", "any", "sheep"]
        : [null, null, null, null, null, ...RESOURCES, "any", "any"];
    for (const map of ["base", "baseRandom"] as const) {
      const dockLayouts = new Set<string>(), harborLayouts = new Set<string>();
      for (let seed = 1; seed <= 100; seed++) {
        const b = makeBaseBoard(n, map, seededRandom(seed));
        assert(matchesPhysicalFrames(coastalSlots(b), insertCounts, insertTypes), `${map}/${n}/${seed}: split or changed a printed frame`);
        assert.equal(new Set(b.ports.map(p => p.edge)).size, b.ports.length);
        assert(b.ports.every(p => b.edges[p.edge].tiles.length === 1));
        assert.equal(new Set(b.ports.flatMap(p => [b.edges[p.edge].a, b.edges[p.edge].b])).size, b.ports.length * 2);
        dockLayouts.add(JSON.stringify(b.ports.map(p => p.edge).sort((a, c) => a - c)));
        harborLayouts.add(JSON.stringify(b.ports));
      }
      assert(dockLayouts.size >= 15, `${map}/${n}: dock positions must also change`);
      assert(harborLayouts.size > 50, `${map}/${n}: frame order must change`);
    }
  }
});

test("saved frames and harbor access stay stable through setup, rolls, turns and normalization", () => {
  const g = createGame("FRAME2", player("host", "Host"), 4, false, "base", undefined, "baseRandom");
  for (let i = 1; i < 4; i++) addPlayer(g, player(`p${i}`, `Player ${i}`));
  g.players.forEach(p => p.ready = true);
  applyAction(g, 0, { type: "start" }, seededRandom(17));
  const ports = structuredClone(g.board.ports);
  while (g.phase.startsWith("setup")) applyAction(g, actor(g), chooseMove(g)!);
  for (let turn = 0; turn < 12; turn++) {
    applyAction(g, g.active, { type: "roll" }, () => 0.2);
    applyAction(g, g.active, { type: "end" });
    assert.deepEqual(g.board.ports, ports);
    assert.deepEqual(view(g, "host").board.ports, ports);
    assert.deepEqual(normalizeGame(structuredClone(g)).board.ports, ports);
  }
  for (const port of ports) {
    g.board.vertices.forEach(v => v.owner = null);
    g.board.vertices[g.board.edges[port.edge].a].owner = 0;
    for (const resource of RESOURCES) {
      const accessible = ports.filter(p => {
        const e = g.board.edges[p.edge];
        return g.board.vertices[e.a].owner === 0 || g.board.vertices[e.b].owner === 0;
      });
      const expected = accessible.some(p => p.resource === resource) ? 2 : accessible.some(p => p.resource === "any") ? 3 : 4;
      assert.equal(bankRate(g, 0, resource), expected);
    }
  }
});
