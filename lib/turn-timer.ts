export const MIN_TURN_SECONDS = 15;
export const MAX_TURN_SECONDS = 300;
export const TURN_TIMER_PRESETS = [
  { label: "Fast", seconds: 30 },
  { label: "Normal", seconds: 60 },
  { label: "Slow", seconds: 120 },
  { label: "No timer", seconds: 0 },
] as const;

export function validTurnSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    (value === 0 || value >= MIN_TURN_SECONDS && value <= MAX_TURN_SECONDS);
}

export function turnTimerPreset(seconds: number) {
  return seconds === 0 ? 3 : seconds < 45 ? 0 : seconds < 90 ? 1 : 2;
}
