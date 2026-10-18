"use client";
import { usesSeafarers, usesCitiesKnights } from "@/lib/game-modes";

import { useState } from "react";
import type { View } from "@/lib/game";
import {
  ACTIVITY_METRICS,
  BUILD_ACTIVITY_METRICS,
  CITIES_ACTIVITY_METRICS,
  RESOURCE_METRICS,
  type PlayerStatistics,
} from "@/lib/match-statistics";
import { ASSETS, PLAYER_COLORS } from "@/lib/assets";
import { avatarAsset, botAvatarAsset } from "@/lib/avatars";
import { victoryPointBreakdown } from "@/lib/match-results";
import {
  GOOD_LABELS,
  PROGRESS_LABELS,
  goodImage,
  progressImage,
} from "@/lib/goods-ui";
import {
  GOODS,
  TRACKS,
  PROGRESS_COUNTS,
  type ProgressKind,
} from "@/lib/cities-knights";
import { NativeSelect } from "./ui/native-select";
import { RESOURCES } from "@/lib/board";
import { STATISTICS_ASSETS } from "@/lib/statistics-assets";
import { Button } from "./ui/button";
import ShareResult from "./share-result";
import RankedResult from "./ranked-result";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const CARDS = [
  ["knight", "Knight", "knight"],
  ["roadBuilding", "Road Building", "roadbuilding"],
  ["plenty", "Year of Plenty", "yearofplenty"],
  ["monopoly", "Monopoly", "monopoly"],
  ["victory", "Victory Point", "vp"],
] as const;
const ICONS: Record<string, string> = {
  proposedTrades: "stat_proposed_trades",
  successfulTrades: "stat_successful_trades",
  bankTrades: "stat_trade_income",
  resourcesUsed: "stat_resources_used",
  resourceIncomeBlocked: "stat_resource_income_blocked",
  devCardsBought: "stat_dev_card_bought",
  devCardsUsed: "stat_dev_card_used",
  totalResourceIncome: "stat_res_gain",
  totalResourceLoss: "stat_res_loss",
  totalResourceScore: "stat_res_score",
  rollingIncome: "stat_rolling_income",
  robbingIncome: "stat_robbing_income",
  devCardIncome: "stat_dev_card_income",
  tradeIncome: "stat_trade_income",
  rollingLoss: "stat_rolling_loss",
  robbingLoss: "stat_robbing_loss",
  devCardLoss: "stat_dev_card_loss",
  tradeLoss: "stat_trade_loss",
  goldIncome: "stat_gold_income",
};
const POINT_ROWS = [
  ["settlements", "Settlements", "settlement_red"],
  ["cities", "Cities", "city_red"],
  ["victoryCards", "Victory point cards", "card_vp"],
  ["longestRoad", "Longest road", "stat_longest_road"],
  ["largestArmy", "Knights played", "stat_largest_army"],
  ["islands", "Island bonuses", "stat_vp"],
  ["defenders", "Island Defender", "stat_defender"],
  ["progressPoints", "Printer / Constitution", "stat_vp"],
  ["metropolises", "Metropolis bonuses", "stat_metropolis"],
  ["merchant", "Merchant", "stat_merchant"],
] as const;
function MetricLabel({
  metric,
  label,
  cities = false,
}: {
  metric: string;
  label: string;
  cities?: boolean;
}) {
  const icon = ICONS[metric],
    ck =
      cities &&
      [
        "devCardsBought",
        "devCardsUsed",
        "devCardIncome",
        "devCardLoss",
      ].includes(metric);
  return (
    <>
      {ICONS[metric] && (
        <img
          className="stats-good"
          src={STATISTICS_ASSETS[`${icon}${ck ? "_ck" : ""}`]}
          alt=""
        />
      )}
      {label}
    </>
  );
}
export function PointsGraph({ game }: { game: View }) {
  const stats = game.statistics;
  if (!stats?.points.length)
    return <p>No points timeline was recorded for this game.</p>;
  const max = Math.max(game.target, ...stats.points.flatMap((p) => p.scores));
  const end = Math.max(1, stats.points.at(-1)!.sequence);
  const x = (sequence: number) => 44 + (sequence / end) * 590;
  const y = (score: number) => 240 - (score / max) * 215;
  return (
    <>
      <svg
        className="points-graph"
        viewBox="0 0 660 278"
        role="img"
        aria-label="Victory points over accepted game actions"
      >
        {[0, Math.ceil(max / 2), max].map((score) => (
          <g key={score}>
            <line
              x1="44"
              x2="634"
              y1={y(score)}
              y2={y(score)}
              stroke="currentColor"
              opacity=".2"
            />
            <text x="34" y={y(score) + 4} textAnchor="end" fill="currentColor">
              {score}
            </text>
          </g>
        ))}
        <text x="44" y="262" fill="currentColor">
          0
        </text>
        <text x="340" y="274" textAnchor="middle" fill="currentColor">
          Game actions
        </text>
        <text x="634" y="262" textAnchor="end" fill="currentColor">
          {end}
        </text>
        {game.players.map((player, seat) => (
          <polyline
            key={seat}
            fill="none"
            stroke={PLAYER_COLORS[player.color]}
            strokeWidth="3"
            points={stats.points
              .map((p) => `${x(p.sequence)},${y(p.scores[seat])}`)
              .join(" ")}
          >
            <title>
              {player.name}: {player.score} points
            </title>
          </polyline>
        ))}
      </svg>
      <div className="stats-legend">
        {game.players.map((player, seat) => (
          <span key={seat}>
            <i style={{ background: PLAYER_COLORS[player.color] }} />
            {player.name}: {player.score}
          </span>
        ))}
      </div>
      {stats.graphTruncated && (
        <p className="muted">
          Early intermediate points were condensed in this unusually long game.
        </p>
      )}
    </>
  );
}
export default function MatchStatistics({
  game,
  showReplayLink = true,
  summaryOnly = false,
}: {
  game: View;
  showReplayLink?: boolean;
  summaryOnly?: boolean;
}) {
  const stats = game.statistics,
    finished = game.phase === "finished";
  const [message, setMessage] = useState("");
  const [cardMetric, setCardMetric] = useState<
    "cardsBought" | "cardsUsed" | "cardsStolen" | "cardsLost" | "cardsDiscarded"
  >("cardsBought");
  const cities = usesCitiesKnights(game.mode);
  const metricLabel = (key: string, label: string) =>
    cities
      ? ((
          {
            devCardsBought: "Progress cards drawn",
            devCardsUsed: "Progress cards played",
            devCardIncome: "Income from progress cards",
            devCardLoss: "Lost to progress cards",
            resourcesUsed: "Resources / commodities spent building",
          } as Record<string, string>
        )[key] ?? label)
      : label;
  const headings = () => (
    <TableRow>
      <TableHead>Statistic</TableHead>
      {game.players.map((player, seat) => (
        <TableHead key={seat}>
          <span
            className="stats-player"
            style={{ borderColor: PLAYER_COLORS[player.color] }}
          >
            <span className="stats-avatar" style={{ background: PLAYER_COLORS[player.color] }}>
              <img src={player.bot || game.botPlayers.includes(seat) ? botAvatarAsset(player.color) : avatarAsset(player.avatar)} alt="" />
            </span>
            {player.name}
          </span>
        </TableHead>
      ))}
    </TableRow>
  );
  const overview = (<>

          <h4 className="stats-section-title">Victory points</h4>
          <Table>
            <TableHeader>{headings()}</TableHeader>
            <TableBody>
              <TableRow className="stats-total-row">
                <TableCell>Total victory points</TableCell>
                {game.players.map((player, seat) => <TableCell key={seat}>
                  {player.score}{game.winner === seat && <span className="stats-winner-badge">Winner</span>}
                </TableCell>)}
              </TableRow>
              {POINT_ROWS.filter(([key]) =>
                ["settlements", "cities"].includes(key) ||
                (!cities && ["victoryCards", "longestRoad", "largestArmy"].includes(key)) ||
                (cities && ["longestRoad", "defenders", "progressPoints", "metropolises", "merchant"].includes(key)) ||
                (key === "islands" && usesSeafarers(game.mode)),
              ).map(([key, label, icon]) => <TableRow key={key}>
                <TableCell><img className="stats-good" src={ASSETS[icon] ?? STATISTICS_ASSETS[icon]} alt="" />{label}</TableCell>
                {game.players.map((player, seat) => <TableCell key={seat}>
                  {key === "longestRoad" ? player.roadLength : key === "largestArmy" ? player.knights : victoryPointBreakdown(game, seat)[key]}
                </TableCell>)}
              </TableRow>)}
            </TableBody>
          </Table>
          {cities && <>
          <h4 className="stats-section-title">Knights</h4>
          <Table>
            <TableHeader>{headings()}</TableHeader>
            <TableBody>
              <TableRow><TableCell>Knights on board</TableCell>
                {game.players.map((_, seat) => <TableCell key={seat}>{game.cities?.knights.filter(knight => knight.owner === seat).length ?? 0}</TableCell>)}
              </TableRow>
            </TableBody>
          </Table>
          </>}

  </>);
  return (
    <div className="match-statistics">
      {finished && (
        <div className="match-result-heading">
          <div className="match-result-heading-main">
            <h3>{game.winner !== null ? `${game.players[game.winner].name} wins!` : "Game complete"}</h3>
            <div className="match-result-meta">
            <p>{game.turn} turns
              {stats?.finishedAt && <> · {Math.max(1, Math.round((stats.finishedAt - stats.startedAt) / 60000))} min</>}
            </p>
              {finished && stats && (
                <div className="match-result-actions">
                  <ShareResult game={game} />
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${location.origin}/?match=${stats.id}`,
                        );
                        setMessage("Result link copied.");
                      } catch {
                        setMessage("Unable to copy the result link. Please try again.");
                      }
                    }}
                  >
                    Copy Result Link
                  </Button>
                  {showReplayLink && (
                    <Button
                      variant="secondary"
                      onClick={() => location.assign(`/?replay=${stats.id}`)}
                    >
                      Replay Game
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
          {game.winner !== null && <strong className="match-winning-score">★ {game.players[game.winner].score}<small>victory points</small></strong>}
        </div>
      )}
      {finished && game.ranked && <RankedResult ranked={game.ranked} />}
      {message && <p role="status">{message}</p>}
      {stats && !stats.complete && (
        <p className="muted">
          This game started before detailed statistics were added. Its earlier
          activity is unavailable.
        </p>
      )}
      {summaryOnly && finished ? overview : <Tabs key={finished ? "finished" : "live"} defaultValue={finished ? "overview" : "dice"}>
        <TabsList className="stats-tabs">
          {finished && <TabsTrigger value="overview">Overview</TabsTrigger>}
          <TabsTrigger value="dice">Dice Stats</TabsTrigger>
          <TabsTrigger
            value="activity"
            disabled={!finished || !stats?.detailed}
          >
            Activity Stats
          </TabsTrigger>
          <TabsTrigger
            value="resources"
            disabled={!finished || !stats?.detailed}
          >
            Resource Stats
          </TabsTrigger>
          <TabsTrigger value="cards" disabled={!finished || !stats?.detailed}>
            Card Draw
          </TabsTrigger>
          <TabsTrigger value="points" disabled={!finished || !stats}>
            Points History
          </TabsTrigger>
        </TabsList>
        {finished && <TabsContent value="overview">{overview}</TabsContent>}
        <TabsContent value="dice">
          <p>
            {Object.values(game.rollCounts).reduce((n, count) => n + count, 0)}{" "}
            dice rolls · {game.turn} turns
          </p>
          <div
            className="roll-chart"
            role="img"
            aria-label="Dice roll distribution"
          >
            {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
              <div key={n} title={`${n}: ${game.rollCounts[n] ?? 0} rolls`}>
                <span>{game.rollCounts[n] ?? 0}</span>
                <div
                  style={{
                    height: Math.max(
                      2,
                      ((game.rollCounts[n] ?? 0) /
                        Math.max(1, ...Object.values(game.rollCounts))) *
                        100,
                    ),
                    background: n === 7 ? "var(--island-action)" : undefined,
                  }}
                />
                <strong>{n}</strong>
              </div>
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead>Points</TableHead>
                <TableHead>
                  {usesSeafarers(game.mode) ? "Trade Route" : "Road"}
                </TableHead>
                <TableHead>Knights</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {game.players.map((player, seat) => (
                <TableRow key={seat}>
                  <TableCell>{player.name}</TableCell>
                  <TableCell>{player.score}</TableCell>
                  <TableCell>{player.roadLength}</TableCell>
                  <TableCell>{player.knights}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!finished && (
            <p className="muted">
              Activity, resources, card draws and points history are revealed
              when the game ends.
            </p>
          )}
          {finished && stats && !stats.detailed && (
            <p className="muted">
              Detailed statistics were not recorded for this game.
            </p>
          )}
        </TabsContent>
        <TabsContent value="activity">
          {stats && (
            <Table>
              <TableHeader>{headings()}</TableHeader>
              <TableBody>
                {BUILD_ACTIVITY_METRICS.filter(([key]) => key !== "ship" || usesSeafarers(game.mode)).map(([key, label]) => (
                  <TableRow key={key}>
                    <TableCell>{label}</TableCell>
                    {stats.players.map((row, seat) => <TableCell key={seat}>{row.builds?.[key] ?? "—"}</TableCell>)}
                  </TableRow>
                ))}
                {[
                  ...ACTIVITY_METRICS,
                  ...(cities ? CITIES_ACTIVITY_METRICS : []),
                ].map(([key, label]) => (
                  <TableRow key={key}>
                    <TableCell>
                      <MetricLabel
                        metric={key}
                        label={metricLabel(key, label)}
                        cities={cities}
                      />
                    </TableCell>
                    {stats.players.map((row, seat) => (
                      <TableCell key={seat}>{row.activity[key] ?? 0}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="muted">Builds count actions after starting placement, including free roads. A dash means this action was not recorded for this game.</p>
        </TabsContent>
        <TabsContent value="resources">
          {stats && (
            <>
              <Table>
                <TableHeader>{headings()}</TableHeader>
                <TableBody>
                  {RESOURCE_METRICS.map(([key, label]) => (
                    <TableRow key={key}>
                      <TableCell>
                        <MetricLabel
                          metric={key}
                          label={metricLabel(key, label)}
                          cities={cities}
                        />
                      </TableCell>
                      {stats.players.map((row, seat) => (
                        <TableCell key={seat}>{row.resources[key]}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="muted">
                Resource score is income minus cards lost to discards, robbery,
                {cities ? "progress cards" : "development cards"} and trading.
                Construction spending is shown separately.
              </p>
              <Table>
                <TableHeader>{headings()}</TableHeader>
                <TableBody>
                  {(cities ? GOODS : RESOURCES).map((good) => (
                    <TableRow key={good}>
                      <TableCell>
                        <img
                          className="stats-good"
                          src={goodImage(good)}
                          alt=""
                        />
                        {GOOD_LABELS[good]} received
                      </TableCell>
                      {stats.players.map((row, seat) => (
                        <TableCell key={seat}>{row.received[good]}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </TabsContent>
        <TabsContent value="cards">
          {stats && cities && (
            <>
              <label htmlFor="progress-statistic">
                Progress-card statistic
              </label>
              <NativeSelect
                id="progress-statistic"
                value={cardMetric}
                onChange={(event) =>
                  setCardMetric(event.target.value as typeof cardMetric)
                }
              >
                <option value="cardsBought">Drawn</option>
                <option value="cardsUsed">Played</option>
                <option value="cardsStolen">Stolen with Spy</option>
                <option value="cardsLost">Lost to Spy</option>
                <option value="cardsDiscarded">Discarded</option>
              </NativeSelect>
              <p className="muted">
                Printer and Constitution score when drawn. Spy transfers and
                limit discards are counted separately from draws and plays.
              </p>
              <Table>
                <TableHeader>{headings()}</TableHeader>
                <TableBody>
                  {TRACKS.flatMap((track) =>
                    Object.keys(PROGRESS_COUNTS[track]).map((kind) => (
                      <TableRow key={kind}>
                        <TableCell>
                          <img
                            className="stats-good"
                            src={progressImage({
                              id: 0,
                              kind: kind as ProgressKind,
                              track,
                            })}
                            alt=""
                          />
                          {PROGRESS_LABELS[kind as ProgressKind]}{" "}
                          <span className="muted">({track})</span>
                        </TableCell>
                        {stats.players.map((row: PlayerStatistics, seat) => (
                          <TableCell key={seat}>
                            {row[cardMetric]?.[kind] ?? 0}
                          </TableCell>
                        ))}
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            </>
          )}
          {stats && !cities && (
            <Table>
              <TableHeader>{headings()}</TableHeader>
              <TableBody>
                {CARDS.flatMap(([kind, label, asset]) =>
                  ["bought", "played"].map((action) => (
                    <TableRow key={`${kind}-${action}`}>
                      <TableCell>
                        <img
                          className="stats-good"
                          src={ASSETS[`card_${asset}`]}
                          alt=""
                        />
                        {label} {action}
                      </TableCell>
                      {stats.players.map((row, seat) => (
                        <TableCell key={seat}>
                          {(action === "bought"
                            ? row.cardsBought
                            : row.cardsUsed)[kind] ?? 0}
                        </TableCell>
                      ))}
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          )}
        </TabsContent>
        <TabsContent value="points">
          <PointsGraph game={game} />
        </TabsContent>
      </Tabs>}
    </div>
  );
}
