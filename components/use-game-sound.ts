"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { View } from "@/lib/game";
import { gameSounds, needsMyAction } from "@/lib/game-sounds";
import { SoundPlayer } from "@/lib/sound-player";

type Preferences = { volume: number; muted: boolean; shortcuts: boolean };
const DEFAULTS: Preferences = { volume: 70, muted: false, shortcuts: true };
const KEY = "island_audio_v1";
export function useGameSound(
  game: View | null,
  connection: string,
  offset: React.RefObject<number>,
) {
  const [preferences, setPreferences] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const player = useRef<SoundPlayer | null>(null);
  const previous = useRef<View | null>(null);
  const wasDisconnected = useRef(false);
  const resumedAt = useRef(0);
  const current = useRef(game);
  current.current = game;
  const ticked = useRef("");
  useEffect(() => {
    const audio = new SoundPlayer();
    player.current = audio;
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (stored && typeof stored === "object")
        setPreferences({
          volume:
            typeof stored.volume === "number" && Number.isFinite(stored.volume)
              ? Math.min(100, Math.max(0, stored.volume))
              : DEFAULTS.volume,
          muted: stored.muted === true,
          shortcuts: stored.shortcuts !== false,
        });
    } catch {}
    setLoaded(true);
    const unlock = (e: Event) => {
      if (e.isTrusted) void audio.unlock();
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      audio.dispose();
      player.current = null;
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    player.current?.configure(preferences.volume / 100, preferences.muted);
    try {
      localStorage.setItem(KEY, JSON.stringify(preferences));
    } catch {}
  }, [preferences, loaded]);
  const setVolume = useCallback(
    (volume: number) =>
      setPreferences((p) => ({
        ...p,
        volume: Math.min(100, Math.max(0, Math.round(volume))),
      })),
    [],
  );
  const setMuted = useCallback(
    (muted: boolean) => setPreferences((p) => ({ ...p, muted })),
    [],
  );
  const setShortcuts = useCallback(
    (shortcuts: boolean) => setPreferences((p) => ({ ...p, shortcuts })),
    [],
  );
  useEffect(() => {
    if (!game) {
      previous.current = null;
      player.current?.stop();
      return;
    }
    const old = previous.current;
    // A lost connection or a background tab never replays missed game history.
    if (
      !connection &&
      !wasDisconnected.current &&
      document.visibilityState === "visible" &&
      old &&
      game.updated >= resumedAt.current
    ) {
      for (const sound of gameSounds(old, game))
        void player.current?.play(sound);
    }
    previous.current = game;
  }, [game, connection]);
  useEffect(() => {
    if (connection && !wasDisconnected.current)
      void player.current?.play("disconnect");
    if (!connection && wasDisconnected.current)
      void player.current?.play("reconnect");
    wasDisconnected.current = !!connection;
  }, [connection]);
  useEffect(() => {
    const visibility = () => {
      previous.current = current.current;
      resumedAt.current = Date.now() + offset.current;
      player.current?.stop();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [offset]);
  useEffect(() => {
    if (!preferences.shortcuts) return;
    const key = (e: KeyboardEvent) => {
      if (
        !current.current ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey ||
        e.defaultPrevented
      )
        return;
      if (
        e.target instanceof Element &&
        e.target.closest(
          "input,textarea,select,[contenteditable=true],[role=slider],[role=combobox]",
        )
      )
        return;
      if (e.key.toLowerCase() === "m" && !e.repeat) {
        e.preventDefault();
        setPreferences((p) => ({ ...p, muted: !p.muted }));
      } else if (
        ["ArrowUp", "ArrowDown"].includes(e.key) &&
        !(
          e.target instanceof Element &&
          e.target.closest("button,[role=switch],[role=tab]")
        )
      ) {
        e.preventDefault();
        setPreferences((p) => ({
          ...p,
          volume: Math.min(
            100,
            Math.max(0, p.volume + (e.key === "ArrowUp" ? 10 : -10)),
          ),
        }));
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [preferences.shortcuts]);
  useEffect(() => {
    const timer = setInterval(() => {
      const g = current.current;
      if (
        !g?.deadline ||
        !needsMyAction(g) ||
        wasDisconnected.current ||
        document.visibilityState !== "visible"
      )
        return;
      const remaining = Math.ceil(
        (g.deadline - Date.now() - offset.current) / 1000,
      );
      const signature = `${g.code}:${g.deadline}:${remaining}`;
      if (remaining > 0 && remaining <= 10 && ticked.current !== signature) {
        ticked.current = signature;
        void player.current?.play("clock_tick");
      }
    }, 250);
    return () => clearInterval(timer);
  }, [offset]);
  const preview = useCallback(async () => {
    await player.current?.unlock();
    void player.current?.play("your_turn");
  }, []);
  return { ...preferences, setVolume, setMuted, setShortcuts, preview };
}
