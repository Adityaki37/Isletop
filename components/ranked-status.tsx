import type { View } from "@/lib/game";
import { RANKED_ASSETS } from "@/lib/ranked-assets";
import { PLACEMENT_GAMES } from "@/lib/ranked-types";
export default function RankedStatus({ game }: { game: View }) {
  if (!game.ranked || game.phase === "finished") return null;
  const own = game.ranked.players[game.me];
  return (
    <div className="ranked-table-status">
      <strong>Ranked · {game.ranked.season.label}</strong>
      {own &&
        (own.rating === null ? (
          <span>
            Placement game {Math.min(own.games + 1, PLACEMENT_GAMES)}/
            {PLACEMENT_GAMES}
          </span>
        ) : (
          <span className="ranked-rating">
            {own.division && (
              <img
                src={RANKED_ASSETS[own.division]}
                alt={own.division}
                width={32}
                height={32}
              />
            )}
            <strong>{own.rating}</strong>
            <span>
              Win +{own.win} · Loss {own.loss}
            </span>
          </span>
        ))}
    </div>
  );
}
