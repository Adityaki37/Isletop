"use client";
import { usesCitiesKnights } from "@/lib/game-modes";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReplayTimeline, type ReplayPage } from "@/lib/match-replay";
import type { ArchivedResult, MatchSummary } from "@/lib/match-history";
import { GOODS } from "@/lib/cities-knights";
import { RESOURCES } from "@/lib/board";
import { ASSETS, PLAYER_COLORS } from "@/lib/assets";
import { publicLeader } from "@/lib/game-display";
import { REPLAY_ASSETS } from "@/lib/replay-assets";
import { CITIES_ASSETS } from "@/lib/cities-assets";
import {
  GOOD_LABELS,
  goodImage,
  progressImage,
  PROGRESS_LABELS,
} from "@/lib/goods-ui";
import IslandBoard from "./board";
import BoardViewport from "./board-viewport";
import MatchStatistics from "./match-statistics";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/native-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
type Recording = ReplayPage & { summary: MatchSummary };
const DEV_ASSETS = {
  knight: "knight",
  roadBuilding: "roadbuilding",
  plenty: "yearofplenty",
  monopoly: "monopoly",
  victory: "vp",
};
const nameAction = (action: string) =>
  action.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const PHASE_LABELS: Record<string, string> = {
  setupSettlement: "Placing a settlement",
  setupRoad: "Placing a road",
  roll: "Rolling dice",
  action: "Playing",
  discard: "Discarding cards",
  robber: "Moving the robber",
  steal: "Stealing a card",
  special: "Special building phase",
  roadBuilding: "Building free roads",
  gold: "Choosing gold resources",
  citiesChoice: "Resolving an expansion choice",
  finished: "Game over",
};
export default function MatchReplay({
  match,
  share,
  onClose,
}: {
  match?: string;
  share?: string;
  onClose: () => void;
}) {
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [perspective, setPerspective] = useState(-1);
  const [search, setSearch] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState("");
  const [statsOpen, setStatsOpen] = useState(false);
  const [result, setResult] = useState<ArchivedResult | null>(null);
  const [statsError, setStatsError] = useState("");
  const [statsAttempt, setStatsAttempt] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setRecording(null);
    setError("");
    setLoaded(0);
    setIndex(0);
    setPlaying(false);
    setPerspective(-1);
    setShareUrl("");
    setMessage("");
    setResult(null);
    void (async () => {
      try {
        const query = share
          ? `share=${encodeURIComponent(share)}`
          : `match=${encodeURIComponent(match ?? "")}`;
        let after: number | null = null,
          first: Recording | null = null;
        const frames: ReplayPage["frames"] = [];
        do {
          const response = await fetch(
            `/api/replays?${query}${after === null ? "" : `&after=${after}&compact=1`}`,
            { cache: "no-store", signal: controller.signal },
          );
          const page = (await response.json()) as Omit<
            Recording,
            "initial" | "summary"
          > & {
            initial?: Recording["initial"];
            summary?: Recording["summary"];
            error?: string;
          };
          if (!response.ok) throw new Error(page.error);
          if (page.version !== 1)
            throw new Error("This replay format is not supported.");
          if (!first) {
            if (!page.initial || !page.summary)
              throw new Error("The saved replay header is missing.");
            first = { ...page, initial: page.initial, summary: page.summary };
          }
          if (page.id !== first.id || page.lastSequence !== first.lastSequence)
            throw new Error("The replay changed while loading.");
          frames.push(...page.frames);
          after = page.next;
          if (!controller.signal.aborted) setLoaded(frames.length);
        } while (after !== null);
        if (
          !first ||
          frames.length !== first.lastSequence - first.initialSequence ||
          frames.some(
            (frame, i) => frame.sequence !== first!.initialSequence + i + 1,
          )
        )
          throw new Error("The saved replay is incomplete.");
        if (!controller.signal.aborted) setRecording({ ...first, frames });
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to load the replay.",
          );
      }
    })();
    return () => controller.abort();
  }, [match, share, attempt]);
  const timeline = useMemo(
    () =>
      recording
        ? new ReplayTimeline(recording.initial, recording.frames)
        : null,
    [recording],
  );
  const state = useMemo(
    () => timeline?.stateAt(index) ?? null,
    [timeline, index],
  );
  const length = recording?.frames.length ?? 0;
  const leader = state ? publicLeader(state) : null;
  useEffect(() => {
    const container = logRef.current,
      current = container?.querySelector<HTMLElement>("[aria-current=step]");
    if (!container || !current) return;
    const top = current.offsetTop,
      bottom = top + current.offsetHeight;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (bottom > container.scrollTop + container.clientHeight)
      container.scrollTop = bottom - container.clientHeight;
  }, [index, search, recording]);
  const seek = (next: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(length, next)));
  };
  const toggle = () => {
    if (index === length) setIndex(0);
    setPlaying((p) => !p);
  };
  useEffect(() => {
    if (!playing || !recording) return;
    const timer = setInterval(
      () => setIndex((previous) => Math.min(length, previous + 1)),
      750 / speed,
    );
    return () => clearInterval(timer);
  }, [playing, recording, length, speed]);
  useEffect(() => {
    if (index >= length) setPlaying(false);
  }, [index, length]);
  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        statsOpen
      )
        return;
      if (event.key === "ArrowLeft") seek(index - 1);
      else if (event.key === "ArrowRight") seek(index + 1);
      else if (event.key === "Home") seek(0);
      else if (event.key === "End") seek(length);
      else if (event.code === "Space") toggle();
      else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [recording, index, length, statsOpen]);
  useEffect(() => {
    if (!statsOpen || !recording || result) return;
    setStatsError("");
    const controller = new AbortController();
    void fetch(`/api/matches?match=${recording.id}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load statistics.");
        const data = (await response.json()) as ArchivedResult;
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setStatsError(e.message);
      });
    return () => controller.abort();
  }, [statsOpen, recording, result, statsAttempt]);
  const copyShare = async () => {
    if (!recording) return;
    setSharing(true);
    setMessage("");
    try {
      let token = share;
      if (!token) {
        const response = await fetch("/api/replays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ match: recording.id }),
        });
        const data = (await response.json()) as {
          share?: string;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error);
        token = data.share;
      }
      const url = `${location.origin}/?replayShare=${token}`;
      setShareUrl(url);
      await navigator.clipboard.writeText(url);
      setMessage("Replay link copied.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Unable to copy this replay link.",
      );
    } finally {
      setSharing(false);
    }
  };
  return (
    <section className="match-replay panel">
      <div className="history-heading">
        <h2>Game Replay</h2>
        <Button variant="secondary" onClick={onClose}>
          Back to Game History
        </Button>
      </div>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => setAttempt((n) => n + 1)}>Retry</Button>
        </div>
      ) : !recording ? (
        <p role="status">
          Loading replay… {loaded > 0 ? `${loaded} actions` : ""}
        </p>
      ) : null}
      {recording && state && (
        <>
          <p>
            {recording.summary.title} ·{" "}
            {state.turn ? `Turn ${state.turn}` : "Initial placements"} ·{" "}
            {PHASE_LABELS[state.phase] ?? "Game replay"}
            {state.pause?.pausedAt != null ? " · Game paused" : ""}
            {state.pause?.vote ? ` · Vote to ${state.pause.vote.target}` : ""}
          </p>
          {!recording.complete && (
            <p className="muted">
              Recording started partway through this game. Earlier actions are
              unavailable.
            </p>
          )}
          <div className="replay-controls">
            {(
              [
                ["start", "Rewind to Start", () => seek(0), index === 0],
                ["back", "Rewind", () => seek(index - 1), index === 0],
                [
                  playing ? "pause" : "play",
                  playing ? "Pause Replay" : "Play Replay",
                  toggle,
                  length === 0,
                ],
                [
                  "forward",
                  "Fast Forward",
                  () => seek(index + 1),
                  index === length,
                ],
                [
                  "end",
                  "Fast Forward to End",
                  () => seek(length),
                  index === length,
                ],
              ] as const
            ).map(([icon, label, action, disabled]) => (
              <Button
                key={icon}
                variant="secondary"
                aria-label={label}
                title={label}
                onClick={action}
                disabled={disabled}
              >
                <img src={REPLAY_ASSETS[icon]} alt="" />
              </Button>
            ))}
            <NativeSelect
              aria-label="Replay speed"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[0.5, 1, 2, 4, 8].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="secondary"
              onClick={() => {
                setPlaying(false);
                setStatsOpen(true);
              }}
            >
              Open Stats
            </Button>
          </div>
          <label className="replay-scrubber">
            Action {index} / {length}
            <input
              type="range"
              aria-label="Replay action"
              min={0}
              max={length}
              value={index}
              onChange={(e) => seek(Number(e.target.value))}
            />
          </label>
          <p className="muted">
            ← / → step · Space play / pause · Home / End jump
          </p>
          <div className="replay-layout">
            <div className="replay-main">
              <div className="replay-table-status">
                <strong>
                  {state.phase === "finished"
                    ? recording.summary.mode === "solo"
                      ? "Practice completed"
                      : `${state.players[state.winner!].name} wins`
                    : state.rush && state.phase === "action"
                      ? "Simultaneous play"
                      : state.phase === "discard"
                        ? Object.keys(state.discards)
                            .map((seat) => state.players[Number(seat)].name)
                            .join(", ")
                        : state.players[
                            state.specialPlayer ??
                              state.cities?.choice?.player ??
                              state.active
                          ]?.name}
                </strong>
                {state.dice.map((die, i) => (
                  <img
                    key={i}
                    src={
                      state.cities && i === 1
                        ? CITIES_ASSETS[`dice_red_${die}`]
                        : ASSETS[`dice_${die}`]
                    }
                    alt={`Die ${i + 1}: ${die}`}
                  />
                ))}
                {state.cities?.event && (
                  <img
                    src={CITIES_ASSETS[`dice_event_${state.cities.event}`]}
                    alt={`Event: ${state.cities.event}`}
                  />
                )}
                {state.cities && (
                  <span>
                    Barbarians {state.cities.barbarianPosition}/7 ·{" "}
                    {state.cities.attacks} attacks
                  </span>
                )}
              </div>
              <BoardViewport className="history-board" key={recording.id}>
                <IslandBoard
                  board={state.board}
                  cities={state.cities}
                  playerColors={state.players.map((p) => p.color)}
                />
              </BoardViewport>
              <div className="replay-player-controls">
                <label htmlFor="replay-perspective">Perspective</label>
                <NativeSelect
                  id="replay-perspective"
                  value={perspective}
                  onChange={(e) => setPerspective(Number(e.target.value))}
                >
                  <option value={-1}>Spectator</option>
                  {state.players.map((p, seat) => (
                    <option key={seat} value={seat}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="stats-legend">
                {state.players.map((p, seat) => (
                  <span key={seat}>
                    {leader === seat && (
                      <img
                        className="replay-leader-crown"
                        src={ASSETS.icon_crown_leader}
                        alt="Public victory point leader"
                        title="Leading in public victory points"
                      />
                    )}
                    <i style={{ background: PLAYER_COLORS[p.color] }} />
                    {p.name}:{" "}
                    {seat === perspective || state.phase === "finished"
                      ? p.score
                      : p.publicScore}{" "}
                    points · {p.resources} goods ·{" "}
                    {p.development + p.progress.length} cards
                  </span>
                ))}
              </div>
              {state.offers.length > 0 && (
                <div className="replay-offers">
                  <h3>Trade offers</h3>
                  {state.offers.map((offer) => (
                    <p key={offer.id}>
                      <strong>{state.players[offer.from].name}</strong>:{" "}
                      {GOODS.filter((good) => offer.give[good])
                        .map(
                          (good) => `${offer.give[good]} ${GOOD_LABELS[good]}`,
                        )
                        .join(", ")}{" "}
                      →{" "}
                      {GOODS.filter((good) => offer.want[good])
                        .map(
                          (good) => `${offer.want[good]} ${GOOD_LABELS[good]}`,
                        )
                        .join(", ") || "Open-ended request"}
                      {offer.accepted.length > 0
                        ? ` · Accepted: ${offer.accepted.map((seat) => state.players[seat].name).join(", ")}`
                        : ""}
                    </p>
                  ))}
                </div>
              )}
              <details className="replay-bank">
                <summary>Bank</summary>
                <div className="replay-goods">
                  {(usesCitiesKnights(recording.summary.mode)
                    ? GOODS
                    : RESOURCES
                  ).map((good) => (
                    <span key={good}>
                      <img src={goodImage(good)} alt={GOOD_LABELS[good]} />
                      {state.bank[good]}
                    </span>
                  ))}
                </div>
              </details>
              {perspective >= 0 && (
                <div className="replay-hand">
                  <h3>{state.players[perspective].name}’s hand</h3>
                  <div className="replay-goods">
                    {(usesCitiesKnights(recording.summary.mode)
                      ? GOODS
                      : RESOURCES
                    ).map((good) => (
                      <span key={good}>
                        <img src={goodImage(good)} alt={GOOD_LABELS[good]} />
                        {state.players[perspective].hand[good]}
                      </span>
                    ))}
                  </div>
                  <div className="replay-cards">
                    {state.players[perspective].dev.map((card, i) => (
                      <img
                        key={i}
                        src={ASSETS[`card_${DEV_ASSETS[card.kind]}`]}
                        alt={nameAction(card.kind)}
                      />
                    ))}
                    {[
                      ...state.players[perspective].progress,
                      ...(state.cities?.players[perspective].revealed ?? []),
                    ].map((card) => (
                      <img
                        key={card.id}
                        src={progressImage(card)}
                        alt={PROGRESS_LABELS[card.kind]}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <aside className="replay-log">
              <label htmlFor="replay-search">Game log</label>
              <input
                id="replay-search"
                placeholder="Find an action"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="replay-log-events" ref={logRef}>
                <Button
                  variant="ghost"
                  onClick={() => seek(0)}
                  aria-current={index === 0 ? "step" : undefined}
                >
                  Start of recording
                </Button>
                {recording.frames.map((frame, i) => {
                  const text =
                    frame.messages.join(" ") ||
                    `${frame.seat === null ? "Table" : recording.initial.players[frame.seat].name}: ${nameAction(frame.action)}`;
                  return text.toLowerCase().includes(search.toLowerCase()) ? (
                    <Button
                      key={frame.sequence}
                      variant="ghost"
                      aria-current={index === i + 1 ? "step" : undefined}
                      onClick={() => seek(i + 1)}
                    >
                      {i + 1}. {text}
                    </Button>
                  ) : null;
                })}
              </div>
            </aside>
          </div>
          <div className="replay-share">
            <p>
              Shared replays reveal every player’s past hands and cards. Result
              links show only the final board and statistics.
            </p>
            <Button onClick={copyShare} disabled={sharing}>
              <img src={REPLAY_ASSETS.share} alt="" />
              {sharing ? "Sharing…" : "Share Replay"}
            </Button>
            {shareUrl && <a href={shareUrl}>{shareUrl}</a>}
            {message && <p role="status">{message}</p>}
          </div>
        </>
      )}
      <Dialog open={statsOpen} onOpenChange={setStatsOpen}>
        <DialogContent className="statistics-dialog">
          <DialogHeader>
            <DialogTitle>Game Statistics</DialogTitle>
          </DialogHeader>
          {result ? (
            <MatchStatistics game={result.game} showReplayLink={false} />
          ) : statsError ? (
            <div role="alert">
              <p>{statsError}</p>
              <Button onClick={() => setStatsAttempt((n) => n + 1)}>
                Retry Statistics
              </Button>
            </div>
          ) : (
            <p role="status">Loading statistics…</p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
