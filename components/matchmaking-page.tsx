"use client";
import { MAX_PLAYERS } from "@/lib/player-colors";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { BASE_MAPS, baseMapAvailable, baseMapName, baseMapPreview, baseMapDescription, type BaseMap } from "@/lib/base-maps";
import type { AccountProfile } from "@/lib/account-types";
import {
  CASUAL_QUEUES,
  MATCHMAKING_QUEUES,
  type CasualQueue,
  type MatchmakingStatus,
} from "@/lib/matchmaking-types";
import { DEFAULT_AVATAR } from "@/lib/avatars";
import { ASSETS } from "@/lib/assets";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import RandomMapPreview from "./random-map-preview";
import TurnTimerControl from "./turn-timer-control";

export default function MatchmakingPage({
  account,
  name,
  onName,
  onTicket,
  onLeave,
  botPractice = false,
}: {
  account: AccountProfile | null;
  name: string;
  onName: (value: string) => void;
  onTicket: (ticket: string | null) => void;
  onLeave: (url: string) => void;
  botPractice?: boolean;
}) {
  const [selectedQueue, setQueue] = useState<CasualQueue | null>(null),
    [botCount, setBotCount] = useState(1),
    [botTurnSeconds, setBotTurnSeconds] = useState(60),
    [mapStep, setMapStep] = useState(botPractice),
    [selectedMap, setSelectedMap] = useState<BaseMap>("baseRandom"),
    [data, setData] = useState<MatchmakingStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [observedAt, setObservedAt] = useState(Date.now),
    [tick, setTick] = useState(Date.now);
  const inFlight = useRef(false),
    mutating = useRef(false),
    generation = useRef(0),
    waiting = useRef<string | null>(null),
    alive = useRef(true);
  const queue = (botPractice ? "duel" : selectedQueue) ?? "duel";
  const accept = useCallback(
    (result: MatchmakingStatus) => {
      if (!alive.current) return;
      setObservedAt(Date.now());
      setData(result);
      const ticket = result.status === "waiting" ? result.ticket : null;
      waiting.current = ticket;
      onTicket(ticket);
      if (result.status === "waiting") {
        setQueue(result.queue === "base4" ? "base4" : "duel");
        setSelectedMap(result.map ?? "baseRandom");
        setMapStep(true);
      }
      if (result.status === "matched") location.assign(`/?room=${result.code}`);
    },
    [onTicket],
  );
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    async function refresh() {
      if (
        inFlight.current ||
        mutating.current ||
        (botPractice && !waiting.current) ||
        (waiting.current && document.visibilityState === "hidden")
      )
        return;
      inFlight.current = true;
      const epoch = generation.current;
      try {
        const ticket = waiting.current,
          r = await fetch(`/api/matchmaking?map=${selectedMap}`, {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(8000),
            ]),
            ...(ticket
              ? {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ op: "heartbeat", ticket, map: selectedMap }),
                }
              : {}),
          });
        const result = (await r.json()) as MatchmakingStatus & {
          error?: string;
        };
        if (controller.signal.aborted || epoch !== generation.current) return;
        if (!r.ok) {
          if (r.status === 409) {
            waiting.current = null;
            onTicket(null);
          }
          throw new Error(result.error);
        }
        if (controller.signal.aborted) return;
        setError("");
        accept(result);
      } catch (e) {
        if (!controller.signal.aborted && epoch === generation.current)
          setError(
            e instanceof Error
              ? e.message
              : "Unable to reconnect to matchmaking.",
          );
      } finally {
        inFlight.current = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const visibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive.current = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [accept, onTicket, botPractice, selectedMap]);
  useEffect(() => {
    if (data?.status !== "waiting") return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [data?.status]);
  async function act(op: "join" | "cancel") {
    if (mutating.current) return;
    const ticket = op === "join" ? crypto.randomUUID() : waiting.current;
    if (!ticket) return;
    if (op === "join") {
      waiting.current = ticket;
      onTicket(ticket);
    }
    setBusy(true);
    mutating.current = true;
    generation.current++;
    setError("");
    try {
      localStorage.setItem("island_name", name);
      const r = await fetch("/api/matchmaking", {
          method: "POST",
          signal: AbortSignal.timeout(8000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op,
            ticket,
            ...(op === "join" ? { queue, map: selectedMap, name, avatar: DEFAULT_AVATAR } : {}),
          }),
        }),
        result = (await r.json()) as MatchmakingStatus & { error?: string };
      if (!r.ok) throw new Error(result.error);
      accept(result);
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "Unable to update the queue. Retry.",
        );
    } finally {
      mutating.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function playBot() {
    if (mutating.current || waiting.current) return;
    mutating.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    try {
      localStorage.setItem("island_name", name);
      const response = await fetch("/api/rooms", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "create",
          practice: "bots",
          botCount,
          turnSeconds: botTurnSeconds,
          map: selectedMap,
          name: account?.displayName ?? name,
          avatar: DEFAULT_AVATAR,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        game?: { code: string };
      };
      if (!response.ok) throw new Error(result.error);
      if (!result.game) throw new Error("The bot game could not be opened.");
      if (alive.current) onLeave(`/?room=${result.game.code}`);
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Unable to start the bot game.");
    } finally {
      mutating.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const isWaiting = data?.status === "waiting",
    disabled = busy || isWaiting;
  const elapsed = isWaiting
    ? Math.max(
        0,
        Math.floor(
          (data.serverTime + tick - observedAt - data.joinedAt) / 1000,
        ),
      )
    : 0;
  const gameMode = botPractice ? (botCount === 1 ? "duel" : "base") : MATCHMAKING_QUEUES[queue].mode;
  const players = botPractice ? botCount + 1 : MATCHMAKING_QUEUES[queue].players;
  function selectMode(next: CasualQueue) {
    setQueue(next); setSelectedMap("baseRandom"); setMapStep(false); setError("");
  }
  function selectBotCount(count: number) {
    setBotCount(count);
    if (!baseMapAvailable(selectedMap, count === 1 ? "duel" : "base", count + 1)) setSelectedMap("baseRandom");
  }
  return (
    <section className="matchmaking-page" aria-label={botPractice ? "Bot game setup" : "Matchmaking"} aria-busy={busy}>
      <h2>{botPractice ? "Play with Bots" : "Play"}</h2>
      <p>
        {botPractice
          ? `Play a private game with ${botCount} ${botCount === 1 ? "bot" : "bots"}. Choose your map and turn timer, then start instantly.`
          : "Choose a mode and map, then Start Game to find human players."}
      </p>
      {!mapStep && <fieldset className="matchmaking-modes" disabled={disabled}>
        <legend className="sr-only">Game mode</legend>
        {(Object.keys(CASUAL_QUEUES) as CasualQueue[]).map((key) => {
          const preset = MATCHMAKING_QUEUES[key];
          return (
            <label
              key={key}
              className={`matchmaking-card ${!botPractice && queue === key ? "selected" : ""}`}
            >
              <input
                className="sr-only"
                type="radio"
                name="matchmaking-mode"
                value={key}
                checked={!botPractice && queue === key}
                onChange={() => selectMode(key)}
              />
              <img src={preset.image} alt="" width={180} height={140} />
              <h3>{preset.title}</h3>
              <span>
                <img src={ASSETS.icon_playtime} alt="" />
                <span title="Estimated match duration">
                  ~{preset.estimatedMinutes} min
                </span>{" "}
                <img src={ASSETS.icon_players} alt="" />
                {preset.players} players
              </span>
              <small>{data?.counts[key] ?? 0} waiting</small>
            </label>
          );
        })}
        <button type="button" className="matchmaking-card matchmaking-bots-link" disabled={disabled}
          onClick={() => onLeave("/play/bots")}>
          <Bot aria-hidden="true" />
          <h3>Bots</h3>
          <span>Instant game · 2–12 players</span>
          <small>Choose 1–11 bots</small>
        </button>
      </fieldset>}
      {botPractice && <div id="casual-bots" className="account-form">
        <label>Number of bots
          <NativeSelect value={botCount} disabled={disabled} onChange={event => selectBotCount(Number(event.target.value))}>
            {Array.from({length: MAX_PLAYERS - 1}, (_, i) => i + 1).map(count => <option key={count} value={count}>
              {count} {count === 1 ? "bot" : "bots"}
            </option>)}
          </NativeSelect>
        </label>
        <TurnTimerControl value={botTurnSeconds} disabled={disabled} onChange={setBotTurnSeconds} />
      </div>}
      {mapStep && <section className="matchmaking-map-step" aria-label="Choose a map">
        <h3>Choose a map</h3>
        {!botPractice && <p>{MATCHMAKING_QUEUES[queue].title} · {players} players</p>}
        <fieldset className="matchmaking-map-grid" disabled={disabled}>
          <legend className="sr-only">Map</legend>
          {["baseRandom", ...BASE_MAPS.filter(map => map !== "baseRandom")].filter(map => baseMapAvailable(map, gameMode, players)).map(map => (
            <label key={map} className={`matchmaking-map-card ${selectedMap === map ? "selected" : ""}`}>
              <input className="sr-only" type="radio" name="matchmaking-map" value={map} checked={selectedMap === map}
                onChange={() => setSelectedMap(map as BaseMap)} />
              {map === "baseRandom"
                ? <RandomMapPreview players={players} seed={57322} width={160} height={120} label="Randomized map example" />
                : <img src={baseMapPreview(map as BaseMap)} alt="" width={160} height={120} />}
              <strong>{map === "baseRandom" ? "Randomized" : baseMapName(map as BaseMap)}</strong>
              {map === "baseRandom" && <small>Default · Fresh shuffle every game</small>}
            </label>
          ))}
        </fieldset>
        <p>{baseMapDescription(selectedMap)}</p>
      </section>}
      {!account && (
        <div className="matchmaking-identity">
          <label>
            Your name
            <Input
              value={name}
              maxLength={24}
              onChange={(e) => onName(e.target.value)}
              disabled={disabled}
            />
          </label>
        </div>
      )}
      {account && <p>Playing as {account.displayName}</p>}
      {isWaiting && (
        <div className="matchmaking-status" role="status">
          <strong>
            Finding a {MATCHMAKING_QUEUES[data.queue].title} game · {baseMapName(data.map ?? selectedMap)}…
          </strong>
          <span>
            {data.waiting}/{MATCHMAKING_QUEUES[data.queue].players} humans ready
            · Waiting {Math.floor(elapsed / 60)}:
            {String(elapsed % 60).padStart(2, "0")}
          </span>
        </div>
      )}
      {!botPractice && !data && !error && <p role="status">Connecting to matchmaking…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="matchmaking-actions">
        {isWaiting ? (
          <Button
            className="matchmaking-start"
            disabled={busy}
            onClick={() => void act("cancel")}
          >
            Cancel Queue
          </Button>
        ) : (
          <Button
            className="matchmaking-start"
            disabled={busy || (mapStep && !botPractice && !data) || (!account && !name.trim())}
            onClick={() => { if (!mapStep) setMapStep(true); else void (botPractice ? playBot() : act("join")); }}
          >
            {busy ? (botPractice ? "Starting…" : "Joining…") : !mapStep ? "Choose Map" : botPractice ? `Play with ${botCount} ${botCount === 1 ? "Bot" : "Bots"}` : "Start Game"}
          </Button>
        )}
      </div>
    </section>
  );
}
