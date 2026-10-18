import { MAX_PLAYERS } from "./player-colors";
import type { GameMode } from "./game";
import { validTurnSeconds } from "./turn-timer";
import type { DiceMode } from "./dice";
import { baseMapAvailable, defaultBaseMap, type BaseMap } from "./base-maps";
import { usesCitiesKnights, usesSeafarers } from "./game-modes";
import { SEAFARERS_SCENARIOS, scenarioTarget, type SeafarersScenario } from "./scenarios";

export const ROOM_MODES = [
  { id: "base", name: "Base", seats: "2–12 players" },
  { id: "duel", name: "1v1", seats: "2 players" },
  { id: "citiesKnights", name: "Cities & Defenders", seats: "3–6 players" },
  { id: "seafarers", name: "Voyages", seats: "3–6 players" },
  { id: "seafarersCitiesKnights", name: "Voyages + Cities & Defenders", seats: "3–6 players" },
  { id: "rush", name: "Rapid Play", seats: "3–12 players" },
  { id: "solo", name: "Solo Practice", seats: "1 player" },
] as const satisfies readonly { id: GameMode; name: string; seats: string }[];
export const ROOM_STEPS = ["game", "map", "rules", "room"] as const;
export type RoomStep = (typeof ROOM_STEPS)[number];
export const ROOM_TURN_SPEEDS = [0, 15, 30, 60, 120, 200] as const;
export const ROOM_ROLL_SPEEDS = [5, 8, 10, 15, 30] as const;
export type RoomRules = {
  target: number;
  diceMode: DiceMode;
  turnSeconds: number;
  discardLimit: number;
  friendlyRobber: boolean;
  hideBank: boolean;
};
export type RoomSetup = RoomRules & {
  mode: GameMode;
  capacity: number;
  map: BaseMap;
  scenario: SeafarersScenario;
  title: string;
  public: boolean;
  botCount: number;
  color?: number;
};
export function roomCapacities(mode: GameMode): number[] {
  if (mode === "solo") return [1];
  if (mode === "duel") return [2];
  const min = mode === "base" ? 2 : 3;
  const max = usesSeafarers(mode) || usesCitiesKnights(mode) ? 6 : MAX_PLAYERS;
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}
export function roomRuleDefaults(mode: GameMode, scenario: SeafarersScenario = "newShores"): RoomRules {
  return {
    target: mode === "duel" ? 15 : usesSeafarers(mode) ? scenarioTarget(scenario, usesCitiesKnights(mode)) : usesCitiesKnights(mode) ? 13 : 10,
    diceMode: mode === "duel" ? "balanced" : "random",
    turnSeconds: mode === "solo" ? 0 : mode === "rush" ? 5 : mode === "duel" ? 30 : 60,
    discardLimit: mode === "duel" || mode === "rush" ? 9 : 7,
    friendlyRobber: false,
    hideBank: false,
  };
}
export function defaultRoomSetup(): RoomSetup {
  return { mode: "base", capacity: 4, map: "baseRandom", scenario: "newShores", title: "", public: false, botCount: 0, ...roomRuleDefaults("base") };
}
export function changeRoomMode(draft: RoomSetup, mode: GameMode): RoomSetup {
  return { ...draft, mode, capacity: mode === "solo" ? 1 : mode === "duel" ? 2 : 4, map: defaultBaseMap(mode), scenario: "newShores", botCount: 0, ...roomRuleDefaults(mode) };
}
export function changeRoomCapacity(draft: RoomSetup, capacity: number): RoomSetup {
  return { ...draft, capacity, map: baseMapAvailable(draft.map, draft.mode, capacity) ? draft.map : defaultBaseMap(draft.mode), botCount: Math.min(draft.botCount, capacity - 1) };
}
export function changeRoomScenario(draft: RoomSetup, scenario: SeafarersScenario): RoomSetup {
  return { ...draft, scenario, target: scenarioTarget(scenario, usesCitiesKnights(draft.mode)) };
}
export function roomTimerLabel(seconds: number) {
  return seconds === 0 ? "Unlimited" : seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} ${seconds === 60 ? "minute" : "minutes"}` : `${seconds} seconds`;
}
export function roomStep(raw: string | null): RoomStep {
  return ROOM_STEPS.includes(raw as RoomStep) ? raw as RoomStep : "game";
}
// Session drafts are untrusted browser data. Restore only recognized fields,
// then recheck dependent choices when a mode/capacity changes.
export function restoreRoomSetup(text: string): RoomSetup {
  const fallback = defaultRoomSetup();
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
    const mode = raw.mode === "solo" || raw.mode === "duel" ? "base" : ROOM_MODES.find(option => option.id === raw.mode)?.id ?? fallback.mode;
    const scenario = usesSeafarers(mode) && SEAFARERS_SCENARIOS.includes(raw.scenario) ? raw.scenario as SeafarersScenario : "newShores";
    const draft = { ...changeRoomMode(fallback, mode), scenario, ...roomRuleDefaults(mode, scenario) };
    if (roomCapacities(mode).includes(raw.capacity)) draft.capacity = raw.capacity;
    if (baseMapAvailable(raw.map, mode, draft.capacity)) draft.map = raw.map;
    if (typeof raw.title === "string" && raw.title.length <= 40) draft.title = raw.title;
    if (typeof raw.public === "boolean") draft.public = raw.public;
    if (Number.isInteger(raw.botCount) && raw.botCount >= 0 && raw.botCount < draft.capacity) draft.botCount = raw.botCount;
    if (Number.isInteger(raw.color) && raw.color >= 0 && raw.color < MAX_PLAYERS) draft.color = raw.color;
    if (Number.isInteger(raw.target) && raw.target >= 3 && raw.target <= 20) draft.target = raw.target;
    if (raw.diceMode === "random" || raw.diceMode === "balanced") draft.diceMode = raw.diceMode;
    const turnSeconds = raw.turnSeconds === 12000 ? 200 : raw.turnSeconds;
    if (mode === "rush" ? ROOM_ROLL_SPEEDS.includes(turnSeconds) : validTurnSeconds(turnSeconds)) draft.turnSeconds = turnSeconds;
    if (Number.isInteger(raw.discardLimit) && raw.discardLimit >= 5 && raw.discardLimit <= 20) draft.discardLimit = raw.discardLimit;
    for (const key of ["friendlyRobber", "hideBank"] as const) if (typeof raw[key] === "boolean") draft[key] = raw[key];
    return draft;
  } catch { return fallback; }
}
