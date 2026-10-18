// Independent predicates keep expansion combinations consistent across the
// authoritative rules, public projections, replay and human controls.
export function usesSeafarers(mode: string) {
  return mode === "seafarers" || mode === "seafarersCitiesKnights";
}
export function usesCitiesKnights(mode: string) {
  return mode === "citiesKnights" || mode === "seafarersCitiesKnights";
}
export function modeDescription(mode: string) {
  if (mode === "seafarersCitiesKnights")
    return "Ships and island exploration, plus knights, city improvements and progress cards.";
  if (mode === "seafarers")
    return "Build ships, explore islands and earn discovery points.";
  if (mode === "citiesKnights")
    return "Defend cities with knights; spend commodities on improvements and use progress cards.";
  if (mode === "solo")
    return "Practice building and bank trading on your own, with no bots.";
  if (mode === "rush")
    return "Everyone builds at once while dice roll automatically.";
  if (mode === "duel")
    return "A two-player game with adjustable victory and turn settings.";
  return "Start here: roll, trade and build roads, settlements and cities. Up to twelve players.";
}
