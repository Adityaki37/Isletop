import { ASSETS, TILE_NAMES } from "./assets";
import { CITIES_ASSETS } from "./cities-assets";
import type { GameMode } from "./game";
import { usesCitiesKnights, usesSeafarers } from "./game-modes";
import type {
  Good,
  ProgressCard,
  ProgressKind,
  PublicCitiesChoice,
} from "./cities-knights";
export const GOOD_LABELS: Record<Good, string> = {
  wood: "Lumber",
  brick: "Brick",
  sheep: "Wool",
  wheat: "Grain",
  ore: "Ore",
  paper: "Paper",
  cloth: "Cloth",
  coin: "Coin",
};
export function goodImage(good: Good) {
  return good === "paper" || good === "cloth" || good === "coin"
    ? CITIES_ASSETS[`card_${good}`]
    : ASSETS[`card_${TILE_NAMES[good]}`];
}
export function goodUses(good: Good, mode: GameMode) {
  const cities = usesCitiesKnights(mode), ships = usesSeafarers(mode);
  switch (good) {
    case "wood": return `Build roads and settlements${ships ? ", or ships" : ""}.`;
    case "brick": return `Build roads and settlements${cities ? ", or city walls" : ""}.`;
    case "sheep": return cities
      ? `Build settlements and knights${ships ? ", or ships" : ""}.`
      : `Build settlements${ships ? " and ships" : ""}, or purchase deployment cards.`;
    case "wheat": return cities
      ? "Build settlements and cities, or activate knights."
      : "Build settlements and cities, or purchase deployment cards.";
    case "ore": return cities
      ? "Build cities, or recruit and promote knights."
      : "Build cities or purchase deployment cards.";
    case "paper": return "Improve your cities on the Science track.";
    case "cloth": return "Improve your cities on the Trade track.";
    case "coin": return "Improve your cities on the Politics track.";
  }
}
export const PROGRESS_LABELS: Record<ProgressKind, string> = {
  alchemist: "Alchemist",
  crane: "Crane",
  engineer: "Engineer",
  inventor: "Inventor",
  irrigation: "Irrigation",
  medicine: "Medicine",
  mining: "Mining",
  printer: "Printer",
  roadBuilding: "Road Building",
  smith: "Smith",
  commercialHarbor: "Commercial Harbor",
  masterMerchant: "Master Merchant",
  merchantFleet: "Merchant Fleet",
  merchant: "Merchant",
  resourceMonopoly: "Resource Monopoly",
  commodityMonopoly: "Commodity Monopoly",
  bishop: "Bishop",
  constitution: "Constitution",
  deserter: "Deserter",
  diplomat: "Diplomat",
  intrigue: "Intrigue",
  saboteur: "Saboteur",
  spy: "Spy",
  warlord: "Warlord",
  wedding: "Wedding",
};
export const PROGRESS_HELP: Record<ProgressKind, string> = {
  alchemist:
    "Before rolling, choose both numbered dice. The event die still rolls.",
  crane: "Buy one city improvement for one fewer commodity.",
  engineer: "Build one city wall for free.",
  inventor: "Swap two number tokens: 3, 4, 5, 9, 10 or 11.",
  irrigation:
    "Collect two Grain per different fields hex touching your buildings.",
  medicine: "Upgrade a settlement for one Grain and two Ore.",
  mining:
    "Collect two Ore per different mountains hex touching your buildings.",
  printer: "One public victory point, counted automatically.",
  roadBuilding:
    "Place two connected roads for free, or roads and ships in Voyages. Use fewer only if no legal routes or pieces remain.",
  smith:
    "Promote one or two different knights for free. Fortress and piece limits apply.",
  commercialHarbor:
    "This turn, offer each opponent one resource for a commodity they choose. You may stop early.",
  masterMerchant:
    "Look at a higher-scoring opponent’s hand and take two resource or commodity cards.",
  merchantFleet:
    "Exchange one chosen resource or commodity at 2:1 until your turn ends.",
  merchant:
    "Place the Merchant on land other than gold, touching your building. Hold its point and resource discount until another player moves it.",
  resourceMonopoly: "Take up to two of one resource from every opponent.",
  commodityMonopoly: "Take up to one of one commodity from every opponent.",
  bishop:
    "Move the robber and steal one card from each adjacent opponent. Available after the first barbarian attack.",
  constitution: "One public victory point, counted automatically.",
  deserter:
    "An opponent removes a knight of their choice. You may place a matching knight for free.",
  diplomat:
    "Remove an open road, or an open ship in Voyages. If it is yours, you may relocate the same piece type.",
  intrigue:
    "Displace an opposing knight touching one of your roads, or ships in Voyages. Its owner chooses a relocation.",
  saboteur:
    "Each opponent with at least your score discards half their resource and commodity cards.",
  spy: "Look at an opponent’s progress cards and choose one to take.",
  warlord:
    "Activate all your inactive knights for free. Newly activated knights can act on a later turn.",
  wedding:
    "Each higher-scoring opponent gives you two resource or commodity cards of their choice.",
};
export function progressImage(card: ProgressCard) {
  const name = card.kind.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
  return CITIES_ASSETS[`card_progress_${card.track}_${name}`];
}
export const CHOICE_LABELS: Record<PublicCitiesChoice["kind"], string> = {
  pillage: "Choose a city to pillage",
  defenderProgress: "Choose your defender progress card",
  discardProgress: "Return a progress card",
  aqueduct: "Choose an Aqueduct resource",
  metropolis: "Choose a metropolis city",
  relocateKnight: "Relocate your displaced knight",
  masterMerchant: "Choose cards from the revealed hand",
  spy: "Choose a progress card to take",
  wedding: "Choose Wedding cards to give",
  saboteur: "Choose Saboteur cards to discard",
  deserter: "Choose a knight to remove",
  deserterPlace: "Place your free Deserter knight",
  relocateRoad: "Relocate your route",
  harborExchange: "Choose a commodity to exchange",
};
