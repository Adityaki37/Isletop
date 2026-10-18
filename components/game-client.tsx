"use client";
import Image from "next/image";
import { ArrowRightLeft, Copy, FastForward, Hourglass, Route } from "lucide-react";
import { isBotPracticeGame } from "@/lib/bot-speed";
import { guestPlayerName } from "@/lib/player-name";
import { combinedModeImage } from "@/lib/combined-assets";
import {
  usesSeafarers,
  usesCitiesKnights,
  modeDescription,
} from "@/lib/game-modes";

import MatchmakingPage from "./matchmaking-page";
import CreateRoomPage from "./create-room-page";
import type { RoomSetup } from "@/lib/room-setup";
import LeaderboardPage from "./leaderboard-page";
import RankedStatus from "./ranked-status";
import { RANKED_ASSETS } from "@/lib/ranked-assets";
import { avatarAsset, botAvatarAsset, DEFAULT_AVATAR } from "@/lib/avatars";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Board,
  COLORS,
  Hand,
  RESOURCES,
  Resource,
  emptyHand,
  makeBoard,
} from "@/lib/board";
import {
  Action,
  PublicOffer,
  GameMode,
  COSTS,
  View,
  total,
  moveContext,
  tradeBlocked,
  tradeExecutor,
  actor,
  minimumPlayers,
} from "@/lib/game";
import { GOODS, Good, TRACKS, TRACK_COMMODITY } from "@/lib/cities-knights";
import type { GameHand } from "@/lib/cities-room";
import { CITIES_ASSETS } from "@/lib/cities-assets";
import { GOOD_LABELS, goodImage, goodUses, CHOICE_LABELS } from "@/lib/goods-ui";
import CitiesControls from "./cities-controls";
import SoundSettings from "./sound-settings";
import MatchStatistics from "./match-statistics";
import MatchHistory from "./match-history";
import MatchReplay from "./match-replay";
import AccountPage from "./account-page";
import SocialPanel from "./social-panel";
import Spectators from "./spectators";
import { useRememberGame } from "./game-reconnect";
import TurnTimerControl from "./turn-timer-control";
import { useTablePresence } from "./use-table-presence";
import { seatsInTurnOrder } from "@/lib/turn-order";
import { useLiveTable } from "./use-live-table";
import { useTableControls } from "./use-table-controls";
import TablePause from "./table-pause";
import { roomRequest, RoomNetworkError } from "@/lib/room-transport";
import { publicLeader } from "@/lib/game-display";
import type { AccountProfile } from "@/lib/account-types";
import { RUSH_SPEEDS } from "@/lib/rush";
import {
  BASE_MAPS,
  BaseMap,
  baseMapAvailable,
  baseMapName,
  baseMapDescription,
} from "@/lib/base-maps";
import { useGameSound } from "./use-game-sound";
import Counters from "./goods-counters";
import { ASSETS, PLAYER_COLORS, TILE_NAMES } from "@/lib/assets";
import {
  SEAFARERS_SCENARIOS,
  SeafarersScenario,
  scenarioName,
  scenarioTarget,
} from "@/lib/scenarios";
import IslandBoard from "./board";
import BoardViewport, { type BoardNavigationHandle } from "./board-viewport";
import TradeOffers from "./trade-offers";
import TradeComposer from "./trade-composer";
import DiscardComposer from "./discard-composer";
import { roomCapacities } from "@/lib/room-setup";
import ResourceChoiceComposer from "./resource-choice-composer";
import { useTradeCardDrag } from "./trade-card-drag";
import { useIsletopTitle } from "./use-isletop-title";
import GameLogLine from "./game-log-line";
import GameActivityPanels from "./game-activity-panels";
import { TableDice, ResourceDelivery } from "./table-feedback";
import type { ProductionFeedback } from "@/lib/production-feedback";
import type { CardFeedback } from "@/lib/card-feedback";
import CardExchange from "./card-exchange";
import { useGameTools } from "@/lib/web-tools";
import { Button } from "@/components/ui/button";
import BuildCard from "./build-card";
import HandCardHelp from "./hand-card-help";
import { useTradeDockOffset } from "./use-trade-dock-offset";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { TooltipProvider } from "./ui/tooltip";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
const LABELS = GOOD_LABELS;
const DEV_LABELS = {
  knight: "Knight",
  roadBuilding: "Road Building",
  plenty: "Year of Plenty",
  monopoly: "Monopoly",
  victory: "Victory Point",
};
const DEV_EFFECTS = {
  knight: "Move the robber and steal a card. Counts toward Largest Army.",
  roadBuilding: "Place two roads for free.",
  plenty: "Take two available resource cards from the bank.",
  monopoly: "Choose a resource and collect it from every opponent.",
  victory: "One hidden victory point. Counts automatically.",
};
const DEV_ASSET = {
  knight: "knight",
  roadBuilding: "roadbuilding",
  plenty: "yearofplenty",
  monopoly: "monopoly",
  victory: "vp",
};
type RoomSummary = {
  code: string;
  title: string;
  players: number;
  capacity: number;
  boardPlayers: number;
  mode: GameMode;
  scenario?: SeafarersScenario;
  map?: BaseMap;
  turnSeconds: number;
  target: number;
  turn: number;
};
type Modal =
  | "rules"
  | "join"
  | "trade"
  | "bank"
  | "tradeHub"
  | "discard"
  | "plenty"
  | "monopoly"
  | "leave"
  | "resign"
  | "gold"
  | "stats"
  | "preferences"
  | "table"
  | null;
function isResourceChoice(modal: Modal) {
  return modal === "plenty" || modal === "monopoly";
}
function isDockedDialog(modal: Modal) {
  return modal === "trade" || modal === "bank" || modal === "discard" || isResourceChoice(modal);
}
function handText(h: GameHand) {
  return GOODS.filter((r) => h[r])
    .map((r) => `${h[r]} ${LABELS[r]}`)
    .join(", ");
}
function TurnTimer({
  deadline,
  offset,
  pausedAt,
}: {
  deadline: number;
  offset: React.RefObject<number>;
  pausedAt?: number | null;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(
    0,
    Math.ceil((deadline - (pausedAt ?? now + offset.current)) / 1000),
  );
  return (
    <div
      className={`turn-timer ${seconds <= 10 ? "urgent" : ""}`}
      role="timer"
      aria-label="Time remaining"
    >
      <img src={ASSETS.icon_playtime} alt="" />
      {seconds}s
    </div>
  );
}
function Chat({
  g,
  send,
  busy,
}: {
  g: View;
  send: (a: Action) => Promise<boolean>;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <section className="chat-box">
      <div className="chat-messages" tabIndex={0} role="region" aria-label="Scrollable table chat">
        {g.chat.length ? (
          g.chat.map((m, i) => {
            const color = g.players.find((p) => p.name === m.name)?.color ?? 0;
            return (
              <div className="chat-line" key={i}>
                <strong
                  className={color === 3 ? "chat-sender-white" : undefined}
                  style={{ color: COLORS[color] }}
                >
                  {m.name}:{" "}
                </strong>
                {m.text}
              </div>
            );
          })
        ) : (
          <p className="muted">
            {g.me >= 0 ? "Say hello to the table." : "No messages yet."}
          </p>
        )}
      </div>
      {g.me >= 0 ? (
        <form
          className="chat-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const message = text;
            if (message.trim() && (await send({ type: "chat", text: message })))
              setText((draft) => draft === message ? "" : draft);
          }}
        >
          <Input
            aria-label="Chat message"
            value={text}
            maxLength={240}
            placeholder="Type a message…"
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" disabled={busy || !text.trim()}>
            Send
          </Button>
        </form>
      ) : (
        <p className="muted">Spectators can read table chat.</p>
      )}
    </section>
  );
}
function Rules({
  discardLimit = 7,
  friendlyRobber = false,
  mode = "base",
  diceMode = "random",
  scenario = "newShores",
  map = "base",
  capacity = 4,
}: {
  discardLimit?: number;
  friendlyRobber?: boolean;
  mode?: GameMode;
  diceMode?: "random" | "balanced";
  scenario?: SeafarersScenario;
  map?: BaseMap;
  capacity?: number;
}) {
  return (
    <div className="rule-list">
      <section className="quick-start" aria-label="Quick start">
        <strong>Quick start</strong>
        <ol>
          <li>
            Create a room, copy its invite, and have your friends join. Everyone
            selects Ready before the host starts.
          </li>
          <li>
            Follow the turn prompt. Choose a highlighted board target, then
            Confirm Placement. Cancel lets you choose again.
          </li>
          <li>
            On your turn, roll, trade, and build. Card descriptions and build
            costs explain each action. Reach the room victory target to win.
          </li>
        </ol>
        <p>{modeDescription(mode)}</p>
      </section>
      {mode === "solo" && (
        <p>
          <strong>Solo Practice:</strong> Build to ten points on the classic
          island with one seat and no bots. Roll, build, use development cards
          and trade with the bank or ports. Sevens still require discards and
          moving the robber. There are no opponent trades or stolen cards. Turns
          are untimed by default. This is a practice variant.
        </p>
      )}
      {mode === "rush" && (
        <p>
          <strong>Rapid Play:</strong> Place two settlements and roads in the
          usual order. Then everyone builds, buys cards and trades at once. Dice
          roll automatically; unanimous, irreversible votes roll early. Sevens
          rotate robber control between players. Everyone waits for required
          discards, but other players can build while the robber moves.
          Development cards can be played in succession; finish each required
          choice first.
        </p>
      )}
      {["base", "citiesKnights"].includes(mode) &&
        (capacity <= 4 || map !== "base") && (
          <p>
            <strong>{baseMapName(map)}:</strong> {baseMapDescription(map)}
          </p>
        )}
      {mode === "duel" && (
        <p>
          <strong>1v1:</strong> Two players on the classic island. The preset is
          15 points, a nine-card discard limit, balanced dice and 30-second turns.
          Friendly Robber is off by default. The host may customize these settings.
        </p>
      )}
      {usesSeafarers(mode) && (
        <>
          {usesCitiesKnights(mode) && (
            <p>
              <img
                src={combinedModeImage(capacity)}
                alt="Voyages + Cities & Defenders"
                width={48}
                height={48}
              />
            </p>
          )}
          <p>
            <strong>{scenarioName(scenario, capacity)}:</strong>{" "}
            {scenario === "fourIslands"
              ? "Place your starting buildings on any one or two islands. These are your home islands; your first settlement on each other island earns two bonus points, even if another player started there."
              : scenario === "fogIslands"
                ? "Place both starting buildings on the known starting island(s). A road or ship reaching a fog tile reveals it. Discovering a resource tile gives one of that resource; gold gives one of your choice. Sea gives no reward. Discovered land can be settled and produces normally, with no island bonus."
                : scenario === "throughDesert"
                  ? "Place both starting buildings on the main fertile region. Your first settlement on each offshore island or the land beyond the desert belt earns two bonus points. Roads can cross the desert belt."
                  : "Place both starting buildings on the main island. Your first settlement on each new island earns two bonus points."}{" "}
            The default target is{" "}
            {scenarioTarget(scenario, usesCitiesKnights(mode))}.
          </p>
          <p>
            <strong>Ships:</strong> Spend one lumber and one wool to build on a
            sea or coastal edge. Connect ships to ships, and connect ships to
            roads through your own settlement. Road Building can place roads or
            ships.
          </p>
          <p>
            <strong>Moving ships:</strong> Once after rolling, move an open end
            ship from a previous turn to a legal position. Ships next to the
            pirate cannot be built or moved.
          </p>
          <p>
            <strong>Pirate and gold:</strong> A seven lets you move the robber
            or pirate. The pirate steals from adjacent ship owners.
            {scenario !== "fourIslands" &&
              " Gold pays resources of your choice, one per settlement or two per city."}
          </p>
          {usesCitiesKnights(mode) && (
            <p>
              <strong>Sea knights:</strong> Recruit knights on land, then move
              active knights over your roads and ships. Ships connecting a
              knight to its settlement stay closed. A knight next to the pirate
              can chase it away; Bishop moves only the robber. Both raiders stay
              put until the first barbarian attack. Gold always gives resources,
              never commodities.
            </p>
          )}
        </>
      )}
      <p>
        <strong>Win:</strong> Reach the point target on your own normal turn.
        Settlements score 1 and cities 2.{" "}
        {usesCitiesKnights(mode)
          ? "Metropolises add 2; the Merchant, Island Defender and revealed victory cards each add 1. "
          : "Hidden victory cards score 1. "}
        {usesSeafarers(mode) ? "Longest Trade Route" : "Longest Road"}
        {usesCitiesKnights(mode)
          ? ` adds 2. The default target is ${usesSeafarers(mode) ? scenarioTarget(scenario, true) : 13}.`
          : " and Largest Army each add 2."}
      </p>
      <p>
        <strong>Setup:</strong> Place one settlement and adjacent{" "}
        {usesSeafarers(mode) ? "road or ship" : "road"} each, then repeat in
        reverse order
        {usesCitiesKnights(mode)
          ? " with a city instead of a settlement. Your starting city gives one resource per adjacent producing tile, without commodities."
          : ". Your second settlement gives starting resources."}
        Buildings must remain at least two edges apart.
      </p>
      <p>
        <strong>{mode === "rush" ? "Production:" : "Turns:"}</strong>{" "}
        {mode === "rush"
          ? "Automatic dice pay production while everyone trades and builds."
          : "Roll two dice, collect production, then trade and build in any order."}{" "}
        {usesCitiesKnights(mode)
          ? "An event die advances barbarians or awards progress cards according to the red die and city improvements. Cities on forest, pasture and mountains produce one resource and one commodity; fields and hills produce two resources."
          : "Cities produce twice as much as settlements."}{" "}
        The robber blocks its tile.
      </p>
      {diceMode === "balanced" && (
        <p>
          <strong>Balanced dice:</strong> Rolls draw from the 36 dice pairs,
          with recent sums weighted down and sevens balanced between players.
          The deck refills when fewer than 13 pairs remain.
        </p>
      )}
      <p>
        <strong>A seven:</strong> Everyone with more than {discardLimit}{" "}
        {usesCitiesKnights(mode) ? "resource and commodity cards" : "resources"}{" "}
        discards half, rounded down.{" "}
        {usesCitiesKnights(mode) &&
          "Each city wall raises its owner's limit by two. "}
        {mode === "rush"
          ? "The next player in the robber rotation"
          : "The active player"}{" "}
        moves the {usesSeafarers(mode) ? "robber or pirate" : "robber"} and
        steals one random card from an adjacent opponent.
        {usesCitiesKnights(mode) &&
          (usesSeafarers(mode)
            ? " Both raiders stay in place until the first barbarian attack."
            : " The robber stays in place until the first barbarian attack.")}
      </p>
      {friendlyRobber && (
        <p>
          <strong>Friendly robber:</strong> Tiles next to a player with two or
          fewer visible points are protected. Hidden victory cards do not affect
          protection.
        </p>
      )}
      <p>
        <strong>Cards:</strong>{" "}
        {usesCitiesKnights(mode)
          ? "Play progress cards after rolling, including newly received cards. Alchemist is played before rolling. Resolve each card fully before the next; keep at most four progress cards at the end of your turn. Victory cards are revealed immediately."
          : mode === "rush"
            ? "Play development cards whenever you have no pending card action. Victory points count immediately."
            : "Play at most one development card per turn, including before rolling. Newly purchased cards become playable on a later turn. Victory points count immediately."}
      </p>
      {usesCitiesKnights(mode) && (
        <>
          <p>
            <strong>Knights:</strong> Build or promote for one wool and one ore;
            activate for one grain. Active knights defend cities and can move,
            displace weaker knights or chase the robber on a later turn. A
            level-three politics improvement unlocks mighty knights.
          </p>
          <p>
            <strong>Barbarians:</strong> At the seventh advance, compare the
            number of cities with total active knight strength. A sole strongest
            defender earns one point; tied defenders choose progress cards. If
            defense fails, the weakest eligible defenders lose one unprotected
            city each. All knights then deactivate.
          </p>
          <p>
            <strong>Improvements:</strong> Spend paper, cloth or coin on
            science, trade or politics. Each level costs its new level in
            commodities. Level three grants a special ability; the first
            level-four improvement claims a metropolis, which a higher
            level-five rival can take.
          </p>
        </>
      )}
      <p>
        <strong>Trade:</strong>{" "}
        {mode === "rush"
          ? "Any two players can trade."
          : "Player trades must involve the active player."}
        The bank exchanges 4:1; ports improve this to 3:1 or 2:1.
      </p>
      {mode !== "rush" && (
        <p>
          <strong>{usesCitiesKnights(mode) ? "5–6" : "5–8"} players:</strong>{" "}
          Use the red flag to request a building phase after another player's
          normal turn. You can{" "}
          {usesCitiesKnights(mode)
            ? "build, improve cities, and build, activate or promote knights"
            : "build or buy cards"}
          . No trading, card play, or victory declaration during this special
          phase.
        </p>
      )}
    </div>
  );
}
export default function GameClient({ initialPage }: { initialPage?: "create" | "bots" } = {}) {
  const botSetupPage = initialPage === "bots";
  const [createRoomPage, setCreateRoomPage] = useState(initialPage === "create");
  const capacity = 4;
  const [g, setGame] = useState<View | null>(null),
    [code, setCode] = useState(""),
    [rooms, setRooms] = useState<RoomSummary[]>([]),
    [games, setGames] = useState<RoomSummary[]>([]),
    [name, setName] = useState(""),
    [joinCode, setJoinCode] = useState(""),
    [modal, setModalState] = useState<Modal>(null),
    [saving, setBusy] = useState(false),
    [error, setError] = useState(""),
    [connection, setConnection] = useState(""),
    [mode, setMode] = useState<
      "road" | "ship" | "moveShip" | "settlement" | "city" | null
    >(null),
    [give, setGive] = useState<GameHand>(emptyHand),
    [want, setWant] = useState<GameHand>(emptyHand),
    [tradeTargets, setTradeTargets] = useState<number[] | null>(null),
    [copied, setCopied] = useState(false);
  const [tradeDialogDocked, setTradeDialogDocked] = useState(false);
  const setModal = useCallback((value: Modal) => {
    // Radix keeps closed content mounted during its exit animation.
    if (value !== null) setTradeDialogDocked(isDockedDialog(value));
    setModalState(value);
  }, []);
  const shownResults = useRef<string | null>(null);
  useEffect(() => {
    if (g?.phase !== "finished" || g.winner === null) return;
    const matchKey = `${g.code}:${g.created}`;
    if (shownResults.current === matchKey) return;
    shownResults.current = matchKey;
    setModal("stats");
  }, [g, setModal]);
  const [rollingRequest, setRollingRequest] = useState(false);
  const [roomView, setRoomView] = useState<"open" | "spectate">("open");
  const [presentation, setPresentation] = useState<{ rollKey: string | null; feedback: ProductionFeedback | null; dice: number[]; cardEvents: CardFeedback[] }>({ rollKey: null, feedback: null, dice: [], cardEvents: [] });
  const boardNavigation = useRef<BoardNavigationHandle>(null);
  const gameDock = useRef<HTMLDivElement>(null);
  const tradeDockStyle = useTradeDockOffset(gameDock, isDockedDialog(modal) && !!g && g.phase !== "lobby");
  const [pending, setPending] = useState<Action | null>(null);
  const placementConfirm = useRef<HTMLButtonElement>(null);
  const placementOrigin = useRef<Element | null>(null);
  const placementAnchor = useRef<{ getBoundingClientRect: () => DOMRect; freeze: () => void } | null>(null);
  const isMobile = useIsMobile();
  const dialogOrigin = useRef<Element | null>(null);
  const [tradeDraft, setTradeDraft] = useState<{
    kind: "editOffer" | "counterOffer";
    id: number;
  } | null>(null);
  const [movingShip, setMovingShip] = useState<number | null>(null);
  const [confirmPlacement, setConfirmPlacement] = useState(true);
  const [roomTitle, setRoomTitle] = useState("");
  const [nickname, setNickname] = useState("");
  const [historyPage, setHistoryPage] = useState(false);
  const [matchmakingPage, setMatchmakingPage] = useState(false);
  const [leaderboardPage, setLeaderboardPage] = useState(false);
  const matchmakingTicket = useRef<string | null>(null);
  const setMatchmakingTicket = useCallback((ticket: string | null) => {
    matchmakingTicket.current = ticket;
  }, []);
  const leaveMatchmaking = useCallback(async (url: string) => {
    const ticket = matchmakingTicket.current;
    if (ticket) {
      try {
        const r = await fetch("/api/matchmaking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "cancel", ticket }),
          signal: AbortSignal.timeout(5000),
        });
        const result = (await r.json()) as { status: string; code: string };
        if (r.ok && result.status === "matched") {
          location.assign(`/?room=${result.code}`);
          return;
        }
      } catch {}
    }
    location.assign(url);
  }, []);
  const [historyMatch, setHistoryMatch] = useState("");
  const [replayMatch, setReplayMatch] = useState("");
  const [replayShare, setReplayShare] = useState("");
  const [accountPage, setAccountPage] = useState(false);
  const [profileUsername, setProfileUsername] = useState("");
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [socialOpen, setSocialOpen] = useState(false);
  const [socialTarget, setSocialTarget] = useState("");
  const interactionBusy = saving || !!connection;
  const isPaused = g?.pause?.pausedAt != null;
  const busy = interactionBusy || isPaused;
  useRememberGame(g);
  useTablePresence(
    code,
    g?.created,
    g?.me,
    account?.username,
  );
  const updateAccount = useCallback((next: AccountProfile | null) => {
    setAccount(next);
    if (next) {
      setName(next.displayName);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/accounts", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) {
          const data = (await response.json()) as {
            account: AccountProfile | null;
          };
          if (!controller.signal.aborted) updateAccount(data.account);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [updateAccount]);
  const clockOffset = useRef(0);
  const sound = useGameSound(g, connection, clockOffset);
  const currentCode = useRef(""),
    inflight = useRef(false),
    gameRef = useRef<View | null>(null);
  const lastProjectionAt = useRef(0);
  const update = useCallback((next: View) => {
    clockOffset.current = next.serverTime - Date.now();
    const lastSeen = lastProjectionAt.current;
    lastProjectionAt.current = Date.now();
    if (
      gameRef.current?.code === next.code &&
      gameRef.current.created === next.created &&
      gameRef.current.revision >= next.revision &&
      gameRef.current.me === next.me
    )
      return;
    const previous = gameRef.current;
    const continuous = previous && previous.code === next.code && previous.created === next.created && previous.me === next.me && Date.now() - lastSeen < 20000;
    if (!continuous) setPresentation({ rollKey: null, feedback: null, dice: next.dice, cardEvents: [] });
    else {
      const rolled = Object.values(next.rollCounts).reduce((a, b) => a + b, 0) > Object.values(previous.rollCounts).reduce((a, b) => a + b, 0);
      const delivered = next.productionFeedback && next.productionFeedback.sequence !== previous.productionFeedback?.sequence;
      const cardEvents = (next.cardFeedback ?? []).filter(event => event.sequence > (previous.cardFeedback?.at(-1)?.sequence ?? 0));
      if (rolled || delivered || cardEvents.length) setPresentation(current => ({
        rollKey: rolled ? `${next.code}:${next.created}:${next.revision}` : current.rollKey,
        feedback: delivered ? next.productionFeedback! : current.feedback,
        dice: next.dice.length ? next.dice : current.dice,
        cardEvents: [...current.cardEvents, ...cardEvents].slice(-24),
      }));
    }
    gameRef.current = next;
    setGame(next);
  }, []);
  const load = useCallback(
    async (room: string) => {
      try {
        const data = await roomRequest<{
          error?: string;
          game: View;
          rooms: RoomSummary[];
        }>(`/api/rooms?code=${encodeURIComponent(room)}`, {
          cache: "no-store",
        });
        if (currentCode.current === room) {
          update(data.game);
          setConnection("");
        }
      } catch (e) {
        if (currentCode.current === room)
          setConnection(
            e instanceof Error ? e.message : "Connection lost. Reconnecting…",
          );
      }
    },
    [update],
  );
  const updateLive = useCallback(
    (next: View) => {
      update(next);
      setConnection("");
    },
    [update],
  );
  const liveTable = useLiveTable(code, account?.username, updateLive);
  useEffect(() => {
    if (!code) {
      setConnection("");
      return;
    }
    const offline = () =>
      setConnection("You’re offline. Reconnect to resume the table.");
    const online = () => {
      setConnection("Reconnecting…");
      void load(code);
    };
    const visible = () => {
      if (!document.hidden) void load(code);
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    if (!navigator.onLine) offline();
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [code, load]);
  useEffect(() => {
    const initialName = guestPlayerName(localStorage.getItem("island_name"));
    localStorage.setItem("island_name", initialName);
    setName(initialName);
    setConfirmPlacement(localStorage.getItem("island_confirm") !== "false");
    const query = new URLSearchParams(location.search);
    if (query.has("account") || query.has("profile")) {
      setAccountPage(true);
      setProfileUsername(query.get("profile") ?? "");
    }
    if (query.has("rules")) setModal("rules");
    if (query.has("play")) setMatchmakingPage(true);
    if (location.pathname === "/leaderboards") setLeaderboardPage(true);
    if (query.has("create")) location.replace("/create");
    if (
      query.has("match") ||
      query.has("history") ||
      query.has("replay") ||
      query.has("replayShare")
    ) {
      setHistoryPage(true);
      setHistoryMatch(query.get("match") ?? "");
      setReplayMatch(query.get("replay") ?? "");
      setReplayShare(query.get("replayShare") ?? "");
    }
    const c = query.get("room")?.toUpperCase();
    if (c) {
      currentCode.current = c;
      setCode(c);
      setJoinCode(c);
    }
  }, [load, setModal]);
  useEffect(() => {
    setRoomTitle(g?.title ?? "");
  }, [g?.title]);
  const seatedName = g?.players[g.me]?.name;
  const rushMode = g?.mode === "rush";
  useEffect(() => {
    setNickname(seatedName ?? "");
  }, [seatedName]);
  useEffect(() => {
    if (!code) return;
    currentCode.current = code;
    let stopped = false;
    let loading = false;
    const tick = async () => {
      if (stopped || inflight.current || loading) return;
      loading = true;
      try {
        await load(code);
      } finally {
        loading = false;
      }
    };
    void tick();
    const timer = setInterval(tick, liveTable ? 15000 : rushMode ? 250 : 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [code, load, rushMode, liveTable]);
  useEffect(() => {
    if (code || createRoomPage || botSetupPage) return;
    const get = async () => {
      try {
        const r = await fetch("/api/rooms", { cache: "no-store" });
        const data = (await r.json()) as {
          error?: string;
          game: View;
          rooms: RoomSummary[];
          games: RoomSummary[];
        };
        if (r.ok) {
          setRooms(data.rooms);
          setGames(data.games);
        }
      } catch {}
    };
    void get();
    const t = setInterval(get, 10000);
    return () => clearInterval(t);
  }, [code, createRoomPage, botSetupPage]);
  useEffect(() => {
    if (
      g?.phase === "discard" &&
      g.discards[g.me] > 0 &&
      !isPaused &&
      !g.pause.vote
    ) {
      setWant(emptyHand());
      setModal("discard");
    }
  }, [g?.phase, g?.me, g?.discards[g?.me ?? -1], isPaused, g?.pause?.vote?.id, setModal]);
  useEffect(() => {
    setMode(null);
    setPending(null);
    setMovingShip(null);
  }, [g?.phase, g?.active, g?.specialPlayer, g?.citiesChoiceSeq]);
  useEffect(() => {
    if (modal === "discard" && !g?.discards[g.me]) setModal(null);
  }, [modal, g?.discards, g?.me, setModal]);
  useEffect(() => {
    if (
      g?.phase === "gold" &&
      (g.goldClaims[g.me] ?? 0) > 0 &&
      !isPaused &&
      !g.pause.vote
    ) {
      setWant(emptyHand());
      setModal("gold");
    }
  }, [g?.phase, g?.me, isPaused, g?.pause?.vote?.id, setModal]);
  useEffect(() => {
    if (isPaused || g?.pause?.vote) {
      setModal(null);
      setPending(null);
      setMode(null);
      setMovingShip(null);
    }
  }, [isPaused, g?.pause?.vote?.id, setModal]);
  useEffect(() => {
    if (modal === "gold" && (!g || !g.goldClaims[g.me])) setModal(null);
  }, [modal, g?.goldClaims, g?.me, setModal]);
  const api = async (body: Record<string, unknown>) => {
    if (inflight.current) return false;
    if (code && connection) {
      setError("Wait for the table to reconnect before making a move.");
      return false;
    }
    inflight.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await roomRequest<{
        error?: string;
        game: View;
        rooms: RoomSummary[];
      }>(
        "/api/rooms",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        body.op === "action",
      );
      if (data.game) {
        if (!["leave"].includes(body.op as string)) {
          currentCode.current = data.game.code;
          setCode(data.game.code);
          history.replaceState(null, "", `/?room=${data.game.code}`);
        }
        update(data.game);
      }
      setConnection("");
      return true;
    } catch (e) {
      if (e instanceof RoomNetworkError && code) setConnection(e.message);
      // Offers can disappear while any trade response is in flight. The live
      // table removes them and closes their drafts without an error banner.
      const action = body.action as Action | undefined;
      if (e instanceof Error && (e.message === "This offer is unavailable." ||
        (action?.type === "prepareCounter" && e.message === "Trading is available after rolling."))) return false;
      setError(
        e instanceof Error
          ? e.message
          : "Unable to save your move. Please try again.",
      );
      return false;
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };
  const send = async (action: Action) => {
    if (inflight.current) return false;
    if (action.type === "roll") setRollingRequest(true);
    try { return await api({
      op: "action",
      code,
      action,
      nonce: crypto.randomUUID(),
      expectedCreated: gameRef.current?.created,
      context: gameRef.current ? moveContext(gameRef.current) : undefined,
    }); } finally { if (action.type === "roll") setRollingRequest(false); }
  };
  const controls = useTableControls({
    game: g,
    enabled: sound.shortcuts,
    blocked:
      !!modal ||
      !!pending ||
      socialOpen ||
      createRoomPage ||
      accountPage ||
      historyPage ||
      leaderboardPage,
    busy,
    send,
    onError: setError,
  });
  const closeDialog = () => {
    const room = gameRef.current;
    if (
      tradeDraft?.kind === "counterOffer" &&
      room?.phase === "action" &&
      room.offers.some((o) => o.id === tradeDraft.id && o.preparing.includes(room.me))
    )
      void send({
        type: "prepareCounter",
        id: tradeDraft.id,
        preparing: false,
      });
    setTradeDraft(null);
    setModal(null);
  };
  const editTrade = (o: PublicOffer) => {
    setTradeDraft({ kind: "editOffer", id: o.id });
    setGive({ ...o.give });
    setWant({ ...o.want });
    setTradeTargets(o.targets);
    setModal("trade");
  };
  const counterTrade = async (o: PublicOffer) => {
    if (!(await send({ type: "prepareCounter", id: o.id, preparing: true })))
      return;
    const room = gameRef.current;
    if (!room || room.phase !== "action" || !room.offers.some((offer) => offer.id === o.id)) return;
    setTradeDraft({ kind: "counterOffer", id: o.id });
    const executor = tradeExecutor(o, room.active);
    const joiningCounter = executor !== o.from && room.me !== executor;
    setGive({ ...(joiningCounter ? o.give : o.want) });
    setWant({ ...(joiningCounter ? o.want : o.give) });
    setTradeTargets(executor === room.active ? o.targets : [o.from]);
    setModal("trade");
  };
  const tradeTurn = useRef<string | null>(null);
  useEffect(() => {
    const turnKey = g ? `${g.code}:${g.created}:${g.turn}:${g.active}` : null;
    // Live updates can skip the next player's roll phase. Rush has simultaneous
    // trading, so its automatic rolls do not end another player's trade draft.
    const turnEnded = !g?.rush && tradeTurn.current !== null && tradeTurn.current !== turnKey;
    tradeTurn.current = turnKey;
    if (
      (modal === "trade" || modal === "bank" || modal === "tradeHub") &&
      g &&
      (g.phase !== "action" || turnEnded ||
        (tradeDraft && !g.offers.some((o) => o.id === tradeDraft.id)))
    ) {
      // A required discard/gold prompt or game results may already have been
      // queued by this update. Close only the stale trade, preserving that prompt.
      setModalState(current =>
        current === "trade" || current === "bank" || current === "tradeHub" ? null : current,
      );
      setTradeDraft(null);
      setGive(emptyHand());
      setWant(emptyHand());
    }
  }, [g, modal, tradeDraft, setModal]);
  useEffect(() => {
    if (modal !== "trade" || tradeDraft?.kind !== "counterOffer") return;
    const id = tradeDraft.id;
    const pulse = setInterval(() => {
      const room = gameRef.current;
      if (room?.phase === "action" && room.offers.some((o) => o.id === id))
        void send({ type: "prepareCounter", id, preparing: true });
    }, 15000);
    return () => clearInterval(pulse);
  }, [modal, tradeDraft?.id, tradeDraft?.kind, code]);
  const place = (action: Action, target: SVGElement) => {
    if (confirmPlacement) {
      placementOrigin.current = target;
      let rect = target.getBoundingClientRect();
      let frozen = false;
      placementAnchor.current = {
        getBoundingClientRect: () => {
          if (!frozen && target.isConnected) rect = target.getBoundingClientRect();
          return rect;
        },
        freeze: () => {
          if (target.isConnected) rect = target.getBoundingClientRect();
          frozen = true;
        },
      };
      setPending(action);
    } else void send(action);
  };
  const cancelPlacement = useCallback(() => {
    setPending(null);
    const origin = placementOrigin.current;
    if (origin?.isConnected && origin instanceof SVGElement) origin.focus();
    else if (origin?.isConnected && origin instanceof HTMLElement)
      origin.focus();
    else boardNavigation.current?.focus();
  }, []);
  useEffect(() => {
    if (!pending) return;
    placementConfirm.current?.focus();
  }, [pending]);
  useGameTools(gameRef, send);
  const create = async (draft: RoomSetup) => {
    localStorage.setItem("island_name", name);
    const created = await api({
        op: "create",
        name,
        avatar: DEFAULT_AVATAR,
        ...draft,
        title: draft.title.trim() || undefined,
        scenario: usesSeafarers(draft.mode) ? draft.scenario : undefined,
      });
    if (created) setCreateRoomPage(false);
    return created;
  };
  const join = async (c = joinCode) => {
    localStorage.setItem("island_name", name);
    if (
      await api({
        op: "join",
        name,
        avatar: DEFAULT_AVATAR,
        code: c.toUpperCase().trim(),
      })
    )
      setModal(null);
  };
  const leave = async () => {
    if (
      g?.me === -1 ||
      (g && g.phase !== "lobby") ||
      (await api({ op: "leave", code }))
    ) {
      currentCode.current = "";
      gameRef.current = null;
      setCode("");
      setGame(null);
      setModal(null);
      history.replaceState(null, "", "/");
    }
  };
  const preview = useMemo(() => {
    let seed = 129;
    return makeBoard(capacity, () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    });
  }, [capacity]);
  const board: Board = g?.board ?? preview,
    me = g?.me ?? -1,
    self = g && me >= 0 ? g.players[me] : null,
    hand: GameHand = self?.hand ?? emptyHand(),
    acting = g ? actor(g) : null,
    myTurn = !!g && me >= 0 && me === acting && !isPaused,
    buildPhase = myTurn && ["action", "special"].includes(g?.phase ?? ""),
    normal = myTurn && g?.phase === "action";
  const goods = g?.cities ? GOODS : RESOURCES;
  const selectingHand = modal === "trade" || modal === "bank" || modal === "discard";
  const droppingToHand = selectingHand;
  const addDiscardGood = (resource: Good) => {
    if (busy || !g || g.phase !== "discard" || !(g.discards[me] > 0)) return;
    setWant(selection => {
      if (total(selection) >= g.discards[me] || (selection[resource] ?? 0) >= (hand[resource] ?? 0)) return selection;
      return { ...selection, [resource]: (selection[resource] ?? 0) + 1 };
    });
  };
  const removeDiscardGood = (resource: Good) => {
    if (busy) return;
    setWant(selection => ({ ...selection, [resource]: Math.max(0, (selection[resource] ?? 0) - 1) }));
  };
  const tradePartnersLocked = !!g && (
    g.active !== me || tradeDraft?.kind === "counterOffer" ||
    !!(tradeDraft && g.offers.find(o => o.id === tradeDraft.id)?.replyTo !== null)
  );
  const eligibleTradePartners = g ? g.players.flatMap((_, seat) =>
    seat !== me && !tradeBlocked(g, me, seat) ? [seat] : []
  ) : [];
  useIsletopTitle(!!g && me >= 0 && !isPaused && !["lobby", "finished"].includes(g.phase) && (
    g.phase === "discard" ? g.discards[me] > 0 :
    g.phase === "gold" ? g.goldClaims[me] > 0 : myTurn
  ));
  const bankGiveResource = goods.find(resource => (give[resource] ?? 0) > 0);
  const bankTradeReady = !!g && normal && !!bankGiveResource &&
    goods.filter(resource => (give[resource] ?? 0) > 0).length === 1 &&
    total(give) === (g.rates[bankGiveResource] ?? 4) && total(want) === 1 &&
    goods.every(resource => (give[resource] ?? 0) <= (hand[resource] ?? 0) &&
      (!(give[resource] ?? 0) || !(want[resource] ?? 0)) &&
      (g.bank === null || (want[resource] ?? 0) <= (g.bank[resource] ?? 0)));
  const addTradeGood = (resource: Good, receiving: boolean) => {
    if (busy) return;
    if (modal === "bank") {
      if (!g) return;
      if (receiving) {
        if (g.bank !== null && (g.bank[resource] ?? 0) < 1) return;
        setWant({ ...emptyHand(), [resource]: 1 });
        setGive({ ...give, [resource]: 0 });
      } else {
        const count = give[resource] ?? 0;
        if (count >= Math.min(hand[resource] ?? 0, g.rates[resource] ?? 4)) return;
        setGive({ ...emptyHand(), [resource]: count + 1 });
        setWant({ ...want, [resource]: 0 });
      }
      return;
    }
    if (receiving) {
      if ((want[resource] ?? 0) >= 50) return;
      setWant({...want, [resource]: (want[resource] ?? 0) + 1});
    } else {
      if ((give[resource] ?? 0) >= (hand[resource] ?? 0)) return;
      setGive({...give, [resource]: (give[resource] ?? 0) + 1});
    }
  };
  const addResourceChoice = (resource: Resource) => {
    if (busy || !g || !isResourceChoice(modal)) return;
    setWant(selection => {
      if (modal === "monopoly") return { ...emptyHand(), [resource]: 1 };
      if (total(selection) >= 2 || (g.bank !== null && selection[resource] >= g.bank[resource])) return selection;
      return { ...selection, [resource]: selection[resource] + 1 };
    });
  };
  const removeResourceChoice = (resource: Resource) => {
    if (!busy) setWant(selection => ({ ...selection, [resource]: Math.max(0, selection[resource] - 1) }));
  };
  const tradeDrag = useTradeCardDrag((resource, source, target) => {
    if (busy || !g || !goods.includes(resource as Resource)) return;
    if (isResourceChoice(modal)) {
      if (!RESOURCES.includes(resource as Resource)) return;
      if (source === "palette" && target === "receive") addResourceChoice(resource as Resource);
      else if (source === "receive" && target !== "receive") removeResourceChoice(resource as Resource);
      return;
    }
    if (modal === "discard") {
      if (source === "hand" && target === "give") addDiscardGood(resource);
      else if (source === "give" && (target === "hand" || target === "outside")) removeDiscardGood(resource);
      return;
    }
    if ((modal !== "trade" && modal !== "bank") || source === target) return;
    if (target === "hand" || target === "outside") {
      if (source === "give") setGive({...give, [resource]: Math.max(0, (give[resource] ?? 0) - 1)});
      if (source === "receive") setWant({...want, [resource]: Math.max(0, (want[resource] ?? 0) - 1)});
    } else {
      if (modal === "trade") {
        if (target === "give" && (give[resource] ?? 0) >= (hand[resource] ?? 0)) return;
        if (target === "receive" && (want[resource] ?? 0) >= 50) return;
        // Moving a selected card transfers one card, while adding from the
        // hand or palette leaves the other side's selection intact.
        if (source === "give") setGive(selection => ({...selection, [resource]: Math.max(0, (selection[resource] ?? 0) - 1)}));
        if (source === "receive") setWant(selection => ({...selection, [resource]: Math.max(0, (selection[resource] ?? 0) - 1)}));
      }
      addTradeGood(resource, target === "receive");
    }
  });
  const canPay = (cost: Partial<Hand>) =>
    RESOURCES.every((r) => hand[r] >= (cost[r] ?? 0));
  const legalVertices =
    g && myTurn
      ? g.phase === "setupSettlement"
        ? g.legal.settlement
        : mode === "settlement" && canPay(COSTS.settlement)
          ? g.legal.settlement
          : mode === "city" && canPay(COSTS.city)
            ? g.legal.city
            : []
      : [];
  const legalEdges =
    g && myTurn
      ? mode === "moveShip"
        ? movingShip === null
          ? g.legal.moveShips
          : (g.legal.shipDestinations[movingShip] ?? [])
        : ["setupRoad", "roadBuilding"].includes(g.phase)
          ? mode === "ship"
            ? g.legal.ship
            : g.legal.road
          : mode === "road" && canPay(COSTS.road)
            ? g.legal.road
            : mode === "ship" && canPay(COSTS.ship)
              ? g.legal.ship
              : []
      : [];
  const phaseSeat = !g ? null : g.phase === "finished" ? g.winner
    : g.phase === "discard" ? g.players.findIndex((_, seat) => g.discards[seat] > 0)
    : g.phase === "gold" ? g.players.findIndex((_, seat) => g.goldClaims[seat] > 0)
    : acting;
  const phasePlayer = g && phaseSeat !== null && phaseSeat >= 0 ? g.players[phaseSeat] : null;
  const phaseLabel = !g ? "" : isPaused ? "Game Paused"
    : g.phase === "finished" ? (g.winner !== null ? "Winner" : "Room Closed")
    : g.phase === "setupSettlement" ? (g.cities && g.setupStep >= g.players.length ? "Place City" : "Place Settlement")
    : g.phase === "setupRoad" ? (usesSeafarers(g.mode) ? "Place Road or Ship" : "Place Road")
    : g.phase === "roll" ? "Roll Dice"
    : g.phase === "robber" ? (usesSeafarers(g.mode) ? "Move Robber or Pirate" : "Move Robber")
    : g.phase === "steal" ? "Choose a Player to Steal From"
    : g.phase === "discard" ? (g.discards[me] > 0 ? `Discard ${g.discards[me]} Cards` : "Waiting for Discards")
    : g.phase === "gold" ? "Choose Gold Resources"
    : g.phase === "citiesChoice" && g.cities?.choice ? CHOICE_LABELS[g.cities.choice.kind]
    : g.phase === "roadBuilding" ? `Place ${g.freeRoads} Free Routes`
    : g.phase === "special" ? "Special Building Phase"
    : g.rush ? "Trade and Build · Automatic Rolls" : "Trade and Build";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/?room=${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError(`Copy this invite: ${location.origin}/?room=${code}`);
    }
  };
  const open = (m: Modal) => {
    if (!(modal && ["tradeHub", "trade", "bank"].includes(modal) && m && ["tradeHub", "trade", "bank"].includes(m)))
      dialogOrigin.current = document.activeElement;
    setTradeDraft(null);
    if (m === "trade") setTradeTargets(null);
    setError("");
    setGive(emptyHand());
    setWant(emptyHand());
    setModal(m);
  };
  const nav = (
    <nav className="table-nav">
      <a
        href="/"
        className="logo"
        onClick={(e) => {
          if (matchmakingPage) {
            e.preventDefault();
            void leaveMatchmaking("/");
          }
        }}
      >
        <img src={ASSETS.logo} alt="Isletop" />
      </a>
      <button
        aria-label="Rooms"
        title="Rooms"
        className={
          !historyPage &&
          !accountPage &&
          !matchmakingPage &&
          !botSetupPage &&
          !leaderboardPage &&
          (!g || g.phase === "lobby")
            ? "selected"
            : ""
        }
        onClick={() => {
          setRoomView("open");
          if (matchmakingPage) void leaveMatchmaking("/");
          else if (historyPage || accountPage || leaderboardPage || createRoomPage || botSetupPage) location.assign("/");
          else if (g) open("leave");
          else setModal(null);
        }}
      >
        <img src={ASSETS.icon_profile_friends} alt="" />
        Rooms
      </button>
      <button
        aria-label="Play"
        title="Play"
        className={
          matchmakingPage || botSetupPage || (g && g.phase !== "lobby") ? "selected" : ""
        }
        onClick={() => {
          if (matchmakingPage) {
            void leaveMatchmaking("/?play=1");
            return;
          }
          if (historyPage || accountPage || leaderboardPage || createRoomPage || botSetupPage) {
            location.assign("/?play=1");
            return;
          }
          if (!g && !matchmakingPage) location.assign("/?play=1");
        }}
      >
        <img src={ASSETS.logo_mobile} alt="" />
        Play
      </button>
      <button
        aria-label="Rules"
        title="Rules"
        onClick={() =>
          historyPage || accountPage || leaderboardPage
            ? location.assign("/?rules=1")
            : open("rules")
        }
      >
        <img src={ASSETS.icon_more} alt="" />
        Rules
      </button>
      <button
        aria-label="History"
        title="History"
        onClick={() =>
          matchmakingPage
            ? void leaveMatchmaking("/?history=1")
            : location.assign("/?history=1")
        }
        className={historyPage ? "selected" : ""}
      >
        <img src={ASSETS.icon_playtime} alt="" />
        History
      </button>
      <button
        aria-label={account ? "Profile" : "Account"}
        title={account ? "Profile" : "Account"}
        onClick={() =>
          matchmakingPage
            ? void leaveMatchmaking("/?account=1")
            : location.assign("/?account=1")
        }
        className={accountPage ? "selected" : ""}
      >
        <img src={ASSETS.icon_profile_friends} alt="" />
        {account ? "Profile" : "Account"}
      </button>
      <SocialPanel
        account={account}
        code={g && g.me >= 0 && g.phase !== "finished" ? code : undefined}
        canInvite={g?.phase === "lobby" && g.players.length < g.capacity}
        open={socialOpen}
        onOpen={setSocialOpen}
        target={socialTarget}
      />
    </nav>
  );
  const errors = (
    <>
      {error && (
        <div className="error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {connection && (
        <div className="error" role="status">
          <span>{connection}</span>
          <button onClick={() => void load(code)}>Reconnect Now</button>
        </div>
      )}
    </>
  );
  const leader = g ? publicLeader(g) : null;
  const players = g && (
    <div className="players-list">
      {seatsInTurnOrder(g).map((i) => {
        const p = g.players[i];
        const visibleScore = g.phase === "finished" ? p.score : p.publicScore;
        const showPrivateTotal = i === me && p.score > visibleScore;
        const scoreDescription = showPrivateTotal
          ? `${visibleScore} public victory points, ${p.score} total including hidden victory points`
          : `${visibleScore} victory points`;
        return (
        <div
          className={`player ${i === me ? "self-player" : ""} ${(g.rush && !g.phase.startsWith("setup") ? g.rush.robberOwner === i : acting === i) && g.phase !== "lobby" ? "active-player" : ""}`}
          data-player-seat={i}
          data-bot-controlled={p.bot || g.botPlayers.includes(i)}
          style={{ borderLeftColor: COLORS[p.color] }}
          key={i}
        >
          <div className="avatar" style={{ background: COLORS[p.color] }}>
            {leader === i && (
              <img
                className="leader-crown"
                src={ASSETS.icon_crown_leader}
                alt="Public victory point leader"
                title="Leading in public victory points"
              />
            )}
            <img src={p.bot || g.botPlayers.includes(i) ? botAvatarAsset(p.color) : avatarAsset(p.avatar)} alt={p.bot || g.botPlayers.includes(i) ? "Bot avatar" : ""} />
            {i === me && g.specialRequested && (
              <img
                className="special-build-marker"
                src={ASSETS.icon_special_build_phase_flag}
                alt="Special building requested"
              />
            )}
          </div>
          <div className="player-info">
            <strong title={p.name}>
              {p.name}
              {i === me ? " (you)" : ""}
              {g.rush?.nextRobber === i && (
                <img
                  src={ASSETS.icon_robber}
                  alt="Next robber"
                  title="Moves the robber on the next seven"
                  style={{
                    width: 16,
                    height: 20,
                    display: "inline-block",
                    marginLeft: 6,
                  }}
                />
              )}
            </strong>
            <div className={`player-stats${g.cities ? " cities-stats" : ""}`}>
              {g.phase === "lobby" ? (
                i === 0 ? (
                  "Host"
                ) : p.ready ? (
                  "Ready"
                ) : (
                  "Not ready"
                )
              ) : (
                <>
                  <span className={`player-score${showPrivateTotal ? " has-private-score" : ""}`} title={scoreDescription} aria-label={scoreDescription}>
                    ★ <b>{visibleScore}{showPrivateTotal && ` (${p.score})`}</b>
                  </span>{" "}
                  <span
                    className="player-card-count"
                    aria-label={`${p.resources} resource cards${g.cities ? " and commodities" : ""}`}
                    title={
                      g.cities ? "Resources and commodities" : "Resource cards"
                    }
                  >
                    <Image src={ASSETS.card_rescardback} alt="" width={16} height={22} /><b>{p.resources}</b>
                  </span>{" "}
                  <span
                    className="player-card-count"
                    aria-label={`${g.cities ? g.cities.players[i].progressCount : p.development} ${g.cities ? "progress" : "development"} cards`}
                    title={g.cities ? "Progress cards" : "Development cards"}
                  >
                    <Image src={g.cities ? CITIES_ASSETS.card_progress_science_back : ASSETS.card_devcardback} alt="" width={16} height={22} />
                    <b>{g.cities
                      ? g.cities.players[i].progressCount
                      : p.development}</b>
                  </span>{" "}
                  <span
                    className="player-route-stat"
                    title={
                      g.cities ? "Active knight strength" : "Played knights"
                    }
                  >
                    <svg
                      className={g.army === i ? "award-holder-icon" : undefined}
                      width={24}
                      height={24}
                      viewBox="24 10 52 76"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M30 23 50 15l20 8v30Q64 72 50 82 34 71 30 53Z" />
                      <path d="M50 26v39m-10-24h20" />
                    </svg><b>{g.cities
                      ? g.cities.knights
                          .filter((k) => k.owner === i && k.active)
                          .reduce((n, k) => n + k.level, 0)
                      : p.knights}</b>
                  </span>
                  <span className="player-route-stat" title={g.mode.startsWith("seafarers") ? "Longest trade route length" : "Longest road length"} aria-label={`${p.roadLength} connected route segments`}>
                    <Route className={g.longest === i ? "award-holder-icon" : undefined} size={24} aria-hidden="true" /><b>{p.roadLength}</b>
                  </span>
                  {g.cities && (
                    <span title="Island Defender points">
                      {" "}
                      ⚔ {g.cities.players[i].defenders}
                    </span>
                  )}
                </>
              )}
            </div>
            {g.cities && g.phase !== "lobby" && (
              <div
                className="cities-player-tracks"
                aria-label={`${p.name}'s city improvements`}
              >
                {TRACKS.map((track) => (
                  <span
                    key={track}
                    title={`${track[0].toUpperCase() + track.slice(1)} level ${g.cities!.players[i].improvements[track]}`}
                  >
                    <img
                      src={goodImage(TRACK_COMMODITY[track])}
                      alt={track[0].toUpperCase() + track.slice(1)}
                    />
                    {g.cities!.players[i].improvements[track]}
                  </span>
                ))}
              </div>
            )}
            {me >= 0 &&
              i !== me &&
              !["lobby", "finished"].includes(g.phase) && (
                <div className="player-trade-block">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${g.players[me].embargoes.includes(i) ? "Unblock" : "Block"} trades with ${p.name}`}
                    disabled={busy}
                    onClick={() =>
                      send({
                        type: "embargo",
                        to: i,
                        blocked: !g.players[me].embargoes.includes(i),
                      })
                    }
                  >
                    {g.players[me].embargoes.includes(i)
                      ? "Unblock Trades"
                      : "Block Trades"}
                  </Button>
                  {p.embargoes.includes(me) && <span>Blocks your trades</span>}
                </div>
              )}
          </div>
          {g.phase === "lobby" && me === 0 && i > 0 && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${p.name}`}
              disabled={busy}
              onClick={() => send({ type: "remove", id: i })}
            >
              ×
            </Button>
          )}

        </div>
        );
      })}
    </div>
  );
  if (accountPage)
    return (
      <div className="app-shell">
        {nav}
        <main className="app-main" tabIndex={-1}>
          <AccountPage
            username={profileUsername || undefined}
            viewerUsername={account?.username}
            onAccount={updateAccount}
            guestName={name}
            onGuestName={nickname => {
              setName(nickname);
              localStorage.setItem("island_name", nickname);
            }}
            onFriends={(username) => {
              setSocialTarget(username);
              setSocialOpen(true);
            }}
          />
        </main>
      </div>
    );
  if (leaderboardPage)
    return (
      <div className="app-shell">
        {nav}
        <main className="app-main" tabIndex={-1}>
          <LeaderboardPage account={account} />
        </main>
      </div>
    );
  if (historyPage)
    return (
      <div className="app-shell">
        {nav}
        <main className="app-main" tabIndex={-1}>
          {replayMatch || replayShare ? (
            <MatchReplay
              match={replayMatch || undefined}
              share={replayShare || undefined}
              onClose={() => location.assign("/?history=1")}
            />
          ) : (
            <MatchHistory
              initialMatch={historyMatch}
              onClose={() => location.assign("/")}
            />
          )}
        </main>
      </div>
    );
  return (
    <div className={`app-shell ${g && g.phase !== "lobby" ? "playing-table" : ""}`}>
      {nav}
      <main className="app-main" tabIndex={-1}>
        <header className="table-top">
          <strong>
            {g
              ? `${g.mode === "solo" ? "Solo Practice · " : ""}Room ${code}`
              : botSetupPage
                ? "Play with Bots"
              : createRoomPage
                ? "Create Room"
                : matchmakingPage
                ? "Play"
                : "Rooms"}
          </strong>
          <div>
            {g && g.phase !== "lobby" && (
              <div className="zoom-controls" role="group" aria-label="Board zoom">
                <Button size="sm" variant="ghost" aria-label="Zoom out"
                  onClick={() => boardNavigation.current?.zoomBy(-0.25)}>
                  −
                </Button>
                <Button size="sm" variant="ghost" aria-label="Zoom in"
                  onClick={() => boardNavigation.current?.zoomBy(0.25)}>
                  +
                </Button>
                <Button size="sm" variant="ghost" aria-label="Fit board"
                  onClick={() => boardNavigation.current?.fit()}>
                  Fit
                </Button>
              </div>
            )}
            {g && (
              <span className="header-invite">
                <Button size="sm" variant="ghost" onClick={copy}
                  aria-label="Copy spectator link" title={copied ? "Copied!" : "Copy a link to spectate this room"}>
                  <Copy size={16} aria-hidden="true" />
                  <span className="header-invite-label" aria-live="polite">{copied ? "Copied!" : "Copy Invite"}</span>
                </Button>
              </span>
            )}
            {g && g.me === 0 && isBotPracticeGame(g) && !["lobby", "finished"].includes(g.phase) && (
              <span className="header-bot-speed">
                <Button size="sm" variant="ghost" disabled={busy}
                  aria-label="Fast Forward" aria-pressed={g.botFastForward}
                  title={g.botFastForward ? "Fast Forward on · click for normal bot speed" : "Fast Forward · speed up bot decisions"}
                  onClick={() => send({ type: "botSpeed", enabled: !g.botFastForward })}>
                  <FastForward size={16} aria-hidden="true" />
                  <span className="header-bot-speed-label">Fast Forward</span>
                </Button>
              </span>
            )}
            {g && (
              <Spectators
                code={g.code}
                created={g.created}
                me={g.me}
                account={account}
              />
            )}
            <Button
              variant="ghost"
              onClick={() => {
                const destination = account
                  ? `/?account=1${g ? `&returnRoom=${code}` : ""}`
                  : `/?account=1${g ? `&returnRoom=${code}` : ""}`;
                if (matchmakingPage) void leaveMatchmaking(destination);
                else location.assign(destination);
              }}
            >
              {account ? account.displayName : "Sign In"}
            </Button>
            {g && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => sound.setMuted(!sound.muted)}
                  aria-label={sound.muted ? "Unmute sounds" : "Mute sounds"}
                  aria-pressed={sound.muted}
                  title={sound.shortcuts ? "Mute sounds (M)" : "Mute sounds"}
                >
                  <img
                    width="22"
                    height="22"
                    alt=""
                    src={
                      sound.muted
                        ? "/art/icon_sound_off.svg"
                        : "/art/icon_sound_on.svg"
                    }
                  />
                </Button>
                <Button
                  variant="ghost"
                  disabled={!controls.fullscreenSupported}
                  aria-label={
                    controls.fullscreen ? "Exit fullscreen" : "Enter fullscreen"
                  }
                  aria-pressed={controls.fullscreen}
                  title={`${controls.fullscreen ? "Exit" : "Enter"} fullscreen${sound.shortcuts ? " (F)" : ""}`}
                  onClick={() => void controls.toggleFullscreen()}
                >
                  <img
                    width="22"
                    height="22"
                    alt=""
                    src={
                      controls.fullscreen
                        ? ASSETS.icon_fullscreen_contract
                        : ASSETS.icon_fullscreen_expand
                    }
                  />
                </Button>
                {g.phase === "lobby" && (
                  <Button variant="ghost" onClick={() => open("preferences")}>
                    Settings
                  </Button>
                )}
                {g.me >= 0 &&
                  !["lobby", "finished"].includes(g.phase) &&
                  !isPaused && (
                    <Button
                      variant="ghost"
                      disabled={interactionBusy || !!g.pause.vote}
                      title={
                        sound.shortcuts ? "Request Pause (P)" : "Request Pause"
                      }
                      aria-keyshortcuts={sound.shortcuts ? "P" : undefined}
                      onClick={() => send({ type: "pauseRequest" })}
                    >
                      Pause
                    </Button>
                  )}
                <Button variant="ghost" onClick={() => open("leave")}>
                  Exit
                </Button>
              </>
            )}
          </div>
        </header>
        {errors}
        {g && <RankedStatus game={g} />}
        {g && <TablePause game={g} busy={interactionBusy} send={send} />}
        {!g && !code && createRoomPage ? (
          <CreateRoomPage account={account} name={name} onName={setName} busy={busy} onCreate={create} />
        ) : !g && !code && (matchmakingPage || botSetupPage) ? (
          <MatchmakingPage
            key={account?.username ?? "guest"}
            account={account}
            name={name}
            onName={setName}
            botPractice={botSetupPage}
            onTicket={setMatchmakingTicket}
            onLeave={(url) => void leaveMatchmaking(url)}
          />
        ) : !g && !code ? (
          <section className="rooms-page">
            <section id="room-list" aria-label={roomView === "open" ? "Open rooms" : "Live rooms to spectate"}>
              {roomView === "open" ? <>
                <div className="rooms-table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mode</TableHead>
                        <TableHead>Map</TableHead>
                        <TableHead>Turn Timer</TableHead>
                        <TableHead>Host</TableHead>
                        <TableHead>Players</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rooms.map((r) => (
                        <TableRow key={r.code}>
                          <TableCell>
                            {r.mode === "seafarersCitiesKnights" && (
                              <img
                                src={combinedModeImage(r.boardPlayers)}
                                alt=""
                                width={24}
                                height={24}
                                style={{
                                  display: "inline",
                                  verticalAlign: "middle",
                                  marginRight: 6,
                                }}
                              />
                            )}
                            {r.mode === "solo"
                              ? "Solo Practice"
                              : r.mode === "rush"
                                ? "Rapid Play"
                                : r.mode === "seafarersCitiesKnights"
                                  ? "Voyages + Cities & Defenders"
                                  : usesCitiesKnights(r.mode)
                                    ? "Cities & Defenders"
                                    : usesSeafarers(r.mode)
                                      ? "Voyages"
                                      : "Base"}{" "}
                            {r.mode === "duel"
                              ? "1v1"
                              : usesSeafarers(r.mode)
                                ? scenarioName(
                                    r.scenario ?? "newShores",
                                    r.boardPlayers,
                                  )
                                : r.boardPlayers > 4
                                  ? `${r.boardPlayers <= 6 ? "5–6" : "7–8"} Player`
                                  : ""}
                          </TableCell>
                          <TableCell>
                            {usesSeafarers(r.mode)
                              ? scenarioName(
                                  r.scenario ?? "newShores",
                                  r.boardPlayers,
                                )
                              : baseMapName(r.map)}
                          </TableCell>
                          <TableCell>
                            {r.turnSeconds ? `${r.turnSeconds}s` : "Unlimited"}
                          </TableCell>
                          <TableCell>{r.title}</TableCell>
                          <TableCell>
                            {r.players}/{r.capacity}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              onClick={() => {
                                setJoinCode(r.code);
                                open("join");
                              }}
                            >
                              Join
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!rooms.length && (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <div className="empty-rooms">
                              <img src={ASSETS.icon_profile_friends} alt="" />
                              <h2>No open rooms yet</h2>
                              <p>
                                Create a room and invite your friends to play.
                              </p>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </> : <>
                <div className="room-table-scroll">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mode</TableHead>
                        <TableHead>Room</TableHead>
                        <TableHead>Map</TableHead>
                        <TableHead>Players</TableHead>
                        <TableHead>Turn</TableHead>
                        <TableHead>
                          <span className="sr-only">Watch</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {games.map((room) => (
                        <TableRow key={room.code}>
                          <TableCell>
                            {room.mode === "seafarersCitiesKnights" && (
                              <img
                                src={combinedModeImage(room.boardPlayers)}
                                alt=""
                                width={24}
                                height={24}
                                style={{
                                  display: "inline",
                                  verticalAlign: "middle",
                                  marginRight: 6,
                                }}
                              />
                            )}
                            {room.mode === "solo"
                              ? "Solo Practice"
                              : room.mode === "rush"
                                ? "Rapid Play"
                                : room.mode === "seafarersCitiesKnights"
                                  ? "Voyages + Cities & Defenders"
                                  : usesCitiesKnights(room.mode)
                                    ? "Cities & Defenders"
                                    : usesSeafarers(room.mode)
                                      ? "Voyages"
                                      : "Base"}{" "}
                            {room.mode === "duel"
                              ? "1v1"
                              : usesSeafarers(room.mode)
                                ? scenarioName(
                                    room.scenario ?? "newShores",
                                    room.boardPlayers,
                                  )
                                : room.boardPlayers > 4
                                  ? `${room.boardPlayers <= 6 ? "5–6" : "7–8"} Player`
                                  : ""}
                          </TableCell>
                          <TableCell>{room.title}</TableCell>
                          <TableCell>
                            {usesSeafarers(room.mode)
                              ? scenarioName(
                                  room.scenario ?? "newShores",
                                  room.boardPlayers,
                                )
                              : baseMapName(room.map)}
                          </TableCell>
                          <TableCell>
                            {room.players}/{room.capacity}
                          </TableCell>
                          <TableCell>{room.turn}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              onClick={() => {
                                currentCode.current = room.code;
                                setCode(room.code);
                                history.replaceState(
                                  null,
                                  "",
                                  `/?room=${room.code}`,
                                );
                              }}
                            >
                              Watch
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!games.length && (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <div className="empty-rooms">
                              <h2>No live public games</h2>
                              <p>Started public rooms will appear here.</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </>}
            </section>
            <div className="room-buttons">
              <Button asChild className="green-button">
                <a href="/create">Create Room</a>
              </Button>
              <Button className="orange-button" onClick={() => open("join")}>
                Join Room
              </Button>
              <Button variant="secondary" aria-pressed={roomView === "spectate"} aria-controls="room-list" onClick={() => setRoomView(roomView === "open" ? "spectate" : "open")}>
                Spectate Room
              </Button>
            </div>

          </section>
        ) : !g ? (
          <div className="loading-state">
            Connecting to room {code}…{" "}
            <Button
              onClick={() => {
                currentCode.current = "";
                setCode("");
                history.replaceState(null, "", "/");
              }}
            >
              Back to Rooms
            </Button>
          </div>
        ) : g.phase === "lobby" ? (
          <div className="lobby-layout">
            <section className="panel lobby-players">
              <h2>
                Players ({g.players.length}/{g.capacity})
              </h2>
              {players}
              {me >= 0 && (
                <form
                  className="chat-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await send({ type: "nickname", text: nickname })) {
                      setName(nickname);
                      localStorage.setItem("island_name", nickname);
                    }
                  }}
                >
                  <Input
                    aria-label="Change your name"
                    value={nickname}
                    maxLength={24}
                    onChange={(e) => setNickname(e.target.value)}
                  />
                  <Button
                    type="submit"
                    disabled={
                      busy || !nickname.trim() || nickname === self?.name
                    }
                  >
                    Save
                  </Button>
                </form>
              )}
              {Array.from({ length: g.capacity - g.players.length }, (_, i) => (
                <div key={i} className="empty-seat">
                  <img src={ASSETS.icon_player} alt="" />
                  Waiting for player…
                </div>
              ))}
            </section>
            <section className="panel lobby-center">
              <div className="invite">
                <h2>Invite Friends</h2>
                <div className="invite-actions">
                  <Input
                    aria-label="Invite link"
                    value={
                      typeof location === "undefined"
                        ? code
                        : `${location.origin}/?room=${code}`
                    }
                    readOnly
                  />
                  <div className="invite-buttons">
                    <Button onClick={copy}>{copied ? "Copied!" : "Copy"}</Button>
                    <Button
                      onClick={() => {
                        setSocialTarget("");
                        setSocialOpen(true);
                      }}
                    >
                      Invite from Friends List
                    </Button>
                  </div>
                </div>
              </div>
              <div className="lobby-board">
                <IslandBoard board={board} />
              </div>
              <details className="room-settings" key={g.code}>
                <summary>Room Settings</summary>
                <div className="room-settings-fields">
              {me === 0 && (
                <form
                  className="settings-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send({ type: "settings", text: roomTitle });
                  }}
                >
                  <Input
                    aria-label="Room name"
                    value={roomTitle}
                    maxLength={40}
                    onChange={(e) => setRoomTitle(e.target.value)}
                  />
                  <Button
                    type="submit"
                    disabled={
                      busy || !roomTitle.trim() || roomTitle === g.title
                    }
                  >
                    Rename
                  </Button>
                </form>
              )}
              <div className="settings-row">
                <span>Game Mode</span>
                <NativeSelect
                  aria-label="Game mode"
                  value={g.mode}
                  disabled={busy || me !== 0}
                  onChange={(e) =>
                    send({
                      type: "settings",
                      mode: e.target.value as GameMode,
                      capacity:
                        e.target.value === "solo"
                          ? 1
                          : e.target.value === "duel"
                            ? 2
                            : Math.max(4, g.players.length),
                    })
                  }
                >
                  <option value="base">Base</option>
                  <option value="solo" disabled={g.players.length > 1}>
                    Solo Practice
                  </option>
                  <option value="rush">Rapid Play</option>
                  <option value="duel" disabled={g.players.length > 2}>
                    1v1
                  </option>
                  <option value="seafarers" disabled={g.players.length > 6}>
                    Voyages
                  </option>
                  <option
                    value="seafarersCitiesKnights"
                    disabled={g.players.length > 6}
                  >
                    Voyages + Cities & Defenders
                  </option>
                  <option value="citiesKnights" disabled={g.players.length > 6}>
                    Cities & Defenders
                  </option>
                </NativeSelect>
              </div>
              <div className="settings-row">
                <span>Map</span>
                {usesSeafarers(g.mode) ? (
                  <NativeSelect
                    aria-label="Voyages scenario"
                    value={g.scenario}
                    disabled={busy || me !== 0}
                    onChange={(e) =>
                      send({
                        type: "settings",
                        scenario: e.target.value as SeafarersScenario,
                      })
                    }
                  >
                    {SEAFARERS_SCENARIOS.map((s) => (
                      <option key={s} value={s}>
                        {scenarioName(s, g.boardPlayers)}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <NativeSelect
                    aria-label="Base map"
                    value={g.map}
                    disabled={busy || me !== 0}
                    onChange={(e) =>
                      send({ type: "settings", map: e.target.value as BaseMap })
                    }
                  >
                    {BASE_MAPS.filter((map) =>
                      baseMapAvailable(map, g.mode, g.capacity),
                    ).map((map) => (
                      <option key={map} value={map}>
                        {baseMapName(map)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </div>
              <div className="settings-row">
                <span>Max Players</span>
                <NativeSelect
                  aria-label="Maximum players"
                  value={g.capacity}
                  disabled={busy || me !== 0}
                  onChange={(e) =>
                    send({ type: "settings", capacity: Number(e.target.value) })
                  }
                >
                  {roomCapacities(g.mode).map((n) => (
                    <option key={n} value={n} disabled={n < g.players.length}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="settings-row">
                <span>Victory Points</span>
                {me === 0 ? (
                  <NativeSelect
                    aria-label="Victory point target"
                    value={g.target}
                    disabled={busy}
                    onChange={(e) =>
                      send({ type: "settings", target: Number(e.target.value) })
                    }
                  >
                    {Array.from({ length: 18 }, (_, i) => i + 3).map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </NativeSelect>
                ) : (
                  <strong>{g.target}</strong>
                )}
              </div>
              <div className="settings-row">
                <span>Dice</span>
                <NativeSelect
                  aria-label="Dice mode"
                  value={g.diceMode}
                  disabled={busy || me !== 0}
                  onChange={(e) =>
                    send({
                      type: "settings",
                      diceMode: e.target.value as "random" | "balanced",
                    })
                  }
                >
                  <option value="random">Random</option>
                  <option value="balanced">Balanced</option>
                </NativeSelect>
              </div>
              <div className="settings-row">
                {g.mode === "rush" ? <><span>Dice Roll Interval</span>
                <NativeSelect
                  aria-label="Dice roll interval"
                  value={g.turnSeconds}
                  disabled={busy || me !== 0}
                  onChange={(e) =>
                    send({
                      type: "settings",
                      turnSeconds: Number(e.target.value),
                    })
                  }
                >
                  {RUSH_SPEEDS.map((n) => (
                    <option key={n} value={n}>
                      {n ? `${n}s` : "Unlimited"}
                    </option>
                  ))}
                </NativeSelect>
                </> : <TurnTimerControl value={g.turnSeconds} disabled={busy || me !== 0}
                  onChange={seconds => send({ type: "settings", turnSeconds: seconds })} />}
              </div>
              <div className="settings-row">
                <span>Card Discard Limit</span>
                <NativeSelect
                  aria-label="Card discard limit"
                  value={g.discardLimit}
                  disabled={busy || me !== 0}
                  onChange={(e) =>
                    send({
                      type: "settings",
                      discardLimit: Number(e.target.value),
                    })
                  }
                >
                  {Array.from({ length: 16 }, (_, i) => i + 5).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="settings-row">
                <span>Friendly Robber</span>
                <Switch
                  aria-label="Friendly robber"
                  checked={g.friendlyRobber}
                  disabled={busy || me !== 0}
                  onCheckedChange={(friendlyRobber) =>
                    send({ type: "settings", friendlyRobber })
                  }
                />
              </div>
              <div className="settings-row">
                <span>Hide Bank Cards</span>
                <Switch
                  aria-label="Hide bank cards"
                  checked={g.hideBank}
                  disabled={busy || me !== 0}
                  onCheckedChange={(hideBank) =>
                    send({ type: "settings", hideBank })
                  }
                />
              </div>
              {me >= 0 && (
                <div className="settings-row">
                  <span>Your Color</span>
                  <NativeSelect
                    aria-label="Your color"
                    value={self!.color}
                    disabled={busy}
                    onChange={(e) =>
                      send({ type: "color", color: Number(e.target.value) })
                    }
                  >
                    {PLAYER_COLORS.map((color, i) => (
                      <option
                        key={color}
                        value={i}
                        disabled={g.players.some(
                          (seat, n) => n !== me && seat.color === i,
                        )}
                      >
                        {color[0].toUpperCase() + color.slice(1)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              <div className="settings-row">
                <span>List in Open Rooms</span>
                <Switch
                  checked={g.public}
                  disabled={me !== 0 || busy}
                  aria-label="List room publicly"
                  onCheckedChange={(v) => send({ type: "settings", public: v })}
                />
              </div>
                </div>
              </details>
              {me >= 0 ? (
                <div className="room-buttons">
                  {me === 0 &&
                    g.mode !== "solo" &&
                    !g.matchmaking &&
                    !g.ranked && (
                      <Button
                        variant="secondary"
                        disabled={busy || g.players.length >= g.capacity}
                        onClick={() => send({ type: "addBot" })}
                      >
                        Add Bot
                      </Button>
                    )}
                  <Button
                    disabled={busy}
                    variant={self?.ready ? "secondary" : "default"}
                    onClick={() => send({ type: "ready" })}
                  >
                    {self?.ready ? "Ready ✓" : "I’m Ready"}
                  </Button>
                  {me === 0 && (
                    <Button
                      className="green-button"
                      disabled={
                        busy ||
                        g.players.length < minimumPlayers(g.mode, g.capacity) ||
                        !g.players.every((p, i) => i === 0 || p.ready)
                      }
                      onClick={() => send({ type: "start" })}
                    >
                      Start Game
                    </Button>
                  )}
                </div>
              ) : (
                <div className="join-inline">
                  <Input
                    aria-label="Your name"
                    placeholder="Your name"
                    value={name}
                    maxLength={24}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Button
                    className="green-button"
                    onClick={() => join(code)}
                    disabled={busy || g.players.length >= g.capacity}
                  >
                    Join Room
                  </Button>
                </div>
              )}
              <p className="muted">
                {g.mode === "solo"
                  ? "Solo practice with no bots. Bank and port trades are available."
                  : g.players.length < minimumPlayers(g.mode, g.capacity)
                    ? g.mode === "duel"
                      ? "Two players are needed for 1v1."
                      : `At least ${minimumPlayers(g.mode, g.capacity)} players are needed to start.`
                    : g.boardPlayers > 4
                      ? "Special building phase enabled."
                      : "All players must be ready before starting."}
              </p>
            </section>
            <section className="panel lobby-chat">
              <h2>Room Chat</h2>
              <Chat g={g} send={send} busy={interactionBusy} />
            </section>
          </div>
        ) : (
          <div className="game-layout" data-player-count={g.players.length} data-many-players={g.players.length > 6} data-cities={Boolean(g.cities)}>
            <section className="game-board-column">
              <div className="board-stage">
              {presentation.feedback && <ResourceDelivery key={`${g.code}:${g.created}:${presentation.feedback.sequence}`} game={g} feedback={presentation.feedback} />}
              {presentation.cardEvents.map(event => <CardExchange key={`${g.code}:${g.created}:cards:${event.sequence}`} feedback={event} me={g.me} />)}
              <BoardViewport
                ref={boardNavigation}
                showControls={false}
                className="board-scroll"
                key={`${g.code}:${g.created}`}
              >
                <IslandBoard
                  board={board}
                  cities={g.cities}
                  vertexLabel={
                    g.cities &&
                    g.phase === "setupSettlement" &&
                    g.setupStep >= g.players.length
                      ? "Build city at"
                      : undefined
                  }
                  playerColors={g.players.map((p) => p.color)}
                  legalTiles={[...g.legal.robber, ...g.legal.pirate]}
                  selected={
                    pending?.type === "moveShip"
                      ? { ...pending, id: pending.to ?? undefined }
                      : pending
                  }
                  legalVertices={busy ? [] : legalVertices}
                  legalEdges={busy ? [] : legalEdges}
                  edgeLabel={
                    mode === "moveShip"
                      ? movingShip === null
                        ? "Select ship"
                        : "Move ship to"
                      : mode === "ship"
                        ? "Build ship"
                        : "Build road"
                  }
                  robberMode={!busy && myTurn && g.phase === "robber"}
                  onVertex={(id, target) => {
                    place({
                      type:
                        g.phase === "setupSettlement" || mode === "settlement"
                          ? "settlement"
                          : "city",
                      id,
                    }, target);
                  }}
                  onEdge={(id, target) => {
                    if (mode === "moveShip") {
                      if (movingShip === null) setMovingShip(id);
                      else place({ type: "moveShip", id: movingShip, to: id }, target);
                    } else
                      place({ type: mode === "ship" ? "ship" : "road", id }, target);
                  }}
                  onTile={(id, target) => {
                    if (myTurn && g.phase === "robber")
                      place({
                        type:
                          board.tiles[id].resource === "sea"
                            ? "pirate"
                            : "robber",
                        id,
                      }, target);
                  }}
                />
              </BoardViewport>
              {pending && (
                <Popover open modal={false} onOpenChange={(value) => { if (!value && !busy) cancelPlacement(); }}>
                <PopoverAnchor virtualRef={placementAnchor} />
                <PopoverContent className="placement-confirmation board-placement-confirmation" aria-label="Confirm placement"
                  side={isMobile ? "top" : "right"} sideOffset={10} collisionPadding={12} updatePositionStrategy="always"
                  onInteractOutside={(event) => event.preventDefault()}
                  onOpenAutoFocus={(event) => { event.preventDefault(); placementConfirm.current?.focus(); }}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  onEscapeKeyDown={(event) => { event.preventDefault(); if (!busy) cancelPlacement(); }}>
                  <span>
                    {pending.type === "moveShip"
                      ? "Move ship here?"
                      : pending.type === "pirate"
                        ? "Move pirate here?"
                        : pending.type === "robber"
                          ? "Move robber here?"
                          : `Build ${pending.type} here?`}
                  </span>
                  <Button
                    ref={placementConfirm}
                    className="green-button"
                    disabled={busy}
                    onClick={async () => {
                      // Saving removes legal hit targets. Keep the last board position
                      // until the request finishes instead of measuring a detached SVG.
                      placementAnchor.current?.freeze();
                      if (await send(pending)) {
                        setPending(null);
                        setMode(null);
                        setMovingShip(null);
                        boardNavigation.current?.focus();
                      }
                    }}
                  >
                    Confirm Placement
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={cancelPlacement}
                  >
                    Cancel
                  </Button>
                </PopoverContent>
                </Popover>
              )}
                  {mode && !pending && (
                    <div className="build-hint" role="status">
                      <span>
                      Select a highlighted{" "}
                      {mode === "moveShip"
                        ? movingShip === null
                          ? "ship to move"
                          : "destination edge"
                        : ["road", "ship"].includes(mode)
                          ? "edge"
                          : "intersection"}{" "}
                      on the board.</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setMode(null);
                          setMovingShip(null);
                          setPending(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
              </div>
              {g.phase === "finished" && g.winner !== null && (
                <div className="winner">
                  <h2>{g.players[g.winner].name} wins!</h2>
                  <p>
                    {g.resignedBy !== null
                      ? `${g.players[g.resignedBy].name} resigned`
                      : `${g.players[g.winner].score} victory points`}{" "}
                    · {g.turn} turns
                  </p>
                  {me === 0 && (
                    <Button
                      className="green-button"
                      disabled={busy}
                      onClick={() => api({ op: "rematch", code })}
                    >
                      Play Again
                    </Button>
                  )}
                  <Button onClick={() => open("stats")}>Game Results</Button>
                </div>
              )}
              <section className="panel game-turn-panel">
                <TableDice game={g} lastDice={presentation.dice} animationKey={presentation.rollKey} pending={rollingRequest}
                  canRoll={myTurn && g.phase === "roll" && !busy}
                  onRoll={() => send({ type: "roll" })} />
                <div className="game-turn-row">
                  <div className="phase-update" data-phase={g.phase} role="status" aria-label="Current phase">
                    {phasePlayer && <span className="phase-avatar" style={{ background: COLORS[phasePlayer.color] }}><img src={phasePlayer.bot || (phaseSeat !== null && g.botPlayers.includes(phaseSeat)) ? botAvatarAsset(phasePlayer.color) : avatarAsset(phasePlayer.avatar)} alt="" /></span>}
                    <span>{phasePlayer && <strong title={phasePlayer.name} style={{ color: phasePlayer.color === 3 ? "#637078" : COLORS[phasePlayer.color] }}>{phasePlayer.name}</strong>}<span className="phase-label">{phaseLabel}</span></span>
                  </div>
                {g.deadline !== null && (
                  <TurnTimer
                    deadline={g.deadline}
                    offset={clockOffset}
                    pausedAt={g.pause.pausedAt}
                  />
                )}
                <div className="turn-controls">
                  {me >= 0 &&
                    g.boardPlayers > 4 &&
                    !g.rush &&
                    g.turn > 0 &&
                    g.phase !== "finished" && (
                      <Button
                        className="special-build-button"
                        variant={g.specialRequested ? "default" : "secondary"}
                        aria-label={g.specialRequested ? "Withdraw special building request" : "Request Special Build"}
                        aria-pressed={g.specialRequested}
                        title={
                          g.specialRequested
                            ? "Withdraw special building request"
                            : "Request a special building phase after another player's turn"
                        }
                        disabled={busy || g.turn === 0}
                        onClick={() =>
                          send({
                            type: "specialBuild",
                            requested: !g.specialRequested,
                          })
                        }
                      >
                        <img
                          src={ASSETS.icon_special_build_phase_flag}
                          alt=""
                          width={24}
                          height={24}
                        />
                        {g.specialRequested
                          ? "Withdraw"
                          : "Special Build"}
                      </Button>
                    )}
                  {myTurn && g.phase === "roll" && (
                    <Button
                      className="green-button"
                      disabled={busy}
                      aria-keyshortcuts={sound.shortcuts ? "Space" : undefined}
                      title={
                        sound.shortcuts ? "Roll Dice (Space)" : "Roll Dice"
                      }
                      onClick={() => send({ type: "roll" })}
                    >
                      Roll Dice
                    </Button>
                  )}
                  {g.discards[me] > 0 && (
                    <Button disabled={busy} onClick={() => open("discard")}>
                      Discard {g.discards[me]} Cards
                    </Button>
                  )}
                  {g.phase === "gold" && g.goldClaims[me] > 0 && (
                    <Button disabled={busy} onClick={() => open("gold")}>
                      Choose {g.goldAmount} Gold Resources
                    </Button>
                  )}
                  {myTurn &&
                    g.phase === "steal" &&
                    g.victims.map((id) => (
                      <Button
                        key={id}
                        className="steal-player-button"
                        aria-label={`Steal from ${g.players[id].name} · ${g.players[id].publicScore} points`}
                        title={`Steal from ${g.players[id].name} · ${g.players[id].publicScore} points`}
                        disabled={busy}
                        onClick={() => send({ type: "steal", id })}
                      >
                        <span className="steal-player-avatar" style={{ background: COLORS[g.players[id].color] }}>
                          <img src={g.players[id].bot || g.botPlayers.includes(id) ? botAvatarAsset(g.players[id].color) : avatarAsset(g.players[id].avatar)} alt="" />
                        </span>
                        <span className="steal-player-description"><strong>{g.players[id].name}</strong><span>{g.players[id].publicScore} points</span></span>
                      </Button>
                    ))}
                </div>
                </div>
              </section>
              {self && (
                <div className="game-dock" ref={gameDock}>
                  <TooltipProvider delayDuration={150}>
                  <div
                    className={`hand ${selectingHand ? "hand-trading" : ""} ${droppingToHand ? "trade-drop-zone" : ""} ${droppingToHand && tradeDrag.activeZone === "hand" ? "trade-drop-active" : ""}`}
                    data-trade-drop={droppingToHand ? "hand" : undefined}
                    aria-label={
                      g.cities
                        ? "Your resources and commodities"
                        : "Your resource cards"
                    }
                  >
                    {goods
                      .filter((r) => (hand[r] ?? 0) > 0)
                      .map((r) => (
                        <HandCardHelp key={r} label={LABELS[r]} effect={goodUses(r, g.mode)}
                          status={`${hand[r]} owned · ${modal === "discard" ? "Click or drag to discard." : `${g.rates[r] ?? 4}:1 at the bank. ${selectingHand ? "Click or drag into the exchange." : g.phase === "action" ? "Click to trade." : "Trade after rolling."}`}`}
                          disabled={busy || (!droppingToHand && g.phase !== "action")}>
                        {selectingHand ? <button type="button" {...tradeDrag.bind(r, "hand")}
                          className="resource-card trade-draggable-card hand-trade-card" data-hand-card={r}
                          aria-label={modal === "discard" ? `Discard ${LABELS[r]}` : `Add ${LABELS[r]} to You give`}
                          disabled={busy || (modal === "discard" && ((want[r] ?? 0) >= (hand[r] ?? 0) || total(want) >= g.discards[me])) || ((modal === "trade" || modal === "bank") && (give[r] ?? 0) >= (hand[r] ?? 0))}
                          onClick={() => modal === "discard" ? addDiscardGood(r) : addTradeGood(r, false)}>
                          <img src={goodImage(r)} alt="" draggable={false} />
                          <strong>{modal === "discard" ? Math.max(0, (hand[r] ?? 0) - (want[r] ?? 0)) : (modal === "trade" || modal === "bank") ? Math.max(0, (hand[r] ?? 0) - (give[r] ?? 0)) : hand[r] ?? 0}</strong>
                        </button> : <button className="resource-card hand-resource-card" type="button" data-hand-card={r}
                          aria-label={`Trade ${LABELS[r]}`} disabled={busy || g.phase !== "action"}
                          onClick={() => open(g.mode === "solo" ? "bank" : "trade")}>
                          <img src={goodImage(r)} alt="" draggable={false} />
                          <strong>{hand[r] ?? 0}</strong>
                        </button>}
                        </HandCardHelp>
                      ))}
                    {self.dev?.map((card, index) => {
                      const cooldown = !g.rush && card.bought >= g.turn && card.kind !== "victory";
                      const disabled = busy || card.kind === "victory" || !myTurn || !["roll", "action"].includes(g.phase) ||
                        (!g.rush && (g.devPlayed || card.bought >= g.turn)) || (card.kind === "knight" && !!g.rush?.robberQueue.includes(me));
                      const effect = usesSeafarers(g.mode) && card.kind === "roadBuilding" ? "Place two roads or ships for free." :
                        usesSeafarers(g.mode) && card.kind === "knight" ? "Move the robber or pirate and steal a card. Counts toward Largest Army." : DEV_EFFECTS[card.kind];
                      const status = card.kind === "victory" ? undefined : cooldown ? "Available next turn." :
                        !myTurn ? "Play on your turn." : !g.rush && g.devPlayed ? "You already played a deployment card this turn." :
                          !["roll", "action"].includes(g.phase) ? "Finish the current action before playing this card." : "Click to play.";
                      return <HandCardHelp key={`dev-${index}-${card.kind}-${card.bought}`} label={DEV_LABELS[card.kind]} effect={effect} status={status} disabled={disabled}>
                      <button className={`resource-card hand-development-card${cooldown ? " development-cooldown" : ""}${card.kind === "victory" ? " hand-victory-card" : ""}`} type="button" data-hand-card="development"
                        disabled={disabled}
                        aria-label={`${DEV_LABELS[card.kind]} deployment card${cooldown ? ", available next turn" : ""}`}
                        onClick={() => {
                          if (disabled || card.kind === "victory") return;
                          if (card.kind === "plenty" || card.kind === "monopoly") open(card.kind);
                          else void send({ type: card.kind });
                        }}>
                        <img src={ASSETS[`card_${DEV_ASSET[card.kind]}`]} alt={DEV_LABELS[card.kind]} />
                      </button>
                      </HandCardHelp>;
                    })}
                    {!goods.some((r) => (hand[r] ?? 0) > 0) && (
                      <span className="muted empty-hand">
                        No resource cards in hand
                      </span>
                    )}
                  </div>
                  </TooltipProvider>
                  <TooltipProvider delayDuration={150}>
                    <div className="build-bar">
                      <Button className="dock-action dock-trade" disabled={busy || !normal} onClick={() => open(g.mode === "solo" ? "bank" : "trade")}>
                        <ArrowRightLeft aria-hidden="true" />
                        <span>Trade</span>
                      </Button>
                      {(usesSeafarers(g.mode)
                        ? (["road", "ship", "settlement", "city"] as const)
                        : (["road", "settlement", "city"] as const)
                      ).map((type) => (
                        <BuildCard
                          key={type}
                          label={type[0].toUpperCase() + type.slice(1)}
                          cost={COSTS[type]}
                          remaining={Math.max(0, ({ road: 15, ship: 15, settlement: 5, city: 4 })[type] - self!.pieces[type])}
                          className={mode === type ? "chosen" : ""}
                          disabled={
                            busy ||
                            !(
                              buildPhase ||
                              ((type === "road" || type === "ship") &&
                                myTurn &&
                                ["setupRoad", "roadBuilding"].includes(g.phase))
                            ) ||
                            (!canPay(COSTS[type]) &&
                              !(
                                myTurn &&
                                ["setupRoad", "roadBuilding"].includes(g.phase)
                              )) ||
                            !g.legal[type].length
                          }
                          onClick={() => {
                            setPending(null);
                            setMovingShip(null);
                            setMode(mode === type ? null : type);
                          }}
                        >
                          <img
                            className={type === "road" ? "road-piece-icon" : undefined}
                            src={
                              ASSETS[
                                type === "ship"
                                  ? `ship_${PLAYER_COLORS[self!.color]}_north_west`
                                  : `${type}_${PLAYER_COLORS[self!.color]}`
                              ]
                            }
                            alt=""
                          />
                          <span>
                            {type[0].toUpperCase() + type.slice(1)}
                          </span>
                        </BuildCard>
                      ))}
                      {!g.cities && (
                        <BuildCard className="deployment-card" label="Deployment Card" cost={COSTS.development}
                          disabled={
                            busy ||
                            !buildPhase ||
                            !canPay(COSTS.development) ||
                            !g.deckCount
                          }
                          onClick={() => send({ type: "buyDev" })}
                        >
                          <img src={ASSETS.card_devcardback} alt="" />
                          <span>
                            Deployment Card
                          </span>
                        </BuildCard>
                      )}
                      {usesSeafarers(g.mode) && (
                        <Button
                          className={mode === "moveShip" ? "chosen" : ""}
                          disabled={busy || !g.legal.moveShips.length}
                          onClick={() => {
                            setPending(null);
                            setMovingShip(null);
                            setMode(mode === "moveShip" ? null : "moveShip");
                          }}
                        >
                          Move Ship<small>Once per turn</small>
                        </Button>
                      )}
                      <Button
                        className="dock-action dock-end-turn"
                        disabled={busy || !myTurn || !["action", "special"].includes(g.phase) || !!g.rush?.votes.includes(me)}
                        aria-keyshortcuts={sound.shortcuts && myTurn && ["action", "special"].includes(g.phase) ? "Space" : undefined}
                        title={sound.shortcuts ? `${g.phase === "special" ? "Finish Building" : g.rush ? "Vote to Roll" : "End Turn"} (Space)` : undefined}
                        onClick={() => send({ type: g.phase === "special" ? "pass" : g.rush ? "voteRoll" : "end" })}
                      >
                        <Hourglass aria-hidden="true" />
                        <span>{g.phase === "special" ? "Finish Building" : g.rush ? g.rush.votes.includes(me) ? "Voted to Roll" : `Vote to Roll (${g.rush.votes.length}/${g.players.length})` : "End Turn"}</span>
                      </Button>
                    </div>
                  </TooltipProvider>
                </div>
              )}
              {me < 0 && (
                <div className="notice">
                  You are spectating. Player hands remain private.
                </div>
              )}
            </section>
            <aside className="game-sidebar">
              <GameActivityPanels
                log={[...g.log].reverse().map((line, i) => (
                  <p key={i}><GameLogLine text={line} players={g.players} /></p>
                ))}
                chat={<Chat g={g} send={send} busy={interactionBusy} />}
              />
              <div className="bank">
                {goods.map((r) => (
                  <span key={r} className="bank-card" data-bank-card={r} title={`${LABELS[r]} remaining in bank`}>
                    <img src={goodImage(r)} alt={LABELS[r]} />
                    <strong>{g.bank?.[r] ?? "?"}</strong>
                  </span>
                ))}
                {!g.cities && (
                  <span className="bank-card" data-bank-card="development" title="Development cards remaining">
                    <img src={ASSETS.card_devcardback} alt="Development deck" />
                    <strong>{g.deckCount}</strong>
                  </span>
                )}
                {g.cities &&
                  (["science", "trade", "politics"] as const).map((track) => (
                    <span key={track} className="bank-card" title={`${track} progress cards remaining`}>
                      <img
                        src={CITIES_ASSETS[`card_progress_${track}_back`]}
                        alt={`${track} progress deck`}
                      />
                      <strong>{g.cities!.deckCounts[track]}</strong>
                    </span>
                  ))}
              </div>
              <section className="panel game-roster" aria-label="Players">{players}</section>

              {g.cities && (
                <CitiesControls
                  game={g}
                  compact
                  busy={busy}
                  error={error}
                  send={send}
                />
              )}
              <TradeOffers
                game={g}
                busy={busy}
                send={send}
                edit={editTrade}
                counter={counterTrade}
              />
            </aside>
          </div>
        )}
        <Dialog
          modal={!isDockedDialog(modal)}
          open={modal !== null}
          onOpenChange={(v) => {
            if (!v) closeDialog();
          }}
        >
          <DialogContent
            centered={!tradeDialogDocked}
            style={tradeDialogDocked ? tradeDockStyle : undefined}
            className={`dialog-scroll ${modal === "rules" ? "rules-modal" : ""} ${modal === "stats" ? "stats-modal" : ""} ${tradeDialogDocked ? "trade-hub-modal" : ""} ${modal === "discard" || isResourceChoice(modal) ? "discard-modal" : ""}`}
            onInteractOutside={(event) => { if (isDockedDialog(modal)) event.preventDefault(); }}
            onOpenAutoFocus={() => {
              const active = document.activeElement;
              if (
                active &&
                active !== document.body &&
                !active.closest('[role="dialog"]')
              )
                dialogOrigin.current = active;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const origin = dialogOrigin.current;
              if (origin?.isConnected && origin instanceof HTMLElement)
                origin.focus();
              else if (origin?.isConnected && origin instanceof SVGElement)
                origin.focus();
              else boardNavigation.current?.focus();
            }}
          >
            <DialogTitle className={modal === "trade" || modal === "bank" ? "sr-only" : undefined}>
              {modal === "table" ? "Table Information" : modal === "rules"
                ? "Rules"
                : modal === "join"
                    ? "Join Room"
                    : modal === "tradeHub" ? "Trade" : modal === "trade"
                      ? tradeDraft?.kind === "editOffer"
                        ? "Edit Trade Offer"
                        : tradeDraft?.kind === "counterOffer"
                          ? "Make a Counteroffer"
                          : "Trade with Players"
                      : modal === "bank"
                        ? "Bank / Port Trade"
                        : modal === "discard"
                          ? g?.cities
                            ? "Discard Cards"
                            : "Discard Resources"
                          : modal === "plenty"
                            ? "Year of Plenty"
                            : modal === "monopoly"
                              ? "Monopoly"
                              : modal === "stats"
                                ? g?.phase === "finished" ? "Game Results" : "Game Statistics"
                                : modal === "preferences"
                                  ? "Settings"
                                  : modal === "gold"
                                    ? "Choose Gold Resources"
                                    : modal === "resign"
                                      ? "Resign Game"
                                      : "Leave Table"}
              {(modal === "discard" || isResourceChoice(modal)) && g && (
                <span className="discard-count" aria-live="polite"
                  aria-label={`${total(want)} of ${modal === "discard" ? g.discards[me] ?? 0 : modal === "monopoly" ? 1 : 2} cards selected`}>
                  {total(want)}/{modal === "discard" ? g.discards[me] ?? 0 : modal === "monopoly" ? 1 : 2}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className={isDockedDialog(modal) || modal === "tradeHub" ? "sr-only" : undefined}>
              {modal === "join"
                  ? "Use a room code or invitation link."
                  : modal === "tradeHub" ? "Choose a trade partner or exchange with the bank using your ports." : modal === "trade"
                    ? "Pick cards to give and receive. Accept an offer, then its creator confirms the exchange."
                    : modal === "bank"
                      ? "Your ports set the exchange rate."
                      : modal === "discard"
                        ? `Choose exactly ${g?.discards[me] ?? 0} cards to return to the bank.`
                        : modal === "plenty"
                          ? "Take two available resources from the bank."
                          : modal === "monopoly"
                            ? "Collect every card of one resource from your opponents."
                            : modal === "leave"
                              ? g?.phase === "lobby"
                                ? "Your seat will be released."
                                : "Your seat stays reserved. Return using this room link to continue."
                              : modal === "stats"
                                ? g?.phase === "finished" ? "Final scores and victory-point breakdown." : "Dice, activity, resources, card draws and points."
                                : modal === "preferences"
                                  ? "Sound, shortcuts, trades and placement preferences."
                                  : modal === "gold"
                                    ? `Choose exactly ${g?.goldAmount ?? 0} available resources.`
                                    : modal === "resign"
                                      ? "Your opponent will win this match."
                                      : usesSeafarers(g?.mode ?? "base")
                                        ? `${scenarioName(g?.scenario ?? "newShores", g?.boardPlayers ?? 4)} rules for three to six players.`
                                        : usesCitiesKnights(g?.mode ?? "base")
                                          ? "Knights, city improvements and progress cards for three to six players."
                                          : g?.mode === "solo"
                                            ? "Practice rules for one player."
                                            : "Base game rules for two to twelve players."}
            </DialogDescription>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {modal === "table" && g && (              <section className="panel compact">
                {players}
                <div className="settings-row">
                  <span>Victory Target</span>
                  <strong>{g.target}</strong>
                </div>
                <div className="settings-row">
                  <span>{g.rush ? "Rolls" : "Turn"}</span>
                  <strong>{g.turn}</strong>
                </div>
                <Button
                  className="full"
                  variant="secondary"
                  onClick={() => open("stats")}
                >
                  Game Statistics
                </Button>
                <Button
                  className="full"
                  variant="secondary"
                  onClick={() => open("preferences")}
                >
                  Settings
                </Button>
                <Button className="full" variant="ghost" onClick={copy}>
                  {copied ? "Copied!" : "Copy Spectator Link"}
                </Button>
                {g.mode === "duel" && me >= 0 && g.phase !== "finished" && (
                  <Button
                    className="full"
                    variant="ghost"
                    disabled={interactionBusy}
                    onClick={() => open("resign")}
                  >
                    Resign
                  </Button>
                )}
              </section>)}
            {modal === "rules" && (
              <Rules
                discardLimit={g?.discardLimit}
                friendlyRobber={g?.friendlyRobber}
                mode={g?.mode}
                diceMode={g?.diceMode}
                scenario={g?.scenario}
                map={g?.map}
                capacity={g?.boardPlayers}
              />
            )}
            {modal === "preferences" && (
              <div>
                <SoundSettings sound={sound} />
                {me >= 0 && (
                  <div className="settings-row">
                    <span>Auto-decline unanswered trades</span>
                    <Switch
                      aria-label="Auto-decline unanswered trades"
                      checked={g?.players[me].autoRejectTrades ?? true}
                      disabled={busy}
                      onCheckedChange={(autoReject) =>
                        send({ type: "tradePreference", autoReject })
                      }
                    />
                  </div>
                )}
                <div className="settings-row">
                  <span>Confirm placements</span>
                  <Switch
                    aria-label="Confirm placements"
                    checked={confirmPlacement}
                    onCheckedChange={(value) => {
                      setConfirmPlacement(value);
                      setPending(null);
                      localStorage.setItem("island_confirm", String(value));
                    }}
                  />
                </div>
                <p>
                  Choose a highlighted intersection, road or robber tile, then
                  confirm. You can cancel before the move is submitted.
                </p>
                {g?.turnSeconds ? (
                  <p>
                    The server resolves required choices when time expires.
                    Optional building and trading stop when your turn ends.
                  </p>
                ) : null}
              </div>
            )}
            {modal === "join" && (
              <form className="modal-form" onSubmit={e => { e.preventDefault(); void join(); }}>
                <label>Your name
                  <Input autoFocus value={name} maxLength={24} required placeholder="Enter your name" onChange={e => setName(e.target.value)} />
                </label>
                <label>Room code
                  <Input value={joinCode} maxLength={6} required placeholder="ABC234" onChange={e => setJoinCode(e.target.value.toUpperCase())} />
                </label>
                <Button type="submit" className="orange-button" disabled={busy}>{busy ? "Connecting…" : "Join Room"}</Button>
              </form>
            )}
            {modal === "tradeHub" && g && (
              <div className="trade-hub-choices">
                <Button disabled={busy || !normal || g.mode === "solo"} onClick={() => open("trade")}>
                  Trade with Players<small>Choose partners and offer cards</small>
                </Button>
                <Button disabled={busy || !normal} onClick={() => open("bank")}>
                  Bank / Ports<small>Exchange at your best available rate</small>
                </Button>
                {g.mode === "solo" && <p>Player trades are unavailable in solo practice.</p>}
                <Button variant="secondary" onClick={closeDialog}>Cancel</Button>
              </div>
            )}
            {modal === "trade" && g && (
              <>
                <div className="trade-form-scroll" role="region" aria-label="Player trade details" tabIndex={0}>
                <div className="trade-hub-tabs">
                  <Button aria-pressed="true">Players</Button>
                  <Button
                    variant="secondary"
                    disabled={!normal}
                    onClick={() => {
                      closeDialog();
                      open("bank");
                    }}
                  >
                    Bank / Ports
                  </Button>
                </div>
                <fieldset className="trade-recipient-picker">
                  <legend>Trade partners</legend>
                  <div className="trade-recipient-options">
                    {g.players.map((p, seat) => {
                      if (seat === me) return null;
                      const blocked = tradeBlocked(g, me, seat);
                      const selected = tradePartnersLocked && g.active !== me
                        ? seat === g.active
                        : tradeTargets === null ? !blocked : tradeTargets.includes(seat);
                      return (
                        <button
                          key={seat}
                          type="button"
                          className="trade-partner-chip"
                          aria-label={`Trade with ${p.name}`}
                          aria-pressed={selected}
                          title={`${p.name} · ${blocked ? "Trade blocked" : selected ? "Included in trade" : "Excluded from trade"}`}
                          disabled={busy || tradePartnersLocked || (blocked && !selected)}
                          onClick={() => setTradeTargets(current => {
                            const selectedSeats = current ?? eligibleTradePartners;
                            const next = selectedSeats.includes(seat)
                              ? selectedSeats.filter(id => id !== seat)
                              : [...selectedSeats, seat];
                            return next.length === eligibleTradePartners.length &&
                              eligibleTradePartners.every(id => next.includes(id)) ? null : next;
                          })}
                        >
                          <span className="trade-partner-circle" style={{ background: selected ? COLORS[p.color] : "#87918d" }} aria-hidden="true">
                            <img src={p.bot || g.botPlayers.includes(seat) ? botAvatarAsset(p.color) : avatarAsset(p.avatar)} alt="" draggable={false} />
                          </span>
                          <span className="trade-partner-name">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <TradeComposer goods={goods} give={give} want={want} setGive={setGive} setWant={setWant} rates={g.rates} drag={tradeDrag} onReceive={resource => addTradeGood(resource, true)} />
                </div>
                <div className="trade-submit-actions">
                  <Button
                    className="orange-button"
                    disabled={
                      busy ||
                      tradeTargets?.length === 0 ||
                      (!total(give) && !total(want)) ||
                      !total(hand) ||
                      !goods.every(
                        (r) =>
                          (give[r] ?? 0) <= (hand[r] ?? 0),
                      )
                    }
                    onClick={async () => {
                      if (
                        await send({
                          type: tradeDraft?.kind ?? "offer",
                          ...(tradeDraft ? { id: tradeDraft.id } : {}),
                          give,
                          want,
                          targets: tradeTargets,
                        })
                      ) {
                        setTradeDraft(null);
                        setModal(null);
                      }
                    }}
                  >
                    {tradeDraft?.kind === "editOffer"
                      ? "Update Offer"
                      : tradeDraft?.kind === "counterOffer"
                        ? "Send Counteroffer"
                        : "Offer Trade"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={closeDialog}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
            {modal === "bank" && g && (
              <>
                <div className="trade-form-scroll" role="region" aria-label="Bank trade details" tabIndex={0}>
                <div className="trade-hub-tabs">
                  <Button
                    variant="secondary"
                    disabled={g.mode === "solo" || (!g.rush && g.active !== me)}
                    onClick={() => open("trade")}
                  >
                    Players
                  </Button>
                  <Button aria-pressed="true">Bank / Ports</Button>
                </div>
                <TradeComposer goods={goods} give={give} want={want} setGive={setGive} setWant={setWant} rates={g.rates} drag={tradeDrag}
                  onReceive={resource => addTradeGood(resource, true)}
                  receiveLimits={Object.fromEntries(goods.map(resource => [resource, g.bank === null ? 1 : Math.min(1, g.bank[resource] ?? 0)]))} />
                </div>
                <div className="trade-submit-actions">
                <Button
                  className="orange-button"
                  disabled={busy || !bankTradeReady}
                  onClick={async () => {
                    if (await send({ type: "bankTrade", give, want }))
                      setModal(null);
                  }}
                >
                  Confirm Trade
                </Button>
                <Button variant="secondary" disabled={busy} onClick={closeDialog}>Cancel</Button>
                </div>
              </>
            )}
            {(modal === "discard" || modal === "gold") &&
              g && (
                <>
                  {modal === "discard" ? (
                    <DiscardComposer goods={goods} selection={want} remove={removeDiscardGood} drag={tradeDrag} busy={busy} />
                  ) : <Counters
                    title="Take"
                    goods={RESOURCES}
                    value={want}
                    setValue={setWant}
                    max={
                      (g.bank ??
                          (Object.fromEntries(
                            RESOURCES.map((r) => [r, 150]),
                          ) as Hand))
                    }
                  />}
                  {modal !== "discard" && <p>
                    {total(want)} /{" "}
                    {g.goldAmount}{" "}
                    selected
                  </p>}
                  <Button
                    className="orange-button"
                    disabled={
                      busy ||
                      total(want) !==
                        (modal === "discard"
                          ? g.discards[me]
                          : g.goldAmount)
                    }
                    onClick={async () => {
                      if (
                        await send({
                          type:
                            modal === "discard"
                              ? "discard"
                              : "gold",
                          resources: want,
                        })
                      )
                        setModal(null);
                    }}
                  >
                    Confirm
                  </Button>
                </>
              )}
            {isResourceChoice(modal) && g && (
              <>
                <ResourceChoiceComposer selection={want} bank={g.bank} monopoly={modal === "monopoly"}
                  busy={busy} drag={tradeDrag} add={addResourceChoice} remove={removeResourceChoice} />
                <Button className="orange-button"
                  disabled={busy || total(want) !== (modal === "monopoly" ? 1 : 2)}
                  onClick={async () => {
                    const resource = RESOURCES.find(resource => want[resource] > 0);
                    if (modal === "monopoly" && resource) {
                      if (await send({ type: "monopoly", resource })) setModal(null);
                    } else if (modal === "plenty") {
                      if (await send({ type: "plenty", resources: want })) setModal(null);
                    }
                  }}>
                  {modal === "monopoly" ? "Play Monopoly" : "Confirm"}
                </Button>
              </>
            )}
            {modal === "leave" && (
              <>
                {g &&
                  g.me >= 0 &&
                  g.phase !== "lobby" &&
                  g.phase !== "finished" && (
                    <p>
                      Your seat stays in this game. Return using the room link
                      to keep playing.
                    </p>
                  )}
                <p>
                  Room code: <strong>{code}</strong>
                </p>
                <Button
                  className="orange-button"
                  disabled={
                    saving ||
                    (!!connection && g?.me !== -1 && g?.phase === "lobby")
                  }
                  onClick={leave}
                >
                  Leave Table
                </Button>
              </>
            )}
            {modal === "resign" && g && (
              <>
                <p>Resign and give {g.players[1 - me]?.name} the win?</p>
                <Button
                  className="orange-button"
                  disabled={interactionBusy}
                  onClick={async () => {
                    if (await send({ type: "resign" })) setModal(null);
                  }}
                >
                  Confirm Resignation
                </Button>
                <Button
                  variant="secondary"
                  disabled={interactionBusy}
                  onClick={() => setModal(null)}
                >
                  Keep Playing
                </Button>
              </>
            )}
            {modal === "stats" && g && (
              <MatchStatistics key={g.statistics?.id ?? g.code} game={g} summaryOnly={g.phase === "finished"} />
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
