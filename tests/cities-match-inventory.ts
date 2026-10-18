import assert from "node:assert/strict";
import { Game, view } from "../lib/game";
import { GOODS, TRACKS, citiesBank } from "../lib/cities-knights";
export function assertCitiesInventory(g: Game) {
  const supply = citiesBank(g.players.length),
    c = g.cities!;
  for (const r of GOODS) {
    const amounts = [g.bank[r] ?? 0, ...g.players.map((p) => p.hand[r] ?? 0)];
    assert(
      amounts.every((n) => Number.isInteger(n) && n >= 0),
      `Invalid ${r} count`,
    );
    assert.equal(
      amounts.reduce((n, a) => n + a, 0),
      supply[r],
      `${r} supply changed`,
    );
  }
  const cards = [
    ...TRACKS.flatMap((t) => c.decks[t]),
    ...c.players.flatMap((p) => [...p.progress, ...p.revealed]),
  ];
  assert.equal(cards.length, 54);
  assert.equal(new Set(cards.map((c) => c.id)).size, 54);
  assert.equal(new Set(c.knights.map((k) => k.vertex)).size, c.knights.length);
  for (const k of c.knights)
    assert.equal(
      g.board.vertices[k.vertex].owner,
      null,
      "Knight overlaps a building",
    );
  for (let p = 0; p < g.players.length; p++) {
    assert(
      g.board.edges.filter((e) => e.owner === p && e.kind !== "ship").length <=
        15,
    );
    assert(
      g.board.edges.filter((e) => e.owner === p && e.kind === "ship").length <=
        15,
    );
    assert(g.board.vertices.filter((v) => v.owner === p && v.city).length <= 4);
    assert(
      g.board.vertices.filter((v) => v.owner === p && !v.city).length <=
        5 + c.players[p].demotedCities.length,
    );
    for (const level of [1, 2, 3])
      assert(
        c.knights.filter((k) => k.owner === p && k.level === level).length <= 2,
      );
    assert(
      c.walls.filter((id) => g.board.vertices[id].owner === p).length <= 3,
    );
    assert(c.players[p].progress.length <= 5);
    assert(
      TRACKS.every(
        (track) =>
          Number.isInteger(c.players[p].improvements[track]) &&
          c.players[p].improvements[track] >= 0 &&
          c.players[p].improvements[track] <= 5,
      ),
    );
  }
  for (const track of TRACKS) {
    const m = c.metropolises[track];
    if (m) {
      assert.equal(g.board.vertices[m.vertex].owner, m.owner);
      assert(g.board.vertices[m.vertex].city);
      assert(c.players[m.owner].improvements[track] >= 4);
    }
  }
  assert.equal(g.army, null);
  const spectator = view(g, null);
  assert(spectator.players.every((p) => !p.hand));
  assert(spectator.cities!.players.every((p) => !p.progress));
  assert.equal(spectator.cities!.peek, null);
  assert(!("decks" in spectator.cities!));
  assert(!("citiesFlow" in spectator));
}
