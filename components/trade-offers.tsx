"use client";
import {
  Action,
  PublicOffer,
  View,
  total,
  tradeExecutor,
  tradeEligible,
  tradePartners,
  tradeBlocked,
} from "@/lib/game";
import { useEffect, useState } from "react";
import { RESOURCES } from "@/lib/board";
import { GOODS } from "@/lib/cities-knights";
import type { GameHand } from "@/lib/cities-room";
import { GOOD_LABELS, goodImage } from "@/lib/goods-ui";
import { COLORS } from "@/lib/board";
import { avatarAsset, botAvatarAsset } from "@/lib/avatars";
import { tradePerspective } from "@/lib/trading";
import { Button } from "./ui/button";
import {
  Check,
  X,
  ArrowDown,
  ArrowUp,
  ArrowLeftRight,
  Pencil,
  Clock,
  Ban,
  Minus,
  UsersRound,
} from "lucide-react";
function Avatar({ game, seat }: { game: View; seat: number }) {
  const p = game.players[seat];
  return (
    <span
      className="proposal-avatar"
      style={{ backgroundColor: COLORS[p.color] }}
      title={p.name}
    >
      <img
        src={
          p.bot || game.botPlayers.includes(seat)
            ? botAvatarAsset(p.color)
            : avatarAsset(p.avatar)
        }
        alt=""
      />
    </span>
  );
}
function Cards({
  hand,
  label,
  receive,
  game,
  seat,
}: {
  hand: GameHand;
  label: string;
  receive: boolean;
  game: View;
  seat: number | null;
}) {
  return (
    <div
      className={`offer-cards ${receive ? "proposal-want-cards" : "proposal-give-cards"}`}
      aria-label={label}
      title={label}
    >
      {seat !== null ? (
        <Avatar game={game} seat={seat} />
      ) : (
        <span className="proposal-target" title="Trade recipients">
          <UsersRound aria-label="Trade recipients" />
        </span>
      )}
      {receive ? (
        <ArrowDown className="proposal-receive-arrow" aria-hidden="true" />
      ) : (
        <ArrowUp className="proposal-give-arrow" aria-hidden="true" />
      )}
      <div className="proposal-card-resources">
        {!total(hand) ? (
          <span
            className="proposal-any"
            title="Any resources — make a counteroffer"
          >
            ?
          </span>
        ) : (
          GOODS.filter((r) => hand[r]).map((r) => (
            <span className="offer-card" key={r}>
              <img src={goodImage(r)} alt={GOOD_LABELS[r]} />
              <strong aria-label={`${hand[r]} cards`}>{hand[r]}</strong>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
function ResponseTimer({
  deadline,
  duration,
  serverTime,
  pausedAt,
  expired,
  outgoing = false,
}: {
  deadline: number | null;
  duration: number | null;
  serverTime: number;
  pausedAt: number | null;
  expired: boolean;
  outgoing?: boolean;
}) {
  const [sample, setSample] = useState({ serverTime, elapsed: 0 });
  useEffect(() => {
    if (deadline === null || pausedAt !== null || expired) return;
    const started = Date.now();
    const t = setInterval(() => setSample({ serverTime, elapsed: Date.now() - started }), 100);
    return () => clearInterval(t);
  }, [serverTime, deadline, pausedAt, expired]);
  const now = sample.serverTime === serverTime
    ? serverTime + sample.elapsed
    : serverTime;
  if (!expired && (deadline === null || duration === null)) return null;
  const remaining = expired ? 0 : Math.max(0, deadline! - (pausedAt ?? now));
  const progress = expired || duration === 0
    ? 1
    : Math.max(0, Math.min(1, 1 - remaining / duration!));
  const seconds = Math.ceil(remaining / 1000);
  return (
    <span
      className="proposal-response-timer"
      role="progressbar"
      aria-label="Trade response time"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-valuetext={expired ? "Trade response time expired" : `${seconds} seconds remaining${pausedAt !== null ? ", paused" : ""}`}
      title={expired ? "Trade response time expired" : `${outgoing ? "Responses due" : "Auto-decline"} in ${seconds}s${pausedAt !== null ? " (paused)" : ""}`}
    >
      <svg viewBox="0 0 30 30" aria-hidden="true">
        <path className="proposal-timer-track" d="M15 2H23Q28 2 28 7V23Q28 28 23 28H7Q2 28 2 23V7Q2 2 7 2Z" />
        <path className="proposal-timer-fill" d="M15 2H23Q28 2 28 7V23Q28 28 23 28H7Q2 28 2 23V7Q2 2 7 2Z" pathLength="100" strokeDasharray="100" strokeDashoffset={100 * (1 - progress)} />
      </svg>
    </span>
  );
}
export default function TradeOffers({
  game: g,
  busy,
  send,
  edit,
  counter,
}: {
  game: View;
  busy: boolean;
  send: (a: Action) => Promise<boolean>;
  edit: (o: PublicOffer) => void;
  counter: (o: PublicOffer) => void;
}) {
  if (!g.offers.length) return null;
  const hand = g.players[g.me]?.hand;
  const canPay = (h: GameHand) =>
    !!hand &&
    (g.cities ? GOODS : RESOURCES).every((r) => (hand[r] ?? 0) >= (h[r] ?? 0));
  return (
    <section className="panel offers proposed-trades" data-many-responses={g.players.length > 8} aria-label="Trade offers">
      <h3 className="sr-only">Trade Offers</h3>
      <div className="proposal-list" tabIndex={0} aria-label="Proposed trades">
        {g.offers.map((o) => {
          const executor = tradeExecutor(o, g.active);
          const perspective = tradePerspective(o, g.active, g.me);
          const isExecutor = executor === g.me;
          const eligible = g.me >= 0 && tradeEligible(g, o, g.me);
          const blocked =
            g.me >= 0 && tradeBlocked(g, g.me, isExecutor ? o.from : executor);
          const partners = [
            ...new Set(
              executor !== o.from ? [o.from, ...o.accepted] : o.accepted,
            ),
          ].filter((p) => !tradeBlocked(g, executor, p));
          const recipients = tradePartners(g, o);
          const responseSeats = g.players
            .map((_, i) => i)
            .filter((i) => i !== executor);
          const timerPausedAt = Math.min(
            g.pause.pausedAt ?? Infinity,
            o.pausedAt ?? Infinity,
          );
          const timedResponse = o.responseDeadline !== null && (o.from === g.me || !o.preparing.includes(g.me));
          return (
            <article
              key={o.id}
              className="offer"
              aria-label={`Offer ${o.id} from ${g.players[o.from].name}`}
            >
              <strong className="sr-only">{g.players[o.from].name}</strong>
              <span className="sr-only">
                {" "}
                {executor !== o.from
                  ? `for ${g.players[executor].name}`
                  : o.targets === null
                    ? "to anyone"
                    : `to ${o.targets.map((i) => g.players[i].name).join(", ")}`}
              </span>
              {o.replyTo !== null && (
                <p className="offer-counter-label">
                  Counteroffer to #{o.replyTo}
                </p>
              )}
              <Cards
                hand={perspective.receive}
                label={g.me < 0 ? "Proposer receives" : "You receive"}
                receive
                game={g}
                seat={perspective.receiveFrom}
              />
              <div className="proposal-give-row">
                <Cards
                  hand={perspective.give}
                  label={g.me < 0 ? "Proposer gives" : "You give"}
                  receive={false}
                  game={g}
                  seat={perspective.giveFrom}
                />
                <ul className="offer-responses" aria-live="polite">
                  {responseSeats.map((i) => {
                    const p = g.players[i];
                    const included = recipients.includes(i);
                    const status = !included
                      ? "Not included"
                      : o.blocked.includes(i)
                        ? "Blocked"
                        : executor !== o.from && i === o.from
                          ? "Offered"
                          : o.preparing.includes(i)
                            ? "Preparing counteroffer"
                            : o.accepted.includes(i)
                              ? "Accepted"
                              : o.rejected.includes(i)
                                ? o.expired.includes(i)
                                  ? "Timed out"
                                  : "Declined"
                                : "Waiting";
                    const ResponseIcon = !included
                      ? Minus
                      : o.blocked.includes(i)
                        ? Ban
                        : o.accepted.includes(i) ||
                            (executor !== o.from && i === o.from)
                          ? Check
                          : o.rejected.includes(i)
                            ? X
                            : o.preparing.includes(i)
                              ? ArrowLeftRight
                              : Clock;
                    const responseClass = `proposal-response ${o.rejected.includes(i) || o.blocked.includes(i) ? "proposal-response-muted" : ""}`;
                    const responseStyle = {
                      backgroundColor: COLORS[p.color],
                      color: p.color === 3 ? "#234254" : "#fff",
                    };
                    return (
                      <li key={i} data-player-seat={i} data-response={status}>
                        {included && isExecutor && partners.includes(i) ? (
                          <Button
                            className={`${responseClass} proposal-confirm`}
                            aria-label={`Trade with ${p.name}`}
                            title={`${p.name}: ${status} — click to confirm trade`}
                            style={responseStyle}
                            size="sm"
                            disabled={
                              busy ||
                              g.phase !== "action" ||
                              !total(o.give) ||
                              !total(o.want) ||
                              !canPay(executor === o.from ? o.give : o.want)
                            }
                            onClick={() =>
                              send({ type: "completeTrade", id: o.id, to: i })
                            }
                          >
                            <Check aria-hidden="true" />
                          </Button>
                        ) : (
                          <span
                            className={responseClass}
                            style={responseStyle}
                            title={`${p.name}: ${status}`}
                          >
                            <ResponseIcon aria-hidden="true" />
                            <span className="sr-only">
                              {p.name}: {status}
                            </span>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="trade-buttons">
                {eligible && !isExecutor && (
                  <>
                    <Button
                      className="proposal-action proposal-accept"
                      aria-label={
                        o.accepted.includes(g.me) ? "Accepted" : "Accept"
                      }
                      title="Accept trade"
                      size="sm"
                      disabled={
                        busy ||
                        g.phase !== "action" ||
                        blocked ||
                        !canPay(executor === o.from ? o.want : o.give) ||
                        !total(o.give) ||
                        !total(o.want) ||
                        o.accepted.includes(g.me)
                      }
                      onClick={() => send({ type: "accept", id: o.id })}
                    >
                      <Check aria-hidden="true" />
                    </Button>
                    <Button
                      className={`proposal-action proposal-decline ${timedResponse || o.expired.includes(g.me) ? "proposal-timed-decline" : ""}`}
                      aria-label="Decline"
                      title="Decline trade"
                      size="sm"
                      variant="secondary"
                      disabled={
                        busy ||
                        blocked ||
                        g.phase !== "action" ||
                        o.rejected.includes(g.me)
                      }
                      onClick={() => send({ type: "reject", id: o.id })}
                    >
                      <X aria-hidden="true" />
                      {(timedResponse || o.expired.includes(g.me)) && (
                        <ResponseTimer
                          deadline={o.responseDeadline}
                          duration={o.responseDuration}
                          serverTime={g.serverTime}
                          pausedAt={Number.isFinite(timerPausedAt) ? timerPausedAt : null}
                          expired={o.expired.includes(g.me)}
                        />
                      )}
                    </Button>
                  </>
                )}
                {eligible && isExecutor && (
                  <Button
                    className={`proposal-action proposal-decline ${timedResponse ? "proposal-timed-decline" : ""}`}
                    aria-label="Decline Counteroffer"
                    title="Decline counteroffer"
                    size="sm"
                    variant="secondary"
                    disabled={busy || blocked || g.phase !== "action"}
                    onClick={() => send({ type: "reject", id: o.id })}
                  >
                    <X aria-hidden="true" />
                    {timedResponse && (
                      <ResponseTimer
                        deadline={o.responseDeadline}
                        duration={o.responseDuration}
                        serverTime={g.serverTime}
                        pausedAt={Number.isFinite(timerPausedAt) ? timerPausedAt : null}
                        expired={false}
                      />
                    )}
                  </Button>
                )}
                {eligible && (
                  <Button
                    className="proposal-action"
                    aria-label="Counteroffer"
                    title="Counteroffer"
                    size="sm"
                    variant="secondary"
                    disabled={
                      busy ||
                      blocked ||
                      g.phase !== "action" ||
                      !hand ||
                      !total(hand)
                    }
                    onClick={() => counter(o)}
                  >
                    <ArrowLeftRight aria-hidden="true" />
                  </Button>
                )}
                {o.from === g.me && (
                  <>
                    <Button
                      className="proposal-action"
                      aria-label="Edit"
                      title="Edit offer"
                      size="sm"
                      variant="secondary"
                      disabled={busy || g.phase !== "action"}
                      onClick={() => edit(o)}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      className={`proposal-action proposal-decline ${timedResponse ? "proposal-timed-decline" : ""}`}
                      aria-label="Cancel Offer"
                      title="Cancel offer"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => send({ type: "cancelOffer", id: o.id })}
                    >
                      <X aria-hidden="true" />
                      {timedResponse && (
                        <ResponseTimer
                          deadline={o.responseDeadline}
                          duration={o.responseDuration}
                          serverTime={g.serverTime}
                          pausedAt={Number.isFinite(timerPausedAt) ? timerPausedAt : null}
                          expired={false}
                          outgoing
                        />
                      )}
                    </Button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
