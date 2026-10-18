import { applyAction as engineAction } from "../lib/game";

// Focused rule fixtures use stable seats; randomized starts have their own tests.
export const applyActionInSeatOrder: typeof engineAction = (
  game,
  seat,
  action,
  rng,
  now,
) =>
  engineAction(
    game,
    seat,
    action,
    action.type === "start" ? () => 0.999 : rng,
    now,
  );
