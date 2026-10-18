export const SEAFARERS_SCENARIOS = [
  "newShores",
  "fourIslands",
  "fogIslands",
  "throughDesert",
] as const;
export type SeafarersScenario = (typeof SEAFARERS_SCENARIOS)[number];
export function scenarioName(scenario: SeafarersScenario, players: number) {
  return scenario === "fourIslands"
    ? players > 4
      ? "Island Chain · Six"
      : "Island Chain · Four"
    : scenario === "fogIslands"
      ? "Hidden Coast"
      : scenario === "throughDesert"
        ? "Desert Crossing"
        : "Open Sea";
}
// Host-editable scenario targets: Hidden Coast 12, Island Chain 13, others 14.
export function scenarioTarget(scenario: SeafarersScenario, combined = false) {
  // Combining expansions adds two points to the scenario target.
  return (
    (scenario === "fogIslands" ? 12 : scenario === "fourIslands" ? 13 : 14) +
    (combined ? 2 : 0)
  );
}
export function scenarioPreview(scenario: SeafarersScenario, players: number) {
  return `map_ss${scenario === "fourIslands" ? 2 : scenario === "fogIslands" ? 3 : scenario === "throughDesert" ? 4 : 1}_${players === 3 ? 3 : players > 4 ? 6 : 4}p_preview`;
}
