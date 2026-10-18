"use client";
import { avatarAsset } from "@/lib/avatars";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AccountProfile } from "@/lib/account-types";
import type {
  SocialLookup,
  SocialOverview,
  SocialPlayer,
} from "@/lib/social-types";
import { ASSETS } from "@/lib/assets";
import { Button } from "./ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
const modeNames: Record<string, string> = {
  base: "Base",
  duel: "1v1",
  solo: "Solo Practice",
  rush: "Rapid Play",
  seafarers: "Voyages",
  citiesKnights: "Cities & Defenders",
};
async function socialRequest<T>(
  body?: Record<string, unknown>,
  query = "",
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(`/api/social${query}`, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    signal,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? "Unable to load friends.");
  return data as T;
}
type Toast = { key: string; text: string; tab: string };
export default function SocialPanel({
  account,
  code,
  open,
  onOpen,
  target,
}: {
  account: AccountProfile | null;
  code?: string;
  canInvite: boolean;
  open: boolean;
  onOpen: (open: boolean) => void;
  target: string;
}) {
  const [data, setData] = useState<SocialOverview | null>(null),
    [tab, setTab] = useState("friends"),
    [search, setSearch] = useState(""),
    [lookup, setLookup] = useState<SocialLookup | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [refresh, setRefresh] = useState(0),
    [toast, setToast] = useState<Toast | null>(null);
  const previous = useRef<SocialOverview | null>(null);
  const searchVersion = useRef(0);
  const username = account?.username;
  const lookupUsername = lookup?.profile.username;
  useEffect(() => {
    previous.current = null;
    setData(null);
    setLookup(null);
    setToast(null);
    setError("");
    setMessage("");
  }, [username]);
  useEffect(() => {
    if (!username) return;
    const controller = new AbortController();
    let running = false;
    const poll = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        await socialRequest(
          { op: "presence", code: code ?? null },
          "",
          controller.signal,
        );
        const [next, selected] = await Promise.all([
          socialRequest<SocialOverview>(
            undefined,
            code ? `?code=${encodeURIComponent(code)}` : "",
            controller.signal,
          ),
          open && lookupUsername
            ? socialRequest<SocialLookup>(
                undefined,
                `?username=${encodeURIComponent(lookupUsername)}`,
                controller.signal,
              )
            : Promise.resolve(null),
        ]);
        if (controller.signal.aborted) return;
        const old = previous.current;
        if (old) {
          const newRequest = next.incoming.find(
            (r) => !old.incoming.some((o) => o.id === r.id),
          );
          const online = next.friends.find(
            (f) =>
              f.player.online &&
              old.friends.some((o) => o.id === f.id && !o.player.online),
          );
          if (newRequest)
            setToast({
              key: newRequest.id,
              text: `${newRequest.player.profile.displayName} sent a friend request.`,
              tab: "requests",
            });
          else if (online)
            setToast({
              key: `${online.id}:${Date.now()}`,
              text: `${online.player.profile.displayName} is online.`,
              tab: "friends",
            });
        }
        previous.current = next;
        setData(next);
        if (selected) setLookup(selected);
        setError("");
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load friends.");
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), open ? 5000 : 25000);
    const visible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [username, code, refresh, open, lookupUsername]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (target) {
      searchVersion.current += 1;
      setSearch(target);
      setLookup(null);
      setTab("friends");
    }
  }, [target]);
  useEffect(() => {
    if (!open || !username || !target) return;
    const controller = new AbortController();
    const version = searchVersion.current;
    void socialRequest<SocialLookup>(
      undefined,
      `?username=${encodeURIComponent(target)}`,
      controller.signal,
    )
      .then((r) => {
        if (!controller.signal.aborted && version === searchVersion.current)
          setLookup(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted && version === searchVersion.current)
          setError(e.message);
      });
    return () => controller.abort();
  }, [open, target, username, refresh]);
  async function findPlayer(value = search) {
    value = value.trim();
    const version = ++searchVersion.current;
    setSearch(value);
    setLookup(null);
    if (!value) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await socialRequest<SocialLookup>(
        undefined,
        `?username=${encodeURIComponent(value)}`,
      );
      if (version === searchVersion.current) setLookup(result);
    } catch (e) {
      if (version === searchVersion.current) {
        setLookup(null);
        setError(e instanceof Error ? e.message : "Player not found.");
      }
    } finally {
      setBusy(false);
    }
  }
  async function act(op: string, fields: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await socialRequest({ op, ...fields });
      if (lookup)
        setLookup(
          await socialRequest<SocialLookup>(
            undefined,
            `?username=${encodeURIComponent(lookup.profile.username)}`,
          ),
        );
      setMessage(
        (
          {
            request: "Friend request sent.",
            accept: "Friend request accepted.",
            decline: "",
            cancel: "Friend request canceled.",
            remove: "Friend removed.",
            block:
              "Player blocked. They can no longer send requests or invitations.",
            unblock:
              "Player unblocked. Send a new request to become friends again.",
            invite: "Invitation sent.",
            preferences: "Online status preference saved.",
          } as Record<string, string>
        )[op] ?? "Updated.",
      );
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save this change.");
    } finally {
      setBusy(false);
    }
  }
  const relationshipActions =
    lookup && lookup.relationship !== "self" ? (
      <div className="social-actions">
        {lookup.relationship === "none" && (
          <Button
            disabled={busy}
            onClick={() =>
              void act("request", { username: lookup.profile.username })
            }
          >
            Add Friend
          </Button>
        )}
        {lookup.relationship === "incoming" && (
          <>
            <Button
              disabled={busy}
              onClick={() => void act("accept", { id: lookup.id })}
            >
              Accept
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void act("decline", { id: lookup.id })}
            >
              Decline
            </Button>
          </>
        )}
        {lookup.relationship === "outgoing" && (
          <Button
            disabled={busy}
            onClick={() => void act("cancel", { id: lookup.id })}
          >
            Cancel Request
          </Button>
        )}
        {lookup.relationship === "friends" && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void act("remove", { id: lookup.id })}
          >
            Remove Friend
          </Button>
        )}
        {lookup.relationship !== "blocked" && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void act("block", { username: lookup.profile.username })
            }
          >
            Block Player
          </Button>
        )}
        {lookup.relationship === "blocked" && (
          <Button
            disabled={busy}
            onClick={() =>
              void act("unblock", { username: lookup.profile.username })
            }
          >
            Unblock
          </Button>
        )}
      </div>
    ) : null;
  return (
    <>
      <button
        className={open ? "selected social-nav" : "social-nav"}
        onClick={() => onOpen(true)}
        aria-label={`Friends${data?.incoming.length ? `, ${data.incoming.length} pending requests` : ""}`}
      >
        <img src={ASSETS.icon_profile_friends} alt="" />
        Friends
        {data?.incoming.length ? (
          <span className="social-badge">
            {data.incoming.length > 99 ? "99+" : data.incoming.length}
          </span>
        ) : null}
      </button>
      <Sheet open={open} onOpenChange={onOpen}>
        <SheetContent className="social-panel">
          <SheetHeader>
            <SheetTitle>Friends</SheetTitle>
            <SheetDescription>
              {account
                ? `@${account.username}`
                : "Sign in to add friends and receive invitations."}
            </SheetDescription>
          </SheetHeader>
          {!account ? (
            <Button onClick={() => location.assign("/?account=1")}>
              Sign In
            </Button>
          ) : (
            <>
              <div
                className="social-tabs"
                role="group"
                aria-label="Friends sections"
              >
                {["friends", "requests", "blocked"].map((t) => (
                  <Button
                    key={t}
                    variant="secondary"
                    aria-pressed={tab === t}
                    onClick={() => setTab(t)}
                  >
                    {t === "requests"
                      ? `Requests${data?.incoming.length ? ` (${data.incoming.length})` : ""}`
                      : t === "blocked"
                        ? "Blocked"
                        : `Friends${data ? ` (${data.friends.filter((f) => f.player.online).length}/${data.friends.length})` : ""}`}
                  </Button>
                ))}
              </div>
              {error && (
                <div role="alert" className="error">
                  {error}
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setRefresh((n) => n + 1)}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {message && <p role="status">{message}</p>}
              {!data && !error && <p role="status">Loading friends…</p>}
              <div className="social-scroll">
                {tab === "friends" && (
                  <>
                    <form
                      className="social-search"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void findPlayer();
                      }}
                    >
                      <label>
                        Find a player by username
                        <input
                          value={search}
                          onChange={(e) => {
                            searchVersion.current += 1;
                            setSearch(e.target.value);
                            setLookup(null);
                            setError("");
                          }}
                          maxLength={24}
                          required
                          pattern="[a-zA-Z0-9_]+"
                          placeholder="Username"
                        />
                      </label>
                      <Button type="submit" disabled={busy}>
                        Find Player
                      </Button>
                    </form>
                    {lookup &&
                      search.trim().toLowerCase() ===
                        lookup.profile.username.toLowerCase() && (
                        <div className="social-card">
                          <Profile profile={lookup.profile} />
                          <p>
                            {
                              {
                                self: "This is your profile.",
                                none: "Send a friend request.",
                                friends: "You are friends.",
                                incoming: "Sent you a friend request.",
                                outgoing: "Friend request pending.",
                                blocked: "You blocked this player.",
                                unavailable: "Friend requests are unavailable.",
                              }[lookup.relationship]
                            }
                          </p>
                          {relationshipActions}
                        </div>
                      )}
                    {code && data && (
                      <section className="social-room-players">
                        <h3>Players at your table</h3>
                        {data.roomPlayers
                          .filter((p) => p.profile.username !== username)
                          .map((p) => (
                            <div className="social-card" key={p.seat}>
                              <Profile profile={p.profile} />
                              <Button
                                variant="secondary"
                                disabled={busy}
                                onClick={() =>
                                  void findPlayer(p.profile.username)
                                }
                              >
                                Friend Options
                              </Button>
                            </div>
                          ))}
                        {!data.roomPlayers.some(
                          (p) => p.profile.username !== username,
                        ) && <p>No other signed-in players at this table.</p>}
                      </section>
                    )}
                    {data && !data.friends.length && (
                      <p>
                        No friends yet. Find a username or add players from your
                        table.
                      </p>
                    )}
                    {data?.friends.map((f) => (
                      <div className="social-card" key={f.id}>
                        <Profile profile={f.player.profile} />
                        <Presence player={f.player} />
                        <div className="social-actions">
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void act("remove", { id: f.id })}
                          >
                            Remove Friend
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              void act("block", {
                                username: f.player.profile.username,
                              })
                            }
                          >
                            Block Player
                          </Button>
                        </div>
                      </div>
                    ))}
                    {data && (
                      <label className="social-presence-option">
                        <input
                          type="checkbox"
                          checked={data.showPresence}
                          disabled={busy}
                          onChange={(e) =>
                            void act("preferences", {
                              showPresence: e.target.checked,
                            })
                          }
                        />
                        Show my online status and room to friends
                      </label>
                    )}
                  </>
                )}
                {tab === "requests" && data && (
                  <>
                    <h3>Received requests</h3>
                    {!data.incoming.length && <p>No received requests.</p>}
                    {data.incoming.map((r) => (
                      <div className="social-card" key={r.id}>
                        <Profile profile={r.player.profile} />
                        <div className="social-actions">
                          <Button
                            disabled={busy}
                            onClick={() => void act("accept", { id: r.id })}
                          >
                            Accept
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void act("decline", { id: r.id })}
                          >
                            Decline
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              void act("block", {
                                username: r.player.profile.username,
                              })
                            }
                          >
                            Block
                          </Button>
                        </div>
                      </div>
                    ))}
                    <h3>Sent requests</h3>
                    {!data.outgoing.length && <p>No sent requests.</p>}
                    {data.outgoing.map((r) => (
                      <div className="social-card" key={r.id}>
                        <Profile profile={r.player.profile} />
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void act("cancel", { id: r.id })}
                        >
                          Cancel Request
                        </Button>
                      </div>
                    ))}
                  </>
                )}
                {tab === "blocked" && data && (
                  <>
                    <p>
                      Blocked players cannot send friend requests or
                      invitations. Blocking removes the friendship. It does not
                      remove either player from an existing game.
                    </p>
                    {!data.blocked.length && <p>No blocked players.</p>}
                    {data.blocked.map((p) => (
                      <div className="social-card" key={p.username}>
                        <Profile profile={p} />
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void act("unblock", { username: p.username })
                          }
                        >
                          Unblock
                        </Button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      {toast &&
        createPortal(
          <div className="social-toast" role="status" key={toast.key}>
            <p>{toast.text}</p>
            <div className="social-actions">
              <Button
                onClick={() => {
                  setTab(toast.tab);
                  onOpen(true);
                  setToast(null);
                }}
              >
                Open Friends
              </Button>
              <Button
                variant="secondary"
                aria-label="Dismiss notification"
                onClick={() => setToast(null)}
              >
                Dismiss
              </Button>
            </div>
            <span className="social-toast-timer" />
          </div>,
          document.body,
        )}
    </>
  );
}
function Profile({ profile }: { profile: AccountProfile }) {
  return (
    <a
      className="social-profile"
      href={`/?profile=${encodeURIComponent(profile.username)}`}
    >
      <img src={avatarAsset(profile.avatar)} alt="" />
      <span>
        <strong>{profile.displayName}</strong>
        <small>@{profile.username}</small>
      </span>
    </a>
  );
}
function Presence({ player }: { player: SocialPlayer }) {
  return (
    <p>
      <span className={player.online ? "social-online" : ""}>
        {player.online ? "Online" : "Offline"}
      </span>
      {player.room
        ? ` · ${player.room.phase === "lobby" ? "In a room" : "Playing"} ${modeNames[player.room.mode] ?? player.room.mode}`
        : !player.online && player.lastSeen
          ? ` · Last online ${new Date(player.lastSeen).toLocaleString()}`
          : ""}
    </p>
  );
}
