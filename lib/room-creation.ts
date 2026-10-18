import { applyAction, type Action, type Game } from "./game";

// Apply only supported lobby choices before insertRoom. Invalid choices never
// leave a partially created room in storage.
export function applyRoomCreationOptions(game: Game, body: Record<string, unknown>) {
  const settings: Action = { type: "settings" };
  for (const key of ["target", "diceMode", "turnSeconds", "discardLimit", "friendlyRobber", "hideBank", "public"] as const) {
    if (body[key] !== undefined) Object.assign(settings, { [key]: body[key] });
  }
  if (body.title !== undefined) settings.text = body.title as string;
  applyAction(game, 0, settings);
  if (body.color !== undefined) applyAction(game, 0, { type: "color", color: body.color as number });
  const bots = body.botCount === undefined ? 0 : body.botCount;
  if (!Number.isInteger(bots) || Number(bots) < 0 || Number(bots) >= game.capacity || (game.mode === "solo" && bots !== 0))
    throw new Error("Choose a bot count that leaves a seat for you.");
  for (let i = 0; i < Number(bots); i++) applyAction(game, 0, { type: "addBot" });
}
