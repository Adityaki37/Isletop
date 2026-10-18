"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import type { View } from "@/lib/game";
import {
  canReconnect, parseRememberedGame, sameRememberedGame,
  RECONNECT_EVENT, RECONNECT_STORAGE_KEY, type RememberedGame,
} from "@/lib/game-reconnect";
import { Button } from "./ui/button";

function readGame() {
  try { return parseRememberedGame(localStorage.getItem(RECONNECT_STORAGE_KEY)); }
  catch { return null; }
}

function writeGame(game: RememberedGame | null) {
  try {
    if (game) localStorage.setItem(RECONNECT_STORAGE_KEY, JSON.stringify(game));
    else localStorage.removeItem(RECONNECT_STORAGE_KEY);
  } catch { /* Reconnecting remains optional when browser storage is unavailable. */ }
  window.dispatchEvent(new Event(RECONNECT_EVENT));
}

function clearGame(expected: RememberedGame) {
  const saved = readGame();
  if (saved && sameRememberedGame(saved, expected)) writeGame(null);
}

export function useRememberGame(game: View | null) {
  const remembered = useRef<string | null>(null);
  const code = game?.code, created = game?.created, me = game?.me, phase = game?.phase;
  useEffect(() => {
    if (code && created !== undefined && me !== undefined && phase) {
      const saved = readGame();
      const current: RememberedGame = { version: 1, code, created, dismissed: false };
      if (canReconnect(current, { code, created, me, phase })) {
        const key = `${code}:${created}:${me}`;
        if (remembered.current !== key || !saved || !sameRememberedGame(saved, current)) writeGame(current);
        remembered.current = key;
      } else {
        remembered.current = null;
        if (saved && sameRememberedGame(saved, current)) clearGame(saved);
      }
    } else {
      remembered.current = null;
      window.dispatchEvent(new Event(RECONNECT_EVENT));
    }
  }, [code, created, me, phase]);
}

export default function GameReconnect() {
  const pathname = usePathname();
  const [candidate, setCandidate] = useState<RememberedGame | null>(null);

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;
    const check = async () => {
      controller?.abort();
      controller = new AbortController();
      const request = controller;
      const saved = readGame();
      if (!saved || saved.dismissed || new URLSearchParams(location.search).has("room")) {
        setCandidate(null);
        return;
      }
      try {
        const response = await fetch(`/api/rooms?code=${encodeURIComponent(saved.code)}`, {
          cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
        });
        if (stopped || request.signal.aborted) return;
        const latest = readGame();
        if (!latest || latest.dismissed || !sameRememberedGame(latest, saved)) return;
        if (response.status === 404) { clearGame(saved); setCandidate(null); return; }
        if (!response.ok) return;
        const data = await response.json() as { game?: View };
        if (stopped || request.signal.aborted) return;
        if (!data.game || !canReconnect(saved, data.game)) {
          clearGame(saved);
          setCandidate(null);
          return;
        }
        setCandidate(saved);
      } catch { /* Keep the remembered seat for the next successful connection. */ }
    };
    const refresh = () => { if (!document.hidden) void check(); };
    const storage = (event: StorageEvent) => {
      if (event.key === RECONNECT_STORAGE_KEY || event.key === null) refresh();
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener(RECONNECT_EVENT, refresh);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener(RECONNECT_EVENT, refresh);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [pathname]);

  if (!candidate) return null;
  return <aside className="game-reconnect" aria-label="Game reconnect">
    <Button asChild><a href={`/?room=${candidate.code}`}>Reconnect to your game</a></Button>
    <Button variant="ghost" size="icon" aria-label="Dismiss game reconnect" onClick={() => {
      const saved = readGame();
      if (saved && sameRememberedGame(saved, candidate)) writeGame({ ...saved, dismissed: true });
      setCandidate(null);
    }}><X size={18} aria-hidden="true" /></Button>
  </aside>;
}
