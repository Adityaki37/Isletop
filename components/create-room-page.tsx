"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Bot, Castle, Check, ChevronRight, Sailboat, Shapes, User, Users, Zap } from "lucide-react";
import { BASE_MAPS, baseMapAvailable, baseMapDescription, baseMapName, baseMapPreview } from "@/lib/base-maps";
import { usesCitiesKnights, usesSeafarers } from "@/lib/game-modes";
import { COLORS } from "@/lib/board";
import { PLAYER_COLORS, ASSETS } from "@/lib/assets";
import { SEAFARERS_SCENARIOS, scenarioName, scenarioPreview } from "@/lib/scenarios";
import type { AccountProfile } from "@/lib/account-types";
import {
  ROOM_MODES, ROOM_STEPS, ROOM_ROLL_SPEEDS,
  changeRoomCapacity, changeRoomMode, changeRoomScenario, restoreRoomSetup,
  roomCapacities, roomRuleDefaults, roomStep, roomTimerLabel, type RoomSetup, type RoomStep,
} from "@/lib/room-setup";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import TurnTimerControl from "./turn-timer-control";
import { Switch } from "./ui/switch";
import { usePageSearch } from "./use-page-search";
import RandomMapPreview from "./random-map-preview";

const DRAFT_KEY = "island_room_setup_v1";
const DRAFT_EVENT = "island-room-setup";
const STEP_LABELS = { game: "Game", map: "Map", rules: "Rules", room: "Room" };
const STEP_TITLES = { game: "Choose your game", map: "Choose a map", rules: "Set the rules", room: "Set up your room" };
const MODE_ICONS = { base: Shapes, duel: Users, citiesKnights: Castle, seafarers: Sailboat, seafarersCitiesKnights: Sailboat, rush: Zap, solo: User };
function subscribeDraft(listener: () => void) {
  window.addEventListener(DRAFT_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(DRAFT_EVENT, listener); window.removeEventListener("storage", listener); };
}
function readDraft() { try { return sessionStorage.getItem(DRAFT_KEY) ?? ""; } catch { return ""; } }
const serverDraft = () => "";
function scenarioDescription(scenario: RoomSetup["scenario"]) {
  return scenario === "fourIslands" ? "Sail between islands and earn bonuses for new island settlements."
    : scenario === "fogIslands" ? "Explore hidden coastlines and receive resource rewards as you reveal fog tiles."
    : scenario === "throughDesert" ? "Cross the desert and sail to new settlements, with gold and island bonuses."
    : "Build ships, discover new islands, and collect gold and settlement bonuses.";
}

export default function CreateRoomPage({ account, name, onName, busy, onCreate }: {
  account: AccountProfile | null;
  name: string;
  onName: (name: string) => void;
  busy: boolean;
  onCreate: (draft: RoomSetup) => Promise<boolean>;
}) {
  const search = usePageSearch();
  const step = roomStep(new URLSearchParams(search).get("step"));
  const storedDraft = useSyncExternalStore(subscribeDraft, readDraft, serverDraft);
  const [previewSeed, setPreviewSeed] = useState(57322);
  const [fallbackDraft, setFallbackDraft] = useState<string | null>(null);
  const draft = restoreRoomSetup(fallbackDraft ?? storedDraft);
  const heading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const color = draft.color ?? account?.color ?? 0;
  const hostName = account?.displayName ?? name;
  const index = ROOM_STEPS.indexOf(step);
  const modeName = ROOM_MODES.find(option => option.id === draft.mode)!.name;
  const createModes = ROOM_MODES.filter(option => option.id !== "solo" && option.id !== "duel");
  const voyages = usesSeafarers(draft.mode);
  const mapName = voyages ? scenarioName(draft.scenario, draft.capacity) : draft.map === "baseRandom" ? "Randomized" : baseMapName(draft.map);
  const preview = voyages ? ASSETS[scenarioPreview(draft.scenario, draft.capacity)] : baseMapPreview(draft.map);
  const bots = draft.botCount;
  const openSeats = draft.capacity - bots - 1;
  const mapChoices = BASE_MAPS.filter(map => baseMapAvailable(map, draft.mode, draft.capacity)).toSorted((a, b) => Number(b === "baseRandom") - Number(a === "baseRandom"));
  const backTo = new URLSearchParams(search).get("from") === "play" ? "/?play=1" : "/";
  useEffect(() => { heading.current?.focus(); }, [step]);
  function save(next: RoomSetup) {
    const text = JSON.stringify(next);
    try { sessionStorage.setItem(DRAFT_KEY, text); window.dispatchEvent(new Event(DRAFT_EVENT)); setFallbackDraft(null); }
    catch { setFallbackDraft(text); }
  }
  function patch(next: Partial<RoomSetup>) { save({ ...draft, ...next }); }
  function go(next: RoomStep) {
    const query = new URLSearchParams(search);
    query.set("step", next);
    query.delete("edit");
    window.history.pushState(null, "", `/create?${query}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  async function submit() {
    if (submitting.current || busy || !hostName.trim()) return;
    submitting.current = true;
    try {
      if (await onCreate({ ...draft, color })) {
        try { sessionStorage.removeItem(DRAFT_KEY); window.dispatchEvent(new Event(DRAFT_EVENT)); } catch {}
      }
    } finally { submitting.current = false; }
  }
  function mapPreview(width: number, height: number, alt = "") {
    return !voyages && draft.map === "baseRandom"
      ? <RandomMapPreview players={draft.capacity} seed={previewSeed} width={width} height={height} label={alt || "Randomized map example"} />
      : <Image src={preview} alt={alt} width={width} height={height} unoptimized />;
  }

  return (
    <section className="create-room-page" aria-label="Create room setup" aria-busy={busy}>
      <div className="room-setup-intro"><h1>Create Room</h1><p>Choose your game, map and rules, then invite your friends.</p></div>
      <nav aria-label="Room setup steps" className="room-setup-steps">
        <ol>{ROOM_STEPS.map((item, i) => <li key={item}>
          <button type="button" aria-current={item === step ? "step" : undefined} disabled={busy || i > index} onClick={() => go(item)}>
            <span aria-hidden="true">{i < index ? <Check size={16} /> : i + 1}</span>{STEP_LABELS[item]}
          </button>
        </li>)}</ol>
      </nav>
      <div className="room-setup-body">
        <form onSubmit={event => { event.preventDefault(); if (step === "room") void submit(); else go(ROOM_STEPS[index + 1]); }}>
          <h2 ref={heading} tabIndex={-1}>{STEP_TITLES[step]}</h2>
          <p className="room-setup-step-caption">Step {index + 1} of {ROOM_STEPS.length}</p>
          <fieldset className="room-setup-fields" disabled={busy}>
            <legend className="sr-only">{STEP_TITLES[step]}</legend>
            {step === "game" && <>
              <fieldset className="room-setup-mode-grid"><legend>Game mode</legend>
                {createModes.map(option => {
                  const Icon = MODE_ICONS[option.id];
                  return <label className={`matchmaking-card ${draft.mode === option.id ? "selected" : ""}`} key={option.id}>
                    <input className="sr-only" type="radio" name="gameMode" value={option.id} checked={draft.mode === option.id} onChange={() => save(changeRoomMode(draft, option.id))} />
                    <Icon aria-hidden="true" /><span><h3>{option.name}</h3><span>{option.seats}</span></span>
                  </label>;
                })}
              </fieldset>
              <label className="room-setup-field">Maximum players
                <NativeSelect value={draft.capacity} onChange={e => save(changeRoomCapacity(draft, Number(e.target.value)))}>
                  {roomCapacities(draft.mode).map(n => <option value={n} key={n}>{n} {n === 1 ? "player" : "players"}</option>)}
                </NativeSelect>
              </label>
            </>}
            {step === "map" && <>
              <p>{modeName} · {draft.capacity} players</p>
              <fieldset className="matchmaking-map-grid"><legend className="sr-only">{voyages ? "Voyages scenario" : "Map"}</legend>
                {voyages ? SEAFARERS_SCENARIOS.map(scenario => <label key={scenario} className={`matchmaking-map-card ${draft.scenario === scenario ? "selected" : ""}`}>
                  <input className="sr-only" type="radio" name="scenario" checked={draft.scenario === scenario} onChange={() => save(changeRoomScenario(draft, scenario))} />
                  <Image src={ASSETS[scenarioPreview(scenario, draft.capacity)]} alt="" width={140} height={110} unoptimized />
                  <strong>{scenarioName(scenario, draft.capacity)}</strong>
                </label>) : mapChoices.map(map => <label key={map} className={`matchmaking-map-card ${draft.map === map ? "selected" : ""}`}>
                  <input className="sr-only" type="radio" name="map" checked={draft.map === map} onClick={() => { if (map === "baseRandom") setPreviewSeed(seed => seed + 1); }} onChange={() => patch({ map })} />
                  {map === "baseRandom" ? <RandomMapPreview players={draft.capacity} seed={previewSeed} width={140} height={110} /> : <Image src={baseMapPreview(map)} alt="" width={140} height={110} unoptimized />}
                  <strong>{map === "baseRandom" ? "Randomized" : baseMapName(map)}</strong>
                  {map === "baseRandom" && <small>Default · Fresh shuffle every game</small>}
                </label>)}
              </fieldset>
              <p className="room-setup-help">{voyages ? scenarioDescription(draft.scenario) : baseMapDescription(draft.map)}</p>
              {voyages && <p className="room-setup-help">Terrain and number tokens are randomized within this scenario. Its recommended victory target is applied when you select it.</p>}
            </>}
            {step === "rules" && <>
              <p>Use the recommended rules or customize this unranked game.</p>
              <div className="room-setup-form-grid">
                <label className="room-setup-field">Victory points
                  <NativeSelect aria-label="Victory points" aria-describedby="setup-target-help" value={draft.target} onChange={e => patch({ target: Number(e.target.value) })}>{Array.from({length: 18}, (_, i) => i + 3).map(n => <option value={n} key={n}>{n} points</option>)}</NativeSelect>
                  <small id="setup-target-help">Reach {draft.target} points on your own turn to win.</small>
                </label>
                <label className="room-setup-field">Dice mode
                  <NativeSelect aria-label="Dice mode" aria-describedby="setup-dice-help" value={draft.diceMode} onChange={e => patch({ diceMode: e.target.value as RoomSetup["diceMode"] })}><option value="random">Random</option><option value="balanced">Balanced</option></NativeSelect>
                  <small id="setup-dice-help">{draft.diceMode === "random" ? "Each roll is independent and random." : "Balanced dice reduce repeated totals and uneven sevens."}</small>
                </label>
                <div className="room-setup-field">
                  {draft.mode === "rush" ? <label>Dice roll interval
                    <NativeSelect aria-label="Dice roll interval" aria-describedby="setup-timer-help" value={draft.turnSeconds} onChange={e => patch({ turnSeconds: Number(e.target.value) })}>{ROOM_ROLL_SPEEDS.map(n => <option value={n} key={n}>{roomTimerLabel(n)}</option>)}</NativeSelect>
                  </label> : <TurnTimerControl value={draft.turnSeconds} disabled={busy} describedBy="setup-timer-help" onChange={seconds => patch({ turnSeconds: seconds })} />}
                  <small id="setup-timer-help">{draft.mode === "rush" ? `Dice roll automatically every ${draft.turnSeconds} seconds while everyone builds and trades.` : draft.turnSeconds === 0 ? "Unlimited time for each turn." : `Each turn has ${roomTimerLabel(draft.turnSeconds)}. Required choices resolve automatically when time runs out.`}</small>
                </div>
                <label className="room-setup-field">Card discard limit
                  <NativeSelect aria-label="Card discard limit" aria-describedby="setup-discard-help" value={draft.discardLimit} onChange={e => patch({ discardLimit: Number(e.target.value) })}>{Array.from({length:16}, (_, i) => i + 5).map(n => <option value={n} key={n}>{n} cards</option>)}</NativeSelect>
                  <small id="setup-discard-help">When a 7 is rolled, players with {draft.discardLimit + 1} or more cards discard half their hand.{usesCitiesKnights(draft.mode) ? " City walls increase the limit." : ""}</small>
                </label>
              </div>
              <div className="room-setup-toggle"><div><strong>Friendly robber</strong><p>{draft.friendlyRobber ? "Players with two or fewer visible points are protected from the robber." : "The robber can target any player."}</p></div><Switch aria-label="Friendly robber" checked={draft.friendlyRobber} onCheckedChange={friendlyRobber => patch({ friendlyRobber })} /></div>
              <div className="room-setup-toggle"><div><strong>Hide bank card counts</strong><p>{draft.hideBank ? "Remaining bank card counts are hidden." : "Everyone can see the remaining bank card counts."}</p></div><Switch aria-label="Hide bank card counts" checked={draft.hideBank} onCheckedChange={hideBank => patch({ hideBank })} /></div>
              <Button type="button" variant="secondary" onClick={() => patch(roomRuleDefaults(draft.mode, draft.scenario))}>Restore Recommended Rules</Button>
              {draft.capacity > 4 && draft.mode !== "rush" && <p className="room-setup-help">Games with more than four players include the special building phase.</p>}
            </>}
            {step === "room" && <>
              <div className="room-setup-form-grid">
                <label className="room-setup-field">Your name
                  <Input aria-label="Your name" value={hostName} readOnly={!!account} required maxLength={24} onChange={e => { onName(e.target.value); localStorage.setItem("island_name", e.target.value); }} />
                  <small>{account ? "Using your account display name." : "Choose the name your friends will see."}</small>
                </label>
                <label className="room-setup-field">Room name
                  <Input aria-label="Room name" value={draft.title} placeholder={hostName.trim() ? `${hostName.trim()}’s table` : "Your table"} maxLength={40} onChange={e => patch({ title: e.target.value })} />
                  <small>Optional. Leave blank to use your name.</small>
                </label>
              </div>
              <fieldset className="room-setup-visibility"><legend>Room visibility</legend>
                {[false, true].map(isPublic => <label className={`room-setup-choice ${draft.public === isPublic ? "selected" : ""}`} key={String(isPublic)}>
                  <input type="radio" name="visibility" checked={draft.public === isPublic} onChange={() => patch({ public: isPublic })} />
                  <span><strong>{isPublic ? "Public" : "Private"}</strong><small>{isPublic ? "Listed in Open Rooms. Anyone can join." : "Invite friends with the room link or code."}</small></span>
                </label>)}
              </fieldset>
              <fieldset className="room-setup-colors"><legend>Your color</legend>
                {PLAYER_COLORS.map((label, i) => <label key={label} className={`room-setup-color ${color === i ? "selected" : ""}`}>
                  <input className="sr-only" type="radio" name="color" aria-label={label[0].toUpperCase() + label.slice(1)} checked={color === i} onChange={() => patch({ color: i })} />
                  <span aria-hidden="true" style={{ backgroundColor: COLORS[i] }}>{color === i && <Check size={18} color={i === 3 ? "#193c47" : "white"} />}</span><small>{label}</small>
                </label>)}
              </fieldset>
              {draft.mode !== "solo" && <label className="room-setup-field">Starting bots
                <NativeSelect aria-label="Starting bots" value={bots} onChange={e => patch({ botCount: Number(e.target.value) })}>{Array.from({length:draft.capacity}, (_, n) => <option key={n} value={n}>{n === 0 ? "None" : `${n} ${n === 1 ? "bot" : "bots"}`}</option>)}</NativeSelect>
                <small><Bot size={16} aria-hidden="true" /> {bots} bots · {openSeats} seats open for friends. You can add or remove bots in the lobby.</small>
              </label>}
            </>}
          </fieldset>
          <div className="room-setup-actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => index === 0 ? location.assign(backTo) : go(ROOM_STEPS[index - 1])}>{index === 0 ? "Cancel" : "Back"}</Button>
            <Button type="submit" className="orange-button" disabled={busy || (step === "room" && !hostName.trim())}>{busy ? "Creating Room…" : step === "room" ? "Create Room" : `Continue to ${STEP_LABELS[ROOM_STEPS[index + 1]]}`}{!busy && step !== "room" && <ChevronRight size={18} />}</Button>
          </div>

        </form>
        <aside className="room-setup-overview" aria-label="Current room choices">{mapPreview(200, 160)}<strong>{modeName}</strong><span>{mapName}</span><span>{draft.capacity} players · {draft.target} points</span><span>{draft.public ? "Public" : "Private"} · {bots} bots</span></aside>
      </div>
    </section>
  );
}
