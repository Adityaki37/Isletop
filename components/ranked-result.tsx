"use client";
import type { RankedView } from "@/lib/ranked-types";
import { Rating, RANKED_LABELS } from "./ranked-profile";
export default function RankedResult({ ranked }: { ranked: RankedView }) {
  return (
    <section className="ranked-result" aria-label="Ranked result">
      <h3>
        {RANKED_LABELS[ranked.mode]} · {ranked.season.label}
      </h3>
      {ranked.players.map((p) => (
        <div key={p.username}>
          <a href={`/?profile=${p.username}`}>@{p.username}</a>
          <Rating player={{ ...p, rating: p.after ?? p.rating }} />
          {p.change !== null && (
            <strong className={p.change > 0 ? "rating-gain" : "rating-loss"}>
              {p.change > 0 ? "+" : ""}
              {p.change}
            </strong>
          )}
        </div>
      ))}
      <a href={`/leaderboards?mode=${ranked.mode}&season=${ranked.season.id}`}>
        View Leaderboard
      </a>
      <p>Rematches are unranked. Return to Play for another Ranked game.</p>
    </section>
  );
}
