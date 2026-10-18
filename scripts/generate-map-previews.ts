// Draw the implemented board layouts using only original SVG shapes.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { makeBaseBoard, type BaseMap } from "../lib/base-maps";
import { makeSeafarersBoard } from "../lib/seafarers";
import type { Board } from "../lib/board";
import type { SeafarersScenario } from "../lib/scenarios";

const colors: Record<string, string> = {
  wood: "#4c956c",
  brick: "#d47b55",
  sheep: "#92b76e",
  wheat: "#e4ba55",
  ore: "#91a7ad",
  desert: "#dfbb84",
  gold: "#f5c956",
  sea: "#9bc4b5",
  fog: "#879da7",
};
function rng() {
  let seed = 57321;
  return () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function draw(board: Board, name: string) {
  const tiles = board.tiles
    .map((t) => {
      const kind = t.fog ? "fog" : t.resource;
      const points = t.vertices
        .map((id) => `${board.vertices[id].x},${board.vertices[id].y}`)
        .join(" ");
      const number =
        !t.fog && t.number
          ? `<circle cx="${t.x}" cy="${t.y}" r="12" fill="#fff2d3"/><text x="${t.x}" y="${t.y + 4}" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="${[6, 8].includes(t.number) ? "#ad3a32" : "#193c47"}">${t.number}</text>`
          : "";
      const waves =
        kind === "sea" || kind === "fog"
          ? `<path d="M${t.x - 12} ${t.y - 3}q6-6 12 0t12 0m-24 8q6-6 12 0t12 0" fill="none" stroke="#d8e6e4" stroke-width="3"/>`
          : "";
      return `<g data-terrain="${kind}"><polygon points="${points}" fill="${colors[kind]}" stroke="#fff2d3" stroke-width="2"/>${number}${waves}</g>`;
    })
    .join("");
  const ports = board.ports
    .map((p) => {
      const e = board.edges[p.edge],
        a = board.vertices[e.a],
        b = board.vertices[e.b];
      return `<circle cx="${(a.x + b.x) / 2}" cy="${(a.y + b.y) / 2}" r="7" fill="${p.resource === "any" ? "#fff2d3" : colors[p.resource]}" stroke="#193c47" stroke-width="2"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 ${board.width} ${board.height}"><title>Island Table ${name} layout example</title><rect width="${board.width}" height="${board.height}" rx="18" fill="#b8d5c8"/>${tiles}${ports}</svg>`;
}
export function generateMapPreviews(root: string) {
  let count = 0;
  const save = (name: string, board: Board) => {
    writeFileSync(
      path.join(root, "public/art", `${name}.svg`),
      draw(board, name),
    );
    count++;
  };
  for (const [name, map] of Object.entries({
    base_4p: "base",
    random_base: "baseRandom",
    lakes: "lakes",
    goldrush: "goldRush",
    blackforest: "blackForest",
    diamond: "diamond",
    gear: "gear",
    pond: "pond",
    twirl: "twirl",
  }))
    save(`map_${name}_preview`, makeBaseBoard(4, map as BaseMap, rng()));
  const scenarios: SeafarersScenario[] = [
    "newShores",
    "fourIslands",
    "fogIslands",
    "throughDesert",
  ];
  for (const [index, scenario] of scenarios.entries())
    for (const players of [3, 4, 6])
      save(
        `map_ss${index + 1}_${players}p_preview`,
        makeSeafarersBoard(players, scenario, rng()),
      );
  return count;
}
