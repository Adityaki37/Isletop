"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { actor, type Action, type View } from "@/lib/game";

export function useTableControls({
  game,
  enabled,
  blocked,
  busy,
  send,
  onError,
}: {
  game: View | null;
  enabled: boolean;
  blocked: boolean;
  busy: boolean;
  send: (action: Action) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const latest = useRef({ game, blocked, busy, send, onError });
  latest.current = { game, blocked, busy, send, onError };
  const lastSpace = useRef(-Infinity);
  const diceAt = useRef(-Infinity);
  const dice = game?.dice?.join(":");
  useEffect(() => {
    lastSpace.current = -Infinity;
  }, [game?.code, game?.created]);
  useEffect(() => {
    diceAt.current = performance.now();
  }, [game?.code, game?.created, game?.turn, game?.phase, dice]);
  useEffect(() => {
    const update = () => {
      setFullscreen(!!document.fullscreenElement);
      setFullscreenSupported(document.fullscreenEnabled);
    };
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.fullscreenEnabled)
        await document.documentElement.requestFullscreen();
      else latest.current.onError("Fullscreen is unavailable in this browser.");
    } catch {
      latest.current.onError("The browser could not change fullscreen mode.");
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const key = (event: KeyboardEvent) => {
      const current = latest.current;
      const g = current.game;
      if (
        !g ||
        current.blocked ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        document.querySelector('[role="dialog"]') ||
        (event.target instanceof Element &&
          event.target.closest(
            "input,textarea,select,button,a,[contenteditable]:not([contenteditable=false]),[role=button],[role=switch],[role=tab],[role=slider],[role=combobox],[role=dialog]",
          ))
      )
        return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (event.key.toLowerCase() === "p") {
        if (
          current.busy ||
          g.me < 0 ||
          g.pause.pausedAt !== null ||
          g.pause.vote ||
          ["lobby", "finished"].includes(g.phase)
        )
          return;
        event.preventDefault();
        void current.send({ type: "pauseRequest" });
        return;
      }
      if (
        (event.code !== "Space" && event.key !== " ") ||
        current.busy ||
        g.me < 0 ||
        actor(g) !== g.me
      )
        return;
      const now = performance.now();
      if (now - lastSpace.current < 600) return;
      let action: Action;
      if (g.phase === "roll") action = { type: "roll" };
      else if (g.phase === "action") {
        if (now - diceAt.current < 500 || g.rush?.votes.includes(g.me)) return;
        action = { type: g.rush ? "voteRoll" : "end" };
      } else if (g.phase === "special") action = { type: "pass" };
      else return;
      event.preventDefault();
      lastSpace.current = now;
      void current.send(action);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [enabled, toggleFullscreen]);
  return { fullscreen, fullscreenSupported, toggleFullscreen };
}
