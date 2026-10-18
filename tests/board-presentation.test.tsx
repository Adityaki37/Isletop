import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import IslandBoard from "../components/board";
import { makeBoard } from "../lib/board";
import { createGame, addPlayer, player, view } from "../lib/game";
import { initializeCitiesRoom } from "../lib/cities-room";

test("production tokens show correct dice odds in compact circular badges", () => {
  const board = makeBoard(4, () => 0.41);
  const odds = new Map([
    [2, 1],
    [3, 2],
    [4, 3],
    [5, 4],
    [6, 5],
    [8, 5],
    [9, 4],
    [10, 3],
    [11, 2],
    [12, 1],
  ]);
  const html = renderToStaticMarkup(<IslandBoard board={board} />);
  for (const tile of board.tiles.filter((t) => t.number > 0)) {
    const badge = html.match(
      new RegExp(`<g data-number-token="${tile.id}"[^>]*>(.*?)</g>`),
    )?.[1];
    assert(badge);
    assert.match(badge, /^<circle[^>]*r="16"/);
    assert.equal(
      (badge.match(/data-probability-dot/g) || []).length,
      odds.get(tile.number),
    );
    assert.match(badge, new RegExp(`>${tile.number}</text>`));
  }
});

test("vertical road controls have a real two-dimensional target and pieces have semantic labels", () => {
  const board = makeBoard(4, () => 0.41);
  const edge = board.edges.find(
    (e) => board.vertices[e.a].x === board.vertices[e.b].x,
  )!;
  board.edges[1].owner = 0;
  board.edges[1].kind = "road";
  board.vertices[2].owner = 1;
  board.vertices[2].city = true;
  const html = renderToStaticMarkup(
    <IslandBoard board={board} legalEdges={[edge.id]} />,
  );
  const control = html.match(
    new RegExp(`<polygon[^>]*data-road-hit-target="${edge.id}"[^>]*>`),
  )?.[0];
  assert(control);
  const coords = control
    .match(/points="([^"]+)"/)![1]
    .split(" ")
    .map((p) => p.split(",").map(Number));
  assert.equal(
    Math.max(...coords.map((p) => p[0])) - Math.min(...coords.map((p) => p[0])),
    22,
  );
  assert.match(control, /tabindex="0"/);
  assert.match(control, /role="button"/);
  assert.match(html, /aria-label="Player 1 road 1"/);
  assert.match(html, /aria-label="Player 2 city 2"/);
});

test("moving and previewing the robber leaves every number badge fixed", () => {
  for (const count of [4, 6, 8]) {
    const board = makeBoard(count, () => 0.41);
    const badges = (html: string) => html.match(/<g data-number-token="\d+"[^>]*>.*?<\/g>/g);
    const original = badges(renderToStaticMarkup(<IslandBoard board={board} />));
    for (const tile of board.tiles.filter((t) => t.number > 0)) {
      board.robber = tile.id;
      assert.deepEqual(badges(renderToStaticMarkup(<IslandBoard board={board} selected={{ type: "robber", id: tile.id }} />)), original);
    }
  }
});

test("robber ink fits between fixed badges and roads, with matching previews", () => {
  const board = makeBoard(4, () => 0.41);
  const tile = board.tiles.find((t) => t.number > 0)!;
  board.robber = tile.id;
  // Surround the tile with built roads: clearance must not depend on ownership.
  board.edges.filter((e) => e.tiles.includes(tile.id)).forEach((e) => { e.owner = 0; });
  const cityGame = createGame("FIT001", player("a", "Alice"), 4, false, "citiesKnights");
  for (let i = 1; i < 4; i++) addPlayer(cityGame, player(`p${i}`, `Player ${i}`));
  initializeCitiesRoom(cityGame);
  for (const tokenOffset of [10, -9, null]) {
    const cities = tokenOffset === -9 ? view(cityGame, "a").cities : undefined;
    if (cities) cities.metropolises.trade = { owner: 0, vertex: tile.vertices.find((id) => board.vertices[id].y > tile.y + 40)! };
    const originalNumber = tile.number;
    if (tokenOffset === null) tile.number = 0;
    const html = renderToStaticMarkup(<IslandBoard board={board} cities={cities} selected={{ type: "robber", id: tile.id }} />);
    tile.number = originalNumber;
    const markers = [...html.matchAll(/data-robber-marker="(placed|preview)"[^>]*><svg ([^>]+)>/g)];
    assert.equal(markers.length, 2);
    assert.equal(markers[0][2], markers[1][2]);
    const attrs = markers[0][2];
    const value = (name: string) => Number(attrs.match(new RegExp(`(?:^| )${name}="([^"]+)"`))![1]);
    const scale = value("width") / 54.8;
    const x = value("x") - tile.x, y = value("y") - tile.y;
    assert.equal(value("height"), 27);
    assert(Math.abs(value("width") / value("height") - 54.8 / 68.8) < 1e-10);
    // Sample the actual quadratic artwork outline, independently of layout samples.
    const silhouette = Array.from({ length: 101 }, (_, i) => {
      const t = i / 100;
      return { x: 24 + 26 * t * t, y: 14 + 35 * (1 - t) ** 2 };
    }).flatMap((p) => [p, { x: 100 - p.x, y: p.y }])
      .concat([{ x: 24, y: 80 }, { x: 76, y: 80 }]);
    for (const p of silhouette) {
      const px = x + (p.x - 22.6) * scale, py = y + (p.y - 12.6) * scale;
      for (let i = 0; i < 6; i++) {
        const clearance = 48 * Math.sqrt(3) / 2 - Math.cos(i * Math.PI / 3) * px - Math.sin(i * Math.PI / 3) * py - 1.25 * scale;
        assert(clearance >= 6.8, `road clearance ${clearance}`);
      }
      if (tokenOffset !== null) assert(Math.hypot(px, py - tokenOffset) - 1.25 * scale >= (tokenOffset < 0 ? 16.5 : 19.8));
    }
  }
});

test("every blocked resource symbol stays visible beside the robber and fixed badge", () => {
  const board = makeBoard(4, () => 0.41);
  const tile = board.tiles.find((t) => t.number > 0)!;
  for (const resource of ["wood", "brick", "sheep", "wheat", "ore", "gold"] as const) {
    tile.resource = resource;
    board.robber = tile.id;
    const html = renderToStaticMarkup(<IslandBoard board={board} />);
    const icon = html.match(new RegExp(`<svg data-resource-icon="${tile.id}" ([^>]+)>`))![1];
    const value = (name: string) => Number(icon.match(new RegExp(`(?:^| )${name}="([^"]+)"`))![1]);
    const right = value("x") - tile.x + value("width");
    assert(right < -16, "symbol clears the number badge horizontally");
    assert(right < -27 * 54.8 / 68.8 / 2, "symbol clears robber artwork horizontally");
    assert.match(html, /mask="url\(#[^"]+-resource-\d+\)"/);
  }
});
