"use client";
import { useEffect, useState } from "react";
import {
  RANKED_MODES,
  type RankedMode,
  type LeaderboardData,
} from "@/lib/ranked-types";
import { avatarAsset } from "@/lib/avatars";
import { CASUAL_QUEUES } from "@/lib/matchmaking-types";
import { RANKED_ASSETS } from "@/lib/ranked-assets";
import type { AccountProfile } from "@/lib/account-types";
import { RANKED_LABELS, Rating } from "./ranked-profile";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { usePageSearch } from "./use-page-search";
import {
  CONTINENTS,
  EMPTY_REGION,
  countryInfo,
  regionFilter,
  regionLabel,
  type PlayerRegion,
} from "@/lib/regions";
import CountryFlag from "./country-flag";
import RegionPicker from "./region-picker";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
type Group = "global" | "friends" | "continent" | "country" | "region";
export default function LeaderboardPage({
  account,
}: {
  account: AccountProfile | null;
}) {
  const [selectedMode, setMode] = useState<RankedMode | null>(null),
    [selectedSeason, setSeason] = useState<string | null>(null),
    [selectedGroup, setGroup] = useState<Group | null>(null),
    [selectedRegion, setRegion] = useState<PlayerRegion | null>(null),
    [regionOpen, setRegionOpen] = useState(false),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState(""),
    [offset, setOffset] = useState(0),
    [response, setResponse] = useState<{
      key: string;
      data: LeaderboardData | null;
      error: string;
    } | null>(null),
    [attempt, setAttempt] = useState(0),
    [clock, setClock] = useState(Date.now);
  const pageSearch = usePageSearch(),
    pageQuery = new URLSearchParams(pageSearch),
    requestedMode = pageQuery.get("mode"),
    mode =
      selectedMode ??
      (RANKED_MODES.includes(requestedMode as RankedMode)
        ? (requestedMode as RankedMode)
        : "base4"),
    season = selectedSeason ?? pageQuery.get("season") ?? "";
  let urlRegion = EMPTY_REGION;
  try {
    urlRegion = regionFilter(pageQuery);
  } catch {
    /* Invalid links fall back to Global. */
  }
  const region =
      selectedRegion ??
      (urlRegion.continentCode ? urlRegion : account?.region) ??
      EMPTY_REGION,
    group =
      selectedGroup ??
      (urlRegion.regionCode
        ? "region"
        : urlRegion.countryCode
          ? "country"
          : urlRegion.continentCode
            ? "continent"
            : "global"),
    friends = group === "friends";
  const q = new URLSearchParams({ mode, offset: String(offset), search });
  if (season) q.set("season", season);
  if (friends) q.set("friends", "1");
  if (["continent", "country", "region"].includes(group))
    q.set("continent", region.continentCode);
  if (["country", "region"].includes(group))
    q.set("country", region.countryCode);
  if (group === "region") q.set("region", region.regionCode);
  function chooseCountry(code: string) {
    setRegion({
      continentCode: countryInfo(code)!.continent,
      countryCode: code,
      regionCode: "",
    });
    setGroup("country");
    setOffset(0);
  }
  const query = q.toString(),
    key = `${query}:${account?.username ?? "guest"}:${attempt}`,
    data = response?.key === key ? response.data : null,
    error = response?.key === key ? response.error : "",
    loading = response?.key !== key;
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/leaderboards?${query}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          result = (await response.json()) as LeaderboardData & {
            error?: string;
          };
        if (!response.ok) throw Error(result.error);
        if (!controller.signal.aborted) {
          setResponse({ key, data: result, error: "" });
          setClock(result.serverTime);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setResponse({
            key,
            data: null,
            error:
              e instanceof Error
                ? e.message
                : "Unable to load the leaderboard.",
          });
        }
      }
    })();
    return () => controller.abort();
  }, [query, key]);
  useEffect(() => {
    if (!data) return;
    const start = Date.now();
    const timer = setInterval(
      () => setClock(data.serverTime + Date.now() - start),
      1000,
    );
    return () => clearInterval(timer);
  }, [data]);
  const days = data
    ? Math.max(0, Math.floor((data.season.endsAt - clock) / 86400000))
    : 0;
  return (
    <section className="leaderboard-page" aria-label="Leaderboards">
      <div className="leaderboard-heading">
        <h2>Leaderboards</h2>
        <Button
          variant="ghost"
          onClick={() => location.assign("/?play=1&ranked=1")}
        >
          Play Ranked
        </Button>
      </div>
      <div className="ranked-tabs leaderboard-modes" aria-label="Ranked mode">
        {RANKED_MODES.map((m) => (
          <Button
            key={m}
            variant={mode === m ? "secondary" : "ghost"}
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setOffset(0);
            }}
          >
            <img
              src={
                m === "base4"
                  ? CASUAL_QUEUES.base4.image
                  : m === "duel"
                    ? CASUAL_QUEUES.duel.image
                    : m === "cities4"
                      ? RANKED_ASSETS.citiesKnights
                      : RANKED_ASSETS.rush
              }
              alt=""
              width={32}
              height={32}
            />
            {RANKED_LABELS[m]}
          </Button>
        ))}
      </div>
      <div className="leaderboard-filters">
        <label>
          Season{" "}
          <select
            value={season || data?.season.id || ""}
            onChange={(e) => {
              setSeason(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Current season</option>
            {data?.seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <span>
          {data &&
            (clock >= data.season.endsAt
              ? "Season complete"
              : `Season ends in ${days} days`)}
        </span>
        <div className="ranked-tabs" aria-label="Leaderboard group">
          <Button
            aria-pressed={group === "global"}
            variant={group === "global" ? "secondary" : "ghost"}
            onClick={() => {
              setGroup("global");
              setOffset(0);
            }}
          >
            Global
          </Button>
          <Button
            aria-pressed={friends}
            variant={friends ? "secondary" : "ghost"}
            disabled={!account}
            title={!account ? "Sign in to view friends" : undefined}
            onClick={() => {
              setGroup("friends");
              setOffset(0);
            }}
          >
            Friends
          </Button>
          {(["continent", "country", "region"] as const).map((g) => {
            const label =
              g === "continent"
                ? CONTINENTS[region.continentCode as keyof typeof CONTINENTS]
                : g === "country"
                  ? countryInfo(region.countryCode)?.name
                  : countryInfo(region.countryCode)?.regions[region.regionCode];
            return (
              label && (
                <Button
                  key={g}
                  aria-pressed={group === g}
                  variant={group === g ? "secondary" : "ghost"}
                  onClick={() => {
                    setGroup(g);
                    setOffset(0);
                  }}
                >
                  {label}
                </Button>
              )
            );
          })}
          <Button variant="ghost" onClick={() => setRegionOpen(true)}>
            Choose Region
          </Button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(draft.trim());
            setOffset(0);
          }}
        >
          <Input
            aria-label="Search player"
            placeholder="Search Player"
            value={draft}
            maxLength={32}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit">Search</Button>
        </form>
      </div>
      <Dialog open={regionOpen} onOpenChange={setRegionOpen}>
        <DialogContent className="region-dialog">
          <DialogTitle>Choose Leaderboard Region</DialogTitle>
          <DialogDescription>
            Browse continent, country and state rankings.
          </DialogDescription>
          <RegionPicker
            value={region}
            onChange={(r) => {
              setRegion(r);
              setGroup(
                r.regionCode
                  ? "region"
                  : r.countryCode
                    ? "country"
                    : r.continentCode
                      ? "continent"
                      : "global",
              );
              setOffset(0);
            }}
          />
          <Button onClick={() => setRegionOpen(false)}>View Leaderboard</Button>
        </DialogContent>
      </Dialog>
      {data?.region.continentCode && (
        <p className="leaderboard-region-label">
          {regionLabel(data.region)} rankings
        </p>
      )}
      {data?.me && (
        <div className="leaderboard-own">
          <CountryFlag
            country={data.me.region?.countryCode ?? ""}
            onSelect={chooseCountry}
          />
          <a href={`/?profile=${data.me.username}`}>{data.me.displayName}</a>
          <Rating player={data.me} />
          {data.me.rank !== null && <span>Rank {data.me.rank}</span>}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <Button onClick={() => setAttempt((n) => n + 1)}>Retry</Button>
        </p>
      )}
      {loading ? (
        <p role="status">Loading leaderboard…</p>
      ) : (
        data && (
          <>
            <div className="leaderboard-table-wrap">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Player</th>
                    <th scope="col">Division</th>
                    <th scope="col">Rating</th>
                    <th scope="col">Win %</th>
                    <th scope="col">Games</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((p) => (
                    <tr key={p.username}>
                      <td>{p.rank}</td>
                      <td>
                        <div className="leaderboard-player">
                          <CountryFlag
                            country={p.region?.countryCode ?? ""}
                            onSelect={chooseCountry}
                          />
                          <a
                            className="leaderboard-player-link"
                            href={`/?profile=${p.username}`}
                          >
                            <img
                              src={avatarAsset(p.avatar)}
                              alt=""
                              width={40}
                              height={40}
                            />
                            <span>
                              {p.displayName}
                              <small>@{p.username}</small>
                            </span>
                          </a>
                        </div>
                      </td>
                      <td>
                        {p.division && (
                          <img
                            src={RANKED_ASSETS[p.division]}
                            alt={p.division}
                            width={32}
                            height={32}
                          />
                        )}
                      </td>
                      <td>{p.rating}</td>
                      <td>
                        {p.games
                          ? ((p.wins / p.games) * 100).toFixed(1)
                          : "0.0"}
                        %
                      </td>
                      <td>{p.games}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.rows.length === 0 && (
              <p role="status">
                {search
                  ? "No rated players match your search."
                  : friends
                    ? "No friends have completed placements in this mode yet."
                    : "No players have completed placements in this mode yet."}
              </p>
            )}
            <div className="leaderboard-pagination">
              <Button
                disabled={!offset}
                onClick={() => setOffset((n) => Math.max(0, n - 50))}
              >
                Previous
              </Button>
              <span>
                {data.total
                  ? `${offset + 1}–${offset + data.rows.length} of ${data.total}`
                  : "0 players"}
              </span>
              <Button
                disabled={data.next === null}
                onClick={() => setOffset(data.next!)}
              >
                Next
              </Button>
            </div>
          </>
        )
      )}
    </section>
  );
}
