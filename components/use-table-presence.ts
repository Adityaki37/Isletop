"use client";
import { useEffect, useState } from "react";
import { TABLE_HEARTBEAT, TablePresence } from "@/lib/table-presence";
export function useTablePresence(
  code: string,
  created: number | undefined,
  me: number | undefined,
  account: string | undefined,
) {
  const [state, setState] = useState<TablePresence | null>(null);
  useEffect(() => {
    setState(null);
    if (!code || created === undefined || me === undefined) return;
    const token = crypto.randomUUID(),
      controller = new AbortController();
    let stopped = false,
      running = false,
      lastBeat = 0,
      lastAway: boolean | null = null;
    const body = (op: string) => JSON.stringify({ op, code, created, token });
    const release = () => {
      if (me < 0) return;
      void fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body("release"),
        keepalive: true,
      }).catch(() => {});
    };
    const tick = async () => {
      if (stopped || running || !navigator.onLine) return;
      running = true;
      const away = document.hidden;
      try {
        let response: Response;
        if (
          me >= 0 &&
          (away !== lastAway || Date.now() - lastBeat >= TABLE_HEARTBEAT)
        ) {
          response = await fetch("/api/presence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body(away ? "away" : "beat"),
            keepalive: away,
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(8000),
            ]),
          });
          if (response.ok) {
            lastBeat = Date.now();
            lastAway = away;
          }
        } else
          response = await fetch(`/api/presence?code=${code}`, {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(8000),
            ]),
          });
        if (!response.ok) throw new Error("Presence unavailable");
        const data = (await response.json()) as TablePresence;
        if (!stopped && data.created === created) setState(data);
      } catch {
        if (!stopped) setState(null);
      } finally {
        running = false;
        // Serialize visibility changes behind an in-flight heartbeat so a
        // late visible response cannot leave a hidden tab marked active.
        if (!stopped && away !== document.hidden) {
          lastBeat = 0;
          void tick();
        }
      }
    };
    const resume = () => {
      lastBeat = 0;
      void tick();
    };
    const offline = () => setState(null);
    const visibility = () => {
      resume();
    };
    void tick();
    const timer = setInterval(tick, 5000);
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", release);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      release();
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", release);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [code, created, me, account]);
  return state && state.created === created ? state.connected : null;
}
