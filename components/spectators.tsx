"use client";
import { useEffect, useRef, useState } from "react";
import type { AccountProfile } from "@/lib/account-types";
import type { Spectator, SpectatorPage } from "@/lib/spectator-types";
import { avatarAsset } from "@/lib/avatars";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

export default function Spectators(props: {
  code: string;
  created: number;
  me: number;
  account: AccountProfile | null;
}) {
  // A generation/identity/seat change closes the previous connection before a
  // fresh one is mounted. Room polling never recreates a lease every render.
  return (
    <SpectatorConnection
      key={`${props.code}:${props.created}:${props.me}:${props.account?.username ?? "guest"}`}
      {...props}
    />
  );
}
function Avatar({ viewer }: { viewer: Spectator }) {
  return (
    <img className="spectator-avatar" src={avatarAsset(viewer.avatar)} alt="" />
  );
}
function SpectatorConnection({
  code,
  created,
  me,
  account,
}: {
  code: string;
  created: number;
  me: number;
  account: AccountProfile | null;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState<SpectatorPage>({
      count: 0,
      spectators: [],
      next: null,
    });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState("");
  const [watchingName, setWatchingName] = useState<string | null>(null);
  const [registered, setRegistered] = useState(!!account);
  const pages = useRef(1),
    refresh = useRef<(() => Promise<void>) | null>(null);
  const rename = useRef<((name: string) => Promise<void>) | null>(null);
  useEffect(() => {
    const token = crypto.randomUUID(),
      controller = new AbortController();
    let initialWatch = true;
    let storedName: string | undefined;
    try {
      storedName = localStorage.getItem("island_spectator_name") ?? undefined;
    } catch {
      /* Browser storage can be disabled. */
    }
    let stopped = false,
      running = false,
      lastWatch = 0;
    async function watch(name?: string) {
      const chosenName = name ?? (initialWatch ? storedName : undefined);
      const res = await fetch("/api/spectators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "watch",
          code,
          created,
          token,
          ...(chosenName === undefined ? {} : { name: chosenName }),
        }),
        signal: controller.signal,
      });
      const data = (await res.json()) as {
        error?: string;
        name: string | null;
        username: string | null;
      };
      if (!res.ok)
        throw new Error(data.error ?? "Unable to reconnect as a spectator.");
      lastWatch = Date.now();
      initialWatch = false;
      if (!stopped) {
        setWatchingName(data.name);
        setRegistered(data.username !== null);
        setName((previous) => previous || data.name || "");
      }
    }
    async function read() {
      let cursor: number | null = 0,
        count = 0;
      const spectators: Spectator[] = [];
      for (let n = 0; n < pages.current && cursor !== null; n++) {
        const res = await fetch(
          `/api/spectators?code=${code}&cursor=${cursor}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await res.json()) as SpectatorPage & { error?: string };
        if (!res.ok)
          throw new Error(data.error ?? "Unable to load spectators.");
        count = data.count;
        spectators.push(...data.spectators);
        cursor = data.next;
      }
      if (!stopped)
        setPage({
          count,
          spectators: [...new Map(spectators.map((s) => [s.id, s])).values()],
          next: cursor,
        });
    }
    async function sync() {
      if (running || stopped) return;
      running = true;
      try {
        if (me < 0 && Date.now() - lastWatch >= 30000) await watch();
        if (document.visibilityState === "visible") await read();
        if (!stopped) setError("");
      } catch (e) {
        if (!stopped && !controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to load spectators.",
          );
      } finally {
        running = false;
      }
    }
    function close() {
      if (me < 0)
        navigator.sendBeacon(
          "/api/spectators",
          new Blob([JSON.stringify({ op: "unwatch", code, created, token })], {
            type: "application/json",
          }),
        );
      lastWatch = 0;
    }
    function resume() {
      lastWatch = 0;
      void sync();
    }
    refresh.current = sync;
    rename.current = async (newName) => {
      await watch(newName);
      try {
        localStorage.setItem("island_spectator_name", newName);
      } catch {
        /* The current connection still keeps the saved name. */
      }
      await read();
    };
    void sync();
    const timer = setInterval(() => void sync(), 10000);
    window.addEventListener("pagehide", close);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      close();
      window.removeEventListener("pagehide", close);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
      refresh.current = null;
      rename.current = null;
    };
  }, [code, created, me]);
  const overflow = page.spectators
    .slice(3, 13)
    .map((v) => v.name)
    .join(", ");
  return (
    <>
      {(page.count > 0 || error) && (
        <button
          className="spectators-pill"
          onClick={() => {
            setOpen(true);
            void refresh.current?.();
          }}
          aria-label={`${page.count} spectator${page.count === 1 ? "" : "s"}. View spectators.`}
        >
          <span className="spectators-avatars">
            {page.spectators.slice(0, 3).map((viewer) => (
              <span key={viewer.id} title={viewer.name}>
                <Avatar viewer={viewer} />
              </span>
            ))}
            {page.count > 3 && (
              <span
                className="spectators-extra"
                title={`${overflow}${page.count > 13 ? ", and others" : ""}`}
              >
                +{page.count - 3}
              </span>
            )}
            {error && <span title={error}>!</span>}
          </span>
          <span className="spectators-eye">
            <img src="/art/icon_eye.svg" alt="" />
          </span>
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="spectators-dialog">
          <DialogTitle>Spectators ({page.count})</DialogTitle>
          <DialogDescription>
            {me < 0
              ? `Watching as ${watchingName ?? account?.displayName ?? "a guest"}. Your name is visible to everyone at this table.`
              : "People watching this table."}
          </DialogDescription>
          {error && (
            <p className="error" role="alert">
              {error}
              <Button onClick={() => void refresh.current?.()}>Retry</Button>
            </p>
          )}
          {me < 0 && !registered && (
            <form
              className="spectator-name-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await rename.current?.(name.trim());
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Unable to change your name.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Input
                aria-label="Spectator name"
                value={name}
                maxLength={48}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                type="submit"
                disabled={busy || !name.trim() || [...name.trim()].length > 24}
              >
                Save Name
              </Button>
            </form>
          )}
          <div className="spectator-list">
            {page.spectators.map((viewer) => (
              <div className="spectator-row" key={viewer.id}>
                <Avatar viewer={viewer} />
                <div>
                  {viewer.username ? (
                    <a
                      href={`/?account=1&profile=${encodeURIComponent(viewer.username)}&returnRoom=${code}`}
                    >
                      {viewer.name}
                      <small>@{viewer.username}</small>
                    </a>
                  ) : (
                    <span>
                      {viewer.name}
                      <small>Guest</small>
                    </span>
                  )}
                </div>
              </div>
            ))}
            {!page.count && <p className="muted">No one is watching.</p>}
          </div>
          {page.next !== null && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                pages.current++;
                try {
                  await refresh.current?.();
                } finally {
                  setBusy(false);
                }
              }}
            >
              Show More
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
