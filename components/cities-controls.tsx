"use client";
import { useEffect, useState } from "react";
import { Action, View, moveContext, total } from "@/lib/game";
import { RESOURCES, Resource } from "@/lib/board";
import {
  COMMODITIES,
  GOODS,
  TRACKS,
  CityTrack,
  Good,
  ProgressCard,
  PublicCitiesChoice,
  citiesHand,
} from "@/lib/cities-knights";
import { usesSeafarers } from "@/lib/game-modes";
import { openDiplomatRoads } from "@/lib/cities-progress";
import { CITIES_ASSETS } from "@/lib/cities-assets";
import { PLAYER_COLORS } from "@/lib/assets";
import {
  CHOICE_LABELS,
  GOOD_LABELS,
  PROGRESS_HELP,
  PROGRESS_LABELS,
  goodImage,
  progressImage,
} from "@/lib/goods-ui";
import IslandBoard from "./board";
import BoardViewport from "./board-viewport";
import GoodsCounters from "./goods-counters";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

type Task =
  | {
      type:
        | "placeKnight"
        | "activateKnight"
        | "promoteKnight"
        | "moveKnight"
        | "displaceKnight"
        | "chaseRobber"
        | "chasePirate"
        | "wall"
        | "improve";
    }
  | { type: "progress"; card: ProgressCard }
  | { type: "harborExchange"; cardId: number };
type Props = {
  compact?: boolean;
  game: View;
  busy: boolean;
  error: string;
  send: (a: Action) => Promise<boolean>;
};
const TASK_LABELS = {
  placeKnight: "Build knight",
  activateKnight: "Activate knight",
  promoteKnight: "Promote knight",
  moveKnight: "Move knight",
  displaceKnight: "Displace knight",
  chaseRobber: "Chase robber",
  chasePirate: "Chase pirate",
  wall: "Build city wall",
  improve: "Improve city",
  progress: "Play progress card",
  harborExchange: "Commercial Harbor exchange",
};
const TRACK_GOOD: Record<CityTrack, Good> = {
  science: "paper",
  trade: "cloth",
  politics: "coin",
};
function ProgressCards({
  cards,
  selected,
  onSelect,
  disabled = false,
}: {
  cards: ProgressCard[];
  selected?: number;
  onSelect: (id: number) => void;
  disabled?: boolean | ((card: ProgressCard) => boolean);
}) {
  return (
    <div className="progress-cards">
      {cards.map((card) => (
        <Button
          key={card.id}
          className={`progress-card ${selected === card.id ? "chosen" : ""}`}
          disabled={typeof disabled === "function" ? disabled(card) : disabled}
          aria-pressed={selected === card.id}
          onClick={() => onSelect(card.id)}
          title={PROGRESS_HELP[card.kind]}
        >
          <img src={progressImage(card)} alt="" />
          <span>{PROGRESS_LABELS[card.kind]}</span>
        </Button>
      ))}
    </div>
  );
}
function GoodSelect({
  value,
  onChange,
  goods,
  label,
  available,
}: {
  value: Good;
  onChange: (r: Good) => void;
  goods: readonly Good[];
  label: string;
  available?: (r: Good) => number;
}) {
  return (
    <label>
      {label}
      <NativeSelect
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as Good)}
      >
        {goods.map((r) => (
          <option
            key={r}
            value={r}
            disabled={available ? available(r) <= 0 : false}
          >
            {GOOD_LABELS[r]}
            {available ? ` (${available(r)} available)` : ""}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
function ChoiceForm({
  g,
  busy,
  error,
  send,
  choice,
  task,
  done,
}: {
  g: View;
  busy: boolean;
  error: string;
  send: Props["send"];
  choice: PublicCitiesChoice | null;
  task: Task | null;
  done: () => void;
}) {
  const c = g.cities!,
    me = g.me,
    own = c.players[me],
    hand = g.players[me].hand ?? citiesHand(),
    legal = g.citiesLegal!;
  const [args, setArgs] = useState<Action>({ type: "citiesChoice" }),
    [counts, setCounts] = useState(citiesHand),
    [source, setSource] = useState<number | null>(null);
  const kind = task?.type === "progress" ? task.card.kind : null;
  const track = args.track ?? "science",
    good = args.good ?? (kind === "commodityMonopoly" ? "paper" : "wood");
  let vertices: number[] = [],
    edges: number[] = [],
    tiles: number[] = [],
    instruction = "",
    ready = true,
    submit: Action = { ...args, type: "citiesChoice" },
    max = hand,
    count = 0;
  const set = (fields: Partial<Action>) =>
    setArgs((old) => ({ ...old, ...fields }));
  const choiceCardList =
    choice?.kind === "spy"
      ? (c.peek?.progress ?? [])
      : choice?.kind === "discardProgress"
        ? (own.progress ?? [])
        : [];
  const cardSelection = choiceCardList.length > 0;
  const handSelection =
    choice?.kind === "masterMerchant" ||
    choice?.kind === "wedding" ||
    choice?.kind === "saboteur";
  if (choice) {
    instruction = CHOICE_LABELS[choice.kind];
    if ("vertices" in choice) {
      vertices = choice.vertices;
      ready = args.vertex !== undefined && args.vertex !== null;
    }
    if (choice.kind === "deserter") {
      vertices = c.knights.filter((k) => k.owner === me).map((k) => k.vertex);
      ready = args.vertex !== undefined;
    }
    if (choice.kind === "relocateRoad") {
      edges = choice.edges;
      ready = args.edge !== undefined && args.edge !== null;
    }
    if (cardSelection)
      ready =
        args.cardId !== undefined &&
        choiceCardList.some((card) => card.id === args.cardId);
    if (handSelection) {
      count = choice.count;
      max =
        choice.kind === "masterMerchant"
          ? (c.peek?.hand ?? citiesHand())
          : hand;
      ready =
        total(counts) === count &&
        GOODS.every((r) => counts[r] <= (max[r] ?? 0));
      submit.resources = counts;
    }
    if (choice.kind === "aqueduct") {
      const r = args.resource ?? RESOURCES.find((r) => (g.bank?.[r] ?? 1) > 0);
      submit.resource = r;
      ready = !!r && (g.bank?.[r] ?? 1) > 0;
    }
    if (choice.kind === "defenderProgress") {
      const deck =
        args.track ?? TRACKS.find((track) => c.deckCounts[track] > 0);
      submit.track = deck;
      ready = !!deck;
    }
    if (choice.kind === "harborExchange") {
      const selected = args.good ?? COMMODITIES.find((r) => (hand[r] ?? 0) > 0);
      submit.good = selected;
      ready = !!selected && (hand[selected] ?? 0) > 0;
      instruction = `Give one commodity for ${GOOD_LABELS[choice.resource!]}.`;
    }
  } else if (task) {
    instruction =
      task.type === "progress"
        ? PROGRESS_HELP[task.card.kind]
        : TASK_LABELS[task.type];
    submit = { ...args, type: task.type };
    if (task.type === "progress") submit.cardId = task.card.id;
    if (task.type === "placeKnight") vertices = legal.knight;
    if (task.type === "wall" || kind === "engineer") vertices = legal.walls;
    if (task.type === "activateKnight") vertices = legal.activate;
    if (task.type === "promoteKnight" || kind === "smith")
      vertices = legal.promote;
    if (task.type === "chaseRobber") vertices = legal.chase;
    if (task.type === "chasePirate") vertices = legal.pirateChase;
    if (task.type === "moveKnight" || task.type === "displaceKnight") {
      const destinations =
        task.type === "moveKnight" ? legal.moves : legal.displacements;
      vertices =
        source === null
          ? Object.keys(destinations)
              .map(Number)
              .filter((id) => destinations[id].length)
          : (destinations[source] ?? []);
      instruction =
        source === null
          ? "Select one of your active knights."
          : "Select its highlighted destination.";
      ready = source !== null && args.vertex !== undefined;
      submit.id = source ?? undefined;
      submit.to = args.vertex ?? undefined;
    } else if (
      [
        "placeKnight",
        "wall",
        "activateKnight",
        "promoteKnight",
        "chaseRobber",
        "chasePirate",
      ].includes(task.type)
    ) {
      submit.id = args.vertex ?? undefined;
      ready = vertices.includes(args.vertex!);
    }
    if (kind === "engineer" || kind === "medicine") {
      if (kind === "medicine") vertices = g.legal.city;
      submit.vertex = args.vertex;
      ready = vertices.includes(args.vertex!);
    }
    if (kind === "smith") {
      submit.knights = args.knights ?? [];
      ready = submit.knights.length > 0 && submit.knights.length <= 2;
    }
    if (task.type === "improve" || kind === "crane") {
      submit.track = track;
      const level = own.improvements[track],
        cost = level + 1 - (kind === "crane" ? 1 : 0);
      const city = g.board.vertices.some((v) => v.owner === me && v.city),
        availableCity = g.board.vertices.some(
          (v) =>
            v.owner === me &&
            v.city &&
            !TRACKS.some((track) => c.metropolises[track]?.vertex === v.id),
        );
      ready =
        level < 5 &&
        city &&
        (hand[TRACK_GOOD[track]] ?? 0) >= cost &&
        (level < 3 || c.metropolises[track]?.owner === me || availableCity);
    }
    if (kind === "merchant" || kind === "bishop" || kind === "inventor") {
      tiles = g.board.tiles
        .filter(
          (t) =>
            !t.fog &&
            t.resource !== "sea" &&
            (kind === "merchant"
              ? t.resource !== "gold" &&
                t.vertices.some((id) => g.board.vertices[id].owner === me)
              : kind === "inventor"
                ? [3, 4, 5, 9, 10, 11].includes(t.number)
                : c.attacks > 0 &&
                  t.id !== g.board.robber &&
                  (!g.friendlyRobber ||
                    t.vertices.every((id) => {
                      const owner = g.board.vertices[id].owner;
                      return owner === null || g.players[owner].score > 2;
                    }))),
        )
        .map((t) => t.id);
      ready =
        kind === "inventor"
          ? args.tiles?.length === 2
          : tiles.includes(args.tile!);
    }
    if (kind === "diplomat") {
      edges = openDiplomatRoads({
        board: g.board,
        cities: c,
        seafarers: usesSeafarers(g.mode),
      });
      ready = edges.includes(args.edge!);
    }
    if (kind === "intrigue") {
      vertices = c.knights
        .filter(
          (k) =>
            k.owner !== me &&
            g.board.vertices[k.vertex].edges.some(
              (id) =>
                g.board.edges[id].owner === me &&
                (usesSeafarers(g.mode) || g.board.edges[id].kind !== "ship"),
            ),
        )
        .map((k) => k.vertex);
      ready = vertices.includes(args.vertex!);
    }
    if (
      ["merchantFleet", "resourceMonopoly", "commodityMonopoly"].includes(
        kind ?? "",
      )
    )
      submit.good = good;
    if (kind === "alchemist") {
      submit.dice = args.dice ?? [1, 1];
    }
  }
  const targetCard = ["masterMerchant", "spy", "deserter"].includes(kind ?? "");
  const harbor =
    task?.type === "harborExchange"
      ? c.harbors.find((h) => h.id === task.cardId && h.owner === me)
      : null;
  const targetOptions = g.players
    .map((p, i) => ({ p, i }))
    .filter(
      ({ p, i }) =>
        i !== me &&
        (harbor
          ? harbor.remaining.includes(i)
          : kind === "masterMerchant"
            ? p.score > g.players[me].score && p.resources > 0
            : kind === "spy"
              ? c.players[i].progressCount > 0
              : kind === "deserter"
                ? c.knights.some((k) => k.owner === i)
                : false),
    );
  if (targetCard || harbor) {
    submit.to = harbor ? (args.target ?? targetOptions[0]?.i) : undefined;
    submit.target = harbor ? undefined : (args.target ?? targetOptions[0]?.i);
    ready = targetOptions.some(
      (o) => o.i === (args.target ?? targetOptions[0]?.i),
    );
  }
  if (harbor) {
    submit.type = "harborExchange";
    submit.cardId = harbor.id;
    submit.resource = args.resource ?? RESOURCES.find((r) => hand[r] > 0);
    ready = ready && !!submit.resource && hand[submit.resource] > 0;
  }
  const chooseVertex = (id: number) => {
    if (
      task &&
      (task.type === "moveKnight" || task.type === "displaceKnight") &&
      source === null
    ) {
      setSource(id);
      set({ vertex: undefined });
    } else if (kind === "smith") {
      const selected = args.knights ?? [];
      set({
        knights: selected.includes(id)
          ? selected.filter((v) => v !== id)
          : selected.length < 2
            ? [...selected, id]
            : [selected[1], id],
      });
    } else set({ vertex: id });
  };
  const selectedVertices =
    kind === "smith"
      ? (args.knights ?? [])
      : [
          ...(source === null ? [] : [source]),
          ...(args.vertex === undefined || args.vertex === null
            ? []
            : [args.vertex]),
        ];
  return (
    <>
      <DialogDescription>{instruction}</DialogDescription>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {task?.type === "progress" && (
        <img
          className="progress-preview"
          src={progressImage(task.card)}
          alt={PROGRESS_LABELS[task.card.kind]}
        />
      )}
      {(targetCard || harbor) && (
        <label>
          Choose opponent
          <NativeSelect
            aria-label="Choose opponent"
            value={args.target ?? targetOptions[0]?.i ?? ""}
            onChange={(e) => set({ target: Number(e.target.value) })}
          >
            {!targetOptions.length && (
              <option value="">No eligible opponent</option>
            )}
            {targetOptions.map(({ p, i }) => (
              <option value={i} key={i}>
                {p.name} · {p.score} points
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {(task?.type === "improve" ||
        kind === "crane" ||
        choice?.kind === "defenderProgress") && (
        <label>
          Improvement track
          <NativeSelect
            aria-label={choice ? "Progress deck" : "Improvement track"}
            value={submit.track ?? track}
            onChange={(e) => set({ track: e.target.value as CityTrack })}
          >
            {TRACKS.map((track) => (
              <option
                key={track}
                value={track}
                disabled={
                  choice?.kind === "defenderProgress" &&
                  c.deckCounts[track] === 0
                }
              >
                {track[0].toUpperCase() + track.slice(1)}
                {choice
                  ? ` · ${c.deckCounts[track]} cards`
                  : ` · level ${own.improvements[track]}/5 · ${own.improvements[track] + 1 - (kind === "crane" ? 1 : 0)} ${GOOD_LABELS[TRACK_GOOD[track]]}`}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {["merchantFleet", "resourceMonopoly", "commodityMonopoly"].includes(
        kind ?? "",
      ) && (
        <GoodSelect
          label="Choose card type"
          value={good}
          onChange={(r) => set({ good: r })}
          goods={
            kind === "resourceMonopoly"
              ? RESOURCES
              : kind === "commodityMonopoly"
                ? COMMODITIES
                : GOODS
          }
        />
      )}
      {kind === "alchemist" && (
        <div className="trade-grid">
          {["Ordinary die", "Red die"].map((label, i) => (
            <label key={label}>
              {label}
              <NativeSelect
                aria-label={label}
                value={submit.dice![i]}
                onChange={(e) => {
                  const pair = [...submit.dice!];
                  pair[i] = Number(e.target.value);
                  set({ dice: pair });
                }}
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option value={n} key={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </label>
          ))}
        </div>
      )}
      {choice?.kind === "aqueduct" && (
        <GoodSelect
          label="Aqueduct resource"
          value={submit.resource ?? "wood"}
          onChange={(r) => set({ resource: r as Resource })}
          goods={RESOURCES}
          available={(r) => g.bank?.[r] ?? 1}
        />
      )}
      {choice?.kind === "harborExchange" && (
        <GoodSelect
          label="Commodity to exchange"
          value={submit.good ?? "paper"}
          onChange={(r) => set({ good: r })}
          goods={COMMODITIES}
          available={(r) => hand[r] ?? 0}
        />
      )}
      {harbor && (
        <GoodSelect
          label="Resource to offer"
          value={submit.resource ?? "wood"}
          onChange={(r) => set({ resource: r as Resource })}
          goods={RESOURCES}
          available={(r) => hand[r] ?? 0}
        />
      )}
      {handSelection && (
        <>
          <GoodsCounters
            title={
              choice!.kind === "masterMerchant"
                ? "Take"
                : choice!.kind === "wedding"
                  ? "Give"
                  : "Return"
            }
            value={counts}
            setValue={(h) => setCounts({ ...citiesHand(), ...h })}
            max={max}
            goods={GOODS}
          />
          <p>
            {total(counts)} / {count} selected
          </p>
        </>
      )}
      {cardSelection && (
        <ProgressCards
          cards={choiceCardList}
          selected={args.cardId}
          onSelect={(cardId) => set({ cardId })}
          disabled={busy}
        />
      )}
      {(vertices.length > 0 || edges.length > 0 || tiles.length > 0) && (
        <BoardViewport className="cities-choice-board">
          <IslandBoard
            board={g.board}
            cities={c}
            playerColors={g.players.map((p) => p.color)}
            legalVertices={busy ? [] : vertices}
            legalEdges={busy ? [] : edges}
            robberMode={tiles.length > 0 && !busy}
            legalTiles={tiles}
            vertexLabel={
              choice ? CHOICE_LABELS[choice.kind] : "Select intersection"
            }
            edgeLabel={
              choice?.kind === "relocateRoad"
                ? `Relocate ${choice.routeKind ?? "road"}`
                : "Select route"
            }
            tileLabel="Select tile"
            markedVertices={selectedVertices}
            markedTiles={
              kind === "inventor"
                ? (args.tiles ?? [])
                : args.tile === undefined
                  ? []
                  : [args.tile]
            }
            onVertex={chooseVertex}
            onEdge={(edge) => set({ edge })}
            onTile={(tile) => {
              if (kind === "inventor") {
                const selected = args.tiles ?? [];
                set({
                  tiles: selected.includes(tile)
                    ? selected.filter((id) => id !== tile)
                    : selected.length < 2
                      ? [...selected, tile]
                      : [selected[1], tile],
                });
              } else set({ tile });
            }}
            selected={
              args.edge === undefined
                ? null
                : { type: "road", id: args.edge ?? undefined }
            }
          />
        </BoardViewport>
      )}
      {source !== null && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setSource(null);
            set({ vertex: undefined });
          }}
        >
          Choose another knight
        </Button>
      )}
      {kind === "smith" && (
        <p>{args.knights?.length ?? 0} / 2 knights selected</p>
      )}
      {kind === "inventor" && (
        <p>
          {args.tiles
            ?.map((id) => `Tile ${id} (${g.board.tiles[id].number})`)
            .join(" and ") || "Select two number tokens."}
        </p>
      )}
      <div className="cities-dialog-actions">
        <Button
          className="green-button"
          disabled={busy || !ready}
          onClick={async () => {
            if (await send(submit)) done();
          }}
        >
          Confirm{" "}
          {choice
            ? "Choice"
            : task?.type === "progress"
              ? PROGRESS_LABELS[task.card.kind]
              : task
                ? TASK_LABELS[task.type]
                : "Action"}
        </Button>
        {(choice?.kind === "deserterPlace" ||
          choice?.kind === "relocateRoad") && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              if (
                await send({
                  type: "citiesChoice",
                  ...(choice.kind === "deserterPlace"
                    ? { vertex: null }
                    : { edge: null }),
                })
              )
                done();
            }}
          >
            Skip replacement
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={done}>
          {choice ? "Choose later" : "Cancel"}
        </Button>
      </div>
    </>
  );
}
export default function CitiesControls({ game: g, busy, error, send, compact = false }: Props) {
  const [task, setTask] = useState<Task | null>(null),
    [dismissed, setDismissed] = useState(""),
    [panelOpen, setPanelOpen] = useState(false);
  const context = moveContext(g),
    c = g.cities,
    me = g.me;
  useEffect(
    () => setTask(null),
    [
      g.turn,
      g.phase,
      g.active,
      g.specialPlayer,
      g.citiesChoiceSeq,
      g.pause.sequence,
    ],
  );
  if (!c) return null;
  const own = me >= 0 ? c.players[me] : null,
    hand = g.players[me]?.hand ?? citiesHand();
  const normal = me === g.active && g.phase === "action",
    building =
      me === (g.phase === "special" ? g.specialPlayer : g.active) &&
      ["action", "special"].includes(g.phase);
  const choice =
      g.phase === "citiesChoice" && c.choice?.player === me ? c.choice : null,
    choiceOpen = !!choice && dismissed !== context;
  const activeStrength = c.knights
      .filter((k) => k.active)
      .reduce((n, k) => n + k.level, 0),
    barbarians = g.board.vertices.filter(
      (v) => v.owner !== null && v.city,
    ).length;
  const done = () => {
    setPanelOpen(false);
    setTask(null);
    if (choice) setDismissed(context);
  };
  const controls: Task["type"][] = [
    "placeKnight",
    "activateKnight",
    "promoteKnight",
    "moveKnight",
    "displaceKnight",
    "chaseRobber",
    ...(usesSeafarers(g.mode) ? ["chasePirate" as const] : []),
    "wall",
    "improve",
  ];
  const cost = {
    placeKnight: { sheep: 1, ore: 1 },
    activateKnight: { wheat: 1 },
    promoteKnight: { sheep: 1, ore: 1 },
    wall: { brick: 2 },
  };
  const enabled = (type: Task["type"]) => {
    if (!own || busy) return false;
    if (
      type in cost &&
      !GOODS.every(
        (r) =>
          (hand[r] ?? 0) >=
          ((cost as Record<string, Partial<Record<Good, number>>>)[type][r] ??
            0),
      )
    )
      return false;
    if (
      [
        "placeKnight",
        "activateKnight",
        "promoteKnight",
        "wall",
        "improve",
      ].includes(type) &&
      !building
    )
      return false;
    if (
      ["moveKnight", "displaceKnight", "chaseRobber", "chasePirate"].includes(
        type,
      ) &&
      !normal
    )
      return false;
    const legal = g.citiesLegal!;
    return type === "placeKnight"
      ? !!legal.knight.length
      : type === "activateKnight"
        ? !!legal.activate.length
        : type === "promoteKnight"
          ? !!legal.promote.length
          : type === "wall"
            ? !!legal.walls.length
            : type === "moveKnight"
              ? Object.values(legal.moves).some((a) => a.length)
              : type === "displaceKnight"
                ? Object.values(legal.displacements).some((a) => a.length)
                : type === "chaseRobber"
                  ? !!legal.chase.length
                  : type === "chasePirate"
                    ? !!legal.pirateChase.length
                    : g.board.vertices.some((v) => v.owner === me && v.city);
  };
  const panelContent = (<>
      {!compact && <h3>Cities & Defenders</h3>}
      <div className="barbarian-summary">
        <img src={CITIES_ASSETS.dice_event_barbarian} alt="Barbarians" />
        <span>
          Barbarians {c.barbarianPosition}/7
          <br />
          Cities {barbarians} · Active strength {activeStrength}
        </span>
      </div>
      <div
        className="barbarian-track"
        role="progressbar"
        aria-label="Barbarian travel"
        aria-valuenow={c.barbarianPosition}
        aria-valuemin={0}
        aria-valuemax={7}
      >
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className={i < c.barbarianPosition ? "traveled" : ""}>
            {i + 1}
          </span>
        ))}
      </div>
      {g.phase === "citiesChoice" && c.choice && (
        <p className="cities-choice-status">
          {g.players[c.choice.player].name}: {CHOICE_LABELS[c.choice.kind]}
        </p>
      )}
      {choice && (
        <Button
          className="orange-button full"
          disabled={busy}
          onClick={() => setDismissed("")}
        >
          Resolve Choice
        </Button>
      )}
      {own && (
        <>
          <div className="cities-improvements">
            {TRACKS.map((track) => (
              <span key={track}>
                <img src={goodImage(TRACK_GOOD[track])} alt="" />
                {track[0].toUpperCase() + track.slice(1)}{" "}
                {own.improvements[track]}/5
              </span>
            ))}
          </div>
          <p className="cities-private-summary">
            Defender points: {own.defenders} · Progress cards:{" "}
            {own.progressCount}/4
          </p>
          <div className="cities-build-actions">
            {controls.map((type) => (
              <Button
                key={type}
                disabled={!enabled(type)}
                onClick={() => setTask({ type } as Task)}
              >
                {TASK_LABELS[type]}
              </Button>
            ))}
          </div>
          <ProgressCards
            cards={own.progress ?? []}
            onSelect={(id) => {
              const card = own.progress!.find((c) => c.id === id)!;
              setTask({ type: "progress", card });
            }}
            disabled={(card) =>
              busy ||
              me !== g.active ||
              (card.kind === "alchemist"
                ? g.phase !== "roll"
                : g.phase !== "action")
            }
          />
          {!!own.revealed.length && (
            <div className="cities-revealed">
              {own.revealed.map((card) => (
                <span key={card.id}>
                  <img
                    src={progressImage(card)}
                    alt={PROGRESS_LABELS[card.kind]}
                  />
                  +1 point
                </span>
              ))}
            </div>
          )}
          {c.harbors
            .filter((h) => h.owner === me && h.turn === g.turn)
            .map((h) => (
              <div className="harbor-ability" key={h.id}>
                <p>
                  Commercial Harbor · {h.remaining.length} opponents remaining
                </p>
                <Button
                  disabled={busy || !normal || !h.remaining.length}
                  onClick={() =>
                    setTask({ type: "harborExchange", cardId: h.id })
                  }
                >
                  Offer Harbor Exchange
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !normal}
                  onClick={() => send({ type: "finishHarbor", cardId: h.id })}
                >
                  Finish Harbor
                </Button>
              </div>
            ))}
          {!!c.merchantFleets.filter((f) => f.owner === me && f.turn === g.turn)
            .length && (
            <p>
              Merchant Fleet:{" "}
              {c.merchantFleets
                .filter((f) => f.owner === me && f.turn === g.turn)
                .map((f) => GOOD_LABELS[f.good])
                .join(", ")}{" "}
              at 2:1 this turn
            </p>
          )}
        </>
      )}
  </>);
  return (
    <section className={`panel cities-panel ${compact ? "cities-compact" : ""}`} aria-label="Cities & Defenders controls">
      {compact ? (
        <div className="cities-compact-summary">
          <span title={`Cities ${barbarians} · Active strength ${activeStrength}`}>
            Barbarians {c.barbarianPosition}/7 · Strength {activeStrength}
          </span>
          <Button size="sm" onClick={() => setPanelOpen(true)}>
            Knights & Progress{own?.progressCount ? ` (${own.progressCount})` : ""}
          </Button>
          {choice && <Button size="sm" onClick={() => setDismissed("")}>Resolve Choice</Button>}
        </div>
      ) : panelContent}
      <Dialog
        open={
          (choiceOpen || task !== null || panelOpen) &&
          g.pause.pausedAt === null &&
          !g.pause.vote
        }
        onOpenChange={(open) => {
          if (!open) done();
        }}
      >
        <DialogContent className="dialog-scroll cities-dialog">
          <DialogTitle>
            {choiceOpen
              ? CHOICE_LABELS[choice!.kind]
              : task?.type === "progress"
                ? PROGRESS_LABELS[task.card.kind]
                : task
                  ? TASK_LABELS[task.type]
                  : "Cities & Defenders"}
          </DialogTitle>
          {panelOpen && !choiceOpen && !task && (
            <>
              <DialogDescription>Manage knights, city improvements and your progress cards.</DialogDescription>
              {panelContent}
            </>
          )}
          {me >= 0 && (choiceOpen || task) && (
            <ChoiceForm
              key={`${context}:${task?.type}:${task?.type === "progress" ? task.card.id : ""}`}
              g={g}
              busy={busy}
              error={error}
              send={send}
              choice={choiceOpen ? choice : null}
              task={choiceOpen ? null : task}
              done={done}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
