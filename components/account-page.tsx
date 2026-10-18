"use client";
import { useEffect, useState } from "react";
import type {
  AccountOverview,
  AccountProfile,
  ProfileStats,
} from "@/lib/account-types";
import { PLAYER_COLORS } from "@/lib/assets";
import { COLORS } from "@/lib/board";
import { Button } from "./ui/button";
import RankedProfile from "./ranked-profile";
import ProfileRegion from "./profile-region";
import { avatarAsset } from "@/lib/avatars";
const labels: Record<string, string> = {
  base: "Base",
  duel: "1v1",
  solo: "Solo Practice",
  rush: "Rapid Play",
  citiesKnights: "Cities & Defenders",
  seafarers: "Voyages",
};
export default function AccountPage({
  username,
  viewerUsername,
  onAccount,
  onFriends,
  guestName,
  onGuestName,
}: {
  username?: string;
  viewerUsername?: string;
  onAccount: (account: AccountProfile | null) => void;
  onFriends: (username: string) => void;
  guestName: string;
  onGuestName: (name: string) => void;
}) {
  const [data, setData] = useState<AccountOverview | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState("login");
  const [user, setUser] = useState(""),
    [password, setPassword] = useState(""),
    [currentPassword, setCurrentPassword] = useState(""),
    [recoveryInput, setRecoveryInput] = useState(""),
    [recovery, setRecovery] = useState(""),
    [displayName, setDisplayName] = useState(""),
    [bio, setBio] = useState(""),
    [color, setColor] = useState(0);
  const [returnRoom, setReturnRoom] = useState("");
  const [guestDraft, setGuestDraft] = useState<string | null>(null);
  const [returnPlay, setReturnPlay] = useState(false);
  useEffect(() => {
    const code = new URLSearchParams(location.search).get("returnRoom");
    if (code && /^[A-Z2-9]{6}$/.test(code)) setReturnRoom(code);
    setReturnPlay(
      new URLSearchParams(location.search).get("returnPlay") === "ranked",
    );
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void (async () => {
      try {
        const response = await fetch(
          `/api/accounts${username ? `?username=${encodeURIComponent(username)}` : ""}`,
          { cache: "no-store", signal: controller.signal },
        );
        const result = (await response.json()) as AccountOverview & {
          error?: string;
        };
        if (!response.ok) throw new Error(result.error);
        if (controller.signal.aborted) return;
        setData(result);
        setDisplayName(result.account?.displayName ?? "");
        setBio(result.account?.bio ?? "");
        setColor(result.account?.color ?? 0);
        if (!username) onAccount(result.account);
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Unable to load the account.",
          );
      }
    })();
    return () => controller.abort();
  }, [attempt, username, onAccount]);
  async function submit(op: string, fields: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op, ...fields }),
        }),
        result = (await response.json()) as {
          error?: string;
          account?: AccountProfile | null;
          recovery?: string;
        };
      if (!response.ok) throw new Error(result.error);
      if (result.account !== undefined) {
        onAccount(result.account);
        if (result.account) {
          localStorage.setItem("island_name", result.account.displayName);
        } else {
          localStorage.removeItem("island_name");
        }
        setData((old) => ({
          ...old,
          account: result.account ?? null,
          guestGames: old?.guestGames ?? 0,
          guestSeats: old?.guestSeats ?? 0,
          sessions: old?.sessions ?? 0,
        }));
      }
      setPassword("");
      setCurrentPassword("");
      setRecoveryInput("");
      if (op === "logout" || op === "logoutAll") {
        setRecovery("");
        setMode("login");
      }
      if (result.recovery) {
        setRecovery(result.recovery);
        setMessage(
          "Save your new recovery code. Previous recovery codes no longer work.",
        );
      } else
        setMessage(
          op === "import"
            ? "Guest games and seats imported."
            : op === "profile"
              ? "Profile saved."
              : op === "logout" || op === "logoutAll"
                ? "Signed out."
                : "Account updated.",
        );
      if (op === "login" && returnRoom) location.assign(`/?room=${returnRoom}`);
      if (op === "login" && !returnRoom && returnPlay)
        location.assign("/?play=1&ranked=1");
      setAttempt((n) => n + 1);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to save the account.",
      );
    } finally {
      setBusy(false);
    }
  }
  function changeMode(next: string) {
    setRecovery("");
    setMode(next);
    setPassword("");
    setRecoveryInput("");
    setError("");
    setMessage("");
  }
  const account = data?.account;
  return (
    <section className="account-page">
      <div className="account-heading">
        <h2>{username ? "Player Profile" : "Account"}</h2>
        <Button
          onClick={() =>
            location.assign(
              returnRoom
                ? `/?room=${returnRoom}`
                : returnPlay
                  ? "/?play=1&ranked=1"
                  : "/",
            )
          }
        >
          {returnRoom
            ? "Back to Room"
            : returnPlay
              ? "Back to Ranked"
              : "Back to Rooms"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <Button onClick={() => setAttempt((n) => n + 1)} disabled={busy}>
            Retry
          </Button>
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!username && !account && (
        <form className="account-form" onSubmit={event => {
          event.preventDefault();
          const updated = (guestDraft ?? guestName).trim();
          if (!updated || updated.length > 24) return;
          onGuestName(updated);
          setMessage("Guest player name saved.");
        }}>
          <h3>Your guest player name</h3>
          <label>Player name
            <input value={guestDraft ?? guestName} maxLength={24} required
              onChange={event => setGuestDraft(event.target.value)} />
          </label>
          <Button type="submit">Save Player Name</Button>
        </form>
      )}
      {recovery && (
        <div className="account-recovery">
          <h3>Save your recovery code</h3>
          <p>
            This code lets you reset your password. Keep it somewhere private;
            it is shown only now.
          </p>
          <code>{recovery}</code>
          <div className="account-actions">
            <Button
              onClick={() =>
                void navigator.clipboard.writeText(recovery).then(
                  () => setMessage("Recovery code copied."),
                  () =>
                    setMessage("Copy the code above and save it privately."),
                )
              }
            >
              Copy Recovery Code
            </Button>
            <Button
              onClick={() => {
                setRecovery("");
                setMessage("");
                if (returnRoom) location.assign(`/?room=${returnRoom}`);
                else if (returnPlay) location.assign("/?play=1&ranked=1");
              }}
            >
              I Saved My Code
            </Button>
          </div>
        </div>
      )}
      {!data && !error && <p role="status">Loading account…</p>}
      {account ? (
        <>
          <RankedProfile username={account.username} />
          <div className="account-profile">
            <div
              className="avatar"
              style={{ background: COLORS[account.color] }}
            >
              <img src={avatarAsset(account.avatar)} alt="" />
            </div>
            <div>
              <h3>{account.displayName}</h3>
              <p>
                @{account.username} · Joined{" "}
                {new Date(account.createdAt).toLocaleDateString()}
              </p>
              {account.bio && <p className="account-bio">{account.bio}</p>}
              <ProfileRegion
                account={account}
                editable={!username || username === viewerUsername}
                onSaved={(a) => {
                  onAccount(a);
                  setData((old) => (old ? { ...old, account: a } : old));
                  setMessage("Region saved.");
                }}
              />
            </div>
          </div>
          {data?.stats && <Stats stats={data.stats} />}
          <Button onClick={() => onFriends(username ?? "")}>
            {username ? "Friend Options" : "Friends & Invitations"}
          </Button>
          {!username && (
            <>
              <div className="account-actions">
                <Button onClick={() => location.assign("/?history=1")}>
                  Game History & Replays
                </Button>
                <Button
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(
                        `${location.origin}/?profile=${account.username}`,
                      )
                      .then(
                        () => setMessage("Profile link copied."),
                        () =>
                          setMessage(
                            `${location.origin}/?profile=${account.username}`,
                          ),
                      );
                  }}
                >
                  Copy Profile Link
                </Button>
              </div>
              <form
                className="account-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit("profile", { displayName, bio, color });
                }}
              >
                <h3>Edit Profile</h3>
                <label>
                  Display name
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={24}
                    required
                  />
                </label>
                <label>
                  Bio
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={200}
                  />
                </label>
                <label>
                  Preferred player color
                  <select
                    value={color}
                    onChange={(e) => setColor(Number(e.target.value))}
                  >
                    {PLAYER_COLORS.map((c, i) => (
                      <option key={c} value={i}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  Your name and bio appear on your public profile. Changes apply
                  to future rooms; saved games keep their original names.
                </p>
                <Button type="submit" disabled={busy}>
                  Save Profile
                </Button>
              </form>
              {((data?.guestGames ?? 0) > 0 || (data?.guestSeats ?? 0) > 0) && (
                <div className="account-panel">
                  <h3>
                    This browser has {data?.guestGames} guest games and{" "}
                    {data?.guestSeats} guest seats
                  </h3>
                  <p>
                    Import this browser’s guest history and seats into your
                    account. You will then access them from any browser where
                    you sign in.
                  </p>
                  <Button disabled={busy} onClick={() => void submit("import")}>
                    Import Guest Games & Seats
                  </Button>
                </div>
              )}
              <details className="account-panel">
                <summary>Password & Recovery</summary>
                <form
                  className="account-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit("password", { currentPassword, password });
                  }}
                >
                  <label>
                    Current password
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      maxLength={256}
                    />
                  </label>
                  <label>
                    New password
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={12}
                      maxLength={256}
                    />
                  </label>
                  <p>
                    Changing your password signs out all other browsers and
                    replaces your recovery code.
                  </p>
                  <Button type="submit" disabled={busy}>
                    Change Password
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || !currentPassword}
                    onClick={() => void submit("recovery", { currentPassword })}
                  >
                    Replace Recovery Code
                  </Button>
                </form>
              </details>
              <div className="account-panel">
                <h3>Signed-in browsers</h3>
                <p>
                  {data?.sessions ?? 1} active sessions. Signing out does not
                  remove a seat or abandon a game; sign in again to resume.
                </p>
                <div className="account-actions">
                  <Button disabled={busy} onClick={() => void submit("logout")}>
                    Sign Out
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => void submit("logoutAll")}
                  >
                    Sign Out All Browsers
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        !username &&
        data && (
          <>
            <p>
              Sign in to keep your seats, history and replays across browsers.
              You can also play as a guest.
            </p>
            <div
              className="account-actions"
              role="group"
              aria-label="Account options"
            >
              <Button
                onClick={() => changeMode("login")}
                aria-pressed={mode === "login"}
              >
                Sign In
              </Button>
              <Button
                onClick={() => changeMode("register")}
                aria-pressed={mode === "register"}
              >
                Create Account
              </Button>
              <Button
                onClick={() => changeMode("reset")}
                aria-pressed={mode === "reset"}
              >
                Recover Account
              </Button>
            </div>
            <form
              className="account-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit(mode, {
                  username: user,
                  password,
                  displayName: displayName || user,
                  recovery: recoveryInput,
                });
              }}
            >
              <h3>
                {mode === "register"
                  ? "Create Account"
                  : mode === "reset"
                    ? "Recover Account"
                    : "Sign In"}
              </h3>
              <label>
                Username
                <input
                  autoComplete="username"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  minLength={3}
                  maxLength={20}
                  pattern="[a-zA-Z0-9_]+"
                  required
                />
              </label>
              {mode === "register" && (
                <label>
                  Display name
                  <input
                    autoComplete="nickname"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={24}
                  />
                </label>
              )}
              {mode === "reset" && (
                <label>
                  Recovery code
                  <input
                    value={recoveryInput}
                    onChange={(e) => setRecoveryInput(e.target.value)}
                    autoComplete="off"
                    required
                    maxLength={64}
                  />
                </label>
              )}
              <label>
                {mode === "reset" ? "New password" : "Password"}
                <input
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === "login" ? 1 : 12}
                  maxLength={256}
                />
              </label>
              {mode === "register" && (
                <p>
                  Use 12–128 characters. Creating an account keeps this
                  browser’s guest seats and games. Save the recovery code shown
                  afterward.
                </p>
              )}
              {mode === "reset" && (
                <p>
                  Your recovery code resets your password and signs out all
                  browsers. A replacement code will be shown.
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : mode === "register"
                    ? "Create Account"
                    : mode === "reset"
                      ? "Reset Password"
                      : "Sign In"}
              </Button>
            </form>
            <Button onClick={() => location.assign("/")}>
              Continue as Guest
            </Button>
          </>
        )
      )}
    </section>
  );
}
function Stats({ stats }: { stats: ProfileStats }) {
  return (
    <div className="account-panel">
      <h3>Game Statistics</h3>
      <p>
        {stats.games} completed games · {stats.wins} wins in{" "}
        {stats.trackedGames} tracked games
      </p>
      {stats.trackedGames < stats.games && (
        <p>
          Older results without recorded winner membership are included in game
          counts, but not win counts.
        </p>
      )}
      <div className="account-table">
        <table>
          <thead>
            <tr>
              <th>Mode</th>
              <th>Games</th>
              <th>Wins</th>
              <th>Tracked</th>
            </tr>
          </thead>
          <tbody>
            {stats.modes.map((m) => (
              <tr key={m.mode}>
                <td>{labels[m.mode] ?? m.mode}</td>
                <td>{m.games}</td>
                <td>{m.wins}</td>
                <td>{m.trackedGames}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
