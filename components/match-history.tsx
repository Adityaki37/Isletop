"use client";
import { useCallback, useEffect, useState } from "react";
import type { ArchivedResult, MatchSummary } from "@/lib/match-history";
import { Button } from "./ui/button";
import IslandBoard from "./board";
import BoardViewport from "./board-viewport";
import MatchStatistics from "./match-statistics";
import { PLAYER_COLORS } from "@/lib/assets";
const modeName = (mode: MatchSummary["mode"]) =>
  ({
    base: "Base",
    duel: "1v1",
    solo: "Solo Practice",
    rush: "Rapid Play",
    seafarers: "Voyages",
    citiesKnights: "Cities & Defenders",
    seafarersCitiesKnights: "Voyages + Cities & Defenders",
  })[mode];
export default function MatchHistory({
  initialMatch,
  onClose,
}: {
  initialMatch?: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<MatchSummary[]>([]);
  const [cursor, setCursor] = useState<{ at: number; id: string } | null>(null);
  const [selected, setSelected] = useState(initialMatch ?? "");
  const [result, setResult] = useState<ArchivedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const list = useCallback(async (next?: { at: number; id: string }) => {
    setLoading(true);
    setError("");
    try {
      const query = next ? `?before=${next.at}&id=${next.id}` : "";
      const response = await fetch(`/api/matches${query}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        matches: MatchSummary[];
        next: { at: number; id: string } | null;
      };
      if (!response.ok) throw new Error(data.error);
      setItems((old) => (next ? [...old, ...data.matches] : data.matches));
      setCursor(data.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load game history.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!selected) void list();
  }, [selected, list]);
  useEffect(() => {
    if (!selected) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResult(null);
    void (async () => {
      try {
        const response = await fetch(
          `/api/matches?match=${encodeURIComponent(selected)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await response.json()) as ArchivedResult & {
          error?: string;
        };
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) setResult(data);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to load game result.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selected, attempt]);
  const select = (id: string) => {
    setSelected(id);
    history.replaceState(null, "", `/?match=${id}`);
  };
  return (
    <section className="match-history panel">
      <div className="history-heading">
        <h2>{selected ? "Game Result" : "Game History"}</h2>
        <Button variant="secondary" onClick={onClose}>
          Back to Rooms
        </Button>
      </div>
      {selected && (
        <Button
          variant="secondary"
          onClick={() => {
            setSelected("");
            history.replaceState(null, "", "/?history=1");
          }}
        >
          Your Game History
        </Button>
      )}
      {loading && <p role="status">Loading games…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button
            onClick={() => (selected ? setAttempt((n) => n + 1) : void list())}
          >
            Retry
          </Button>
        </div>
      )}
      {!selected && !items.length && !loading && !error && (
        <p>
          No completed games yet. Results are saved here when you finish a game
          using this browser.
        </p>
      )}
      {!selected &&
        items.map((match) => (
          <article className="history-match" key={match.id}>
            <div>
              <strong>
                {match.title} · {modeName(match.mode)}
              </strong>
              <p>
                {new Date(match.finishedAt).toLocaleString()} ·{" "}
                {match.players.length}{" "}
                {match.players.length === 1 ? "player" : "players"} ·{" "}
                {match.turns} turns
              </p>
              <span>
                {match.mode === "solo"
                  ? "Practice completed"
                  : `${match.players[match.winner].name} won`}{" "}
                · {match.players[match.winner].score} points
                {match.resignedBy !== null ? " · Resignation" : ""}
              </span>
            </div>
            <Button onClick={() => select(match.id)}>View Result</Button>
          </article>
        ))}
      {!selected && cursor && (
        <Button disabled={loading} onClick={() => void list(cursor)}>
          Load More
        </Button>
      )}
      {result && (
        <>
          <h3>
            {result.summary.mode === "solo"
              ? "Practice completed"
              : `${result.summary.players[result.summary.winner].name} wins!`}
          </h3>
          <p>
            {modeName(result.summary.mode)} ·{" "}
            {new Date(result.summary.finishedAt).toLocaleString()} ·{" "}
            {result.summary.turns} turns · Target {result.summary.target}
          </p>
          {result.summary.resignedBy !== null && (
            <p>
              {result.summary.players[result.summary.resignedBy].name} resigned.
            </p>
          )}
          <div className="stats-legend">
            {result.summary.players.map((player, seat) => (
              <span key={seat}>
                <i style={{ background: PLAYER_COLORS[player.color] }} />
                {player.name}: {player.score}
              </span>
            ))}
          </div>
          <BoardViewport
            className="history-board"
            key={`board-${result.summary.id}`}
          >
            <IslandBoard
              board={result.game.board}
              cities={result.game.cities}
              playerColors={result.game.players.map((p) => p.color)}
            />
          </BoardViewport>
          <MatchStatistics
            key={`stats-${result.summary.id}`}
            game={result.game}
          />
        </>
      )}
    </section>
  );
}
