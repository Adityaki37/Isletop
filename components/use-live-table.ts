"use client";

import { useEffect, useState } from "react";
import { ConvexClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { View } from "@/lib/game";

export function useLiveTable(
  code: string,
  account: string | undefined,
  update: (game: View) => void,
) {
  const key = code + "\0" + (account ?? "");
  const [connection, setConnection] = useState<{
    key: string;
    live: boolean;
  } | null>(null);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url || !code) return;
    const client = new ConvexClient(url),
      controller = new AbortController();
    let stopped = false,
      hasValue = false;
    client.setAuth(async () => {
      try {
        const response = await fetch("/api/table-session", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
        });
        if (!response.ok) return null;
        const data = (await response.json()) as { token?: unknown };
        return typeof data.token === "string" ? data.token : null;
      } catch {
        return null;
      }
    });
    const unsubscribe = client.onUpdate(
      api.roomViews.table,
      { code },
      (game) => {
        if (stopped) return;
        hasValue = !!game;
        setConnection({ key, live: hasValue });
        if (game) update(game as View);
      },
      () => {
        if (!stopped) {
          hasValue = false;
          setConnection({ key, live: false });
        }
      },
    );
    const stopConnection = client.subscribeToConnectionState((state) => {
      if (!stopped)
        setConnection({ key, live: hasValue && state.isWebSocketConnected });
    });
    const offline = () => setConnection({ key, live: false });
    window.addEventListener("offline", offline);
    return () => {
      stopped = true;
      controller.abort();
      unsubscribe();
      stopConnection();
      window.removeEventListener("offline", offline);
      void client.close();
    };
  }, [code, key, update]);
  return connection?.key === key && connection.live;
}
