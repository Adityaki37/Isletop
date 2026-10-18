import { MAX_PLAYERS } from "./player-colors";
import { Board, makeBoard, secureRandom } from "./board";
import { makeLakesBoard } from "./lakes";
import { FIXED_FUN_MAPS, isFixedFunMap, makeFunBoard } from "./fun-maps";
import { GOLD_RUSH_PREVIEW, makeGoldRushBoard } from "./gold-rush";
import { BLACK_FOREST_PREVIEW, makeBlackForestBoard } from "./black-forest";
import { randomizeScenarioBoard } from "./board-randomization";

export const BASE_MAPS = [
  "base",
  "baseRandom",
  "blackForest",
  "diamond",
  "gear",
  "goldRush",
  "lakes",
  "pond",
  "twirl",
] as const;
export type BaseMap = (typeof BASE_MAPS)[number];
export function defaultBaseMap(mode: string): BaseMap {
  return mode === "seafarers" || mode === "seafarersCitiesKnights" ? "base" : "baseRandom";
}
export function baseMapName(map: BaseMap = "base") {
  if (isFixedFunMap(map)) return FIXED_FUN_MAPS[map].name;
  if (map === "goldRush") return "Treasure Coast";
  if (map === "blackForest") return "Woodland Discovery";
  return map === "lakes"
    ? "Lakes"
    : map === "baseRandom"
      ? "Base Random · Fresh shuffle"
      : "Base";
}
export function baseMapAvailable(map: unknown, mode: string, capacity: number) {
  return (
    map === "base" ||
    (["goldRush", "blackForest"].includes(map as string) &&
      ["base", "citiesKnights"].includes(mode) &&
      capacity >= (mode === "base" ? 2 : 3) &&
      capacity <= 6) ||
    (isFixedFunMap(map) &&
      ["base", "citiesKnights"].includes(mode) &&
      capacity >= (mode === "base" ? 2 : 3) &&
      capacity <=
        Math.min(
          FIXED_FUN_MAPS[map].maxPlayers,
          mode === "citiesKnights" ? 6 : 8,
        )) ||
    (map === "lakes" &&
      ["base", "citiesKnights"].includes(mode) &&
      capacity >= (mode === "base" ? 2 : 3) &&
      capacity <= (mode === "base" ? 8 : 6)) ||
    (map === "baseRandom" &&
      ["base", "citiesKnights", "duel", "rush", "solo"].includes(mode) &&
      capacity >= (mode === "solo" ? 1 : mode === "duel" || mode === "base" ? 2 : 3) &&
      capacity <= (mode === "solo" ? 1 : mode === "duel" ? 2 : mode === "citiesKnights" ? 6 : MAX_PLAYERS))
  );
}
export function baseMapPreview(map: BaseMap) {
  if (isFixedFunMap(map)) return FIXED_FUN_MAPS[map].preview;
  if (map === "goldRush") return GOLD_RUSH_PREVIEW;
  if (map === "blackForest") return BLACK_FOREST_PREVIEW;
  if (map === "lakes") return "/art/map_lakes_preview.svg";
  return map === "baseRandom"
    ? "/art/map_random_base_preview.svg"
    : "/art/map_base_4p_preview.svg";
}
export function baseMapDescription(map: BaseMap) {
  if (map === "blackForest")
    return "Start in the forest, trade wood at six 2:1 ports, and build roads outward to explore 30 fog tiles. Revealing a resource pays one card. Initial settlements must touch the original forest.";
  if (map === "goldRush")
    return "Explore seven fog tiles inside a 31-tile island with six ports. Revealing a resource pays one card; gold lets you choose resources. Build toward the center to find the hidden gold tile.";
  if (isFixedFunMap(map)) {
    const { land, ports, lakes } = FIXED_FUN_MAPS[map];
    return `A fixed ${land}-land-tile island with ${lakes === 1 ? "one lake" : `${lakes} lakes`} and ${ports} ports. Roads follow land and lake shores; water does not produce resources.`;
  }
  return map === "lakes"
    ? "A fixed 39-land-tile island with four lakes and twelve ports. Roads follow land and lake shores; water does not produce resources."
    : map === "baseRandom"
      ? "A newly generated board every game. Terrain and numbers are shuffled; 6s and 8s stay apart. Harbors move together on shuffled sea-frame pieces."
      : "Number tokens follow the standard sequence around the island, skipping the desert. Terrain is randomized and harbor groups move with shuffled sea-frame pieces.";
}

// A–R number tokens from the standard variable setup, skipping the desert.
// Random terrain and ports are shared with Base Random; its numbers are shuffled.
const CLASSIC_NUMBERS = [
  5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11,
];
export function makeBaseBoard(
  players: number,
  map: BaseMap = "base",
  rng = secureRandom,
): Board {
  if (isFixedFunMap(map)) return randomizeScenarioBoard(makeFunBoard(map), rng);
  if (map === "goldRush")
    return randomizeScenarioBoard(makeGoldRushBoard(), rng);
  if (map === "blackForest") return makeBlackForestBoard(rng);
  if (map === "lakes") return randomizeScenarioBoard(makeLakesBoard(), rng);
  const board = makeBoard(players, rng);
  // Large islands retain their existing separated-red number generation.
  if (map === "baseRandom" || players > 4) return board;
  const rotation = Math.floor(rng() * 6);
  const coords: [number, number][] = [];
  const directions = [
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
    [1, 0],
    [1, -1],
  ];
  for (const radius of [2, 1]) {
    let q = radius,
      r = 0;
    for (const [dq, dr] of directions)
      for (let step = 0; step < radius; step++) {
        coords.push([q, r]);
        q += dq;
        r += dr;
      }
  }
  coords.push([0, 0]);
  let token = 0;
  for (let [q, r] of coords) {
    for (let turn = 0; turn < rotation; turn++) [q, r] = [-r, q + r];
    const tile = board.tiles.find((t) => t.q === q && t.r === r)!;
    tile.number = tile.resource === "desert" ? 0 : CLASSIC_NUMBERS[token++];
  }
  return board;
}
