"use client";
import { useEffect, useState } from "react";
import { RANKED_ASSETS } from "@/lib/ranked-assets";
import {
  PLACEMENT_GAMES,
  type RankedProfileData,
  type LeaderboardPlayer,
  type RankedMode,
} from "@/lib/ranked-types";
export const RANKED_LABELS: Record<RankedMode, string> = {
  base4: "4 Player",
  duel: "1v1",
  cities4: "Cities & Defenders",
  rush4: "Rapid Play",
};
export function Rating({
  player,
}: {
  player: Pick<LeaderboardPlayer, "games" | "rating" | "division">;
}) {
  return player.rating === null ? (
    <span>
      Placement {Math.min(player.games, PLACEMENT_GAMES)}/{PLACEMENT_GAMES}
    </span>
  ) : (
    <span className="ranked-rating">
      {player.division && (
        <img
          src={RANKED_ASSETS[player.division]}
          alt={player.division}
          width={32}
          height={32}
        />
      )}
      <strong>{player.rating}</strong>
    </span>
  );
}
export default function RankedProfile({ username }: { username: string }) {
  const [response, setResponse] = useState<{
      key: string;
      data: RankedProfileData | null;
      error: string;
    } | null>(null),
    [attempt, setAttempt] = useState(0),
    key = `${username}:${attempt}`;
  const data = response?.key === key ? response.data : null,
    error = response?.key === key ? response.error : "";
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
            `/api/leaderboards?profile=${encodeURIComponent(username)}`,
            { cache: "no-store", signal: controller.signal },
          ),
          result = (await response.json()) as RankedProfileData & {
            error?: string;
          };
        if (!response.ok) throw Error(result.error);
        if (!controller.signal.aborted)
          setResponse({ key, data: result, error: "" });
      } catch (e) {
        if (!controller.signal.aborted)
          setResponse({
            key,
            data: null,
            error: e instanceof Error ? e.message : "Unable to load ratings.",
          });
      }
    })();
    return () => controller.abort();
  }, [username, key]);
  return (
    <section className="ranked-profile" aria-label="Season ratings">
      <h3>Ranked · {data?.season.label ?? "Current season"}</h3>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      ) : !data ? (
        <p role="status">Loading ratings…</p>
      ) : (
        <div className="ranked-profile-grid">
          {data.ratings.map((p) => (
            <a key={p.mode} href={`/leaderboards?mode=${p.mode}`}>
              <strong>{RANKED_LABELS[p.mode]}</strong>
              <Rating player={p} />
              <small>
                {p.rank === null
                  ? "Unranked"
                  : `Rank ${p.rank} · ${p.wins} wins in ${p.games} games`}
              </small>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
