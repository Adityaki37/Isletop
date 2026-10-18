"use client";
import { useEffect, useState } from "react";
import type { Action, View } from "@/lib/game";
import { Button } from "./ui/button";
import { avatarAsset } from "@/lib/avatars";

export default function TablePause({
  game: g,
  busy,
  send,
}: {
  game: View;
  busy: boolean;
  send: (action: Action) => Promise<boolean>;
}) {
  const vote = g.pause.vote;
  const paused = g.pause.pausedAt !== null;
  if (!vote && !paused) return null;
  return (
    <section className="table-pause" aria-label="Pause controls">
      {paused && (
        <div className="pause-status" role="status">
          <strong>Game paused</strong>
          {g.me >= 0 && !vote && (
            <Button
              disabled={busy}
              onClick={() => send({ type: "pauseRequest" })}
            >
              Resume Game
            </Button>
          )}
        </div>
      )}
      {vote && (
        <div className="pause-vote">
          <strong>
            {g.players[vote.creator].name} wants to {vote.target} the game
          </strong>
          <p>
            Everyone must agree.{" "}
            <PauseSeconds until={vote.endsAt} serverTime={g.serverTime} /> left
            to vote.
          </p>
          <ul aria-label="Player votes">
            {g.players.map((player, seat) => (
              <li
                key={seat}
                className={
                  vote.accepted.includes(seat) ? "accepted" : "pending"
                }
              >
                <img
                  src={avatarAsset(player.avatar)}
                  alt=""
                  width={20}
                  height={20}
                />
                <span>
                  {player.name}:{" "}
                  {vote.accepted.includes(seat) ? "Agreed" : "Waiting"}
                </span>
              </li>
            ))}
          </ul>
          {g.me >= 0 && !vote.accepted.includes(g.me) ? (
            <div className="pause-vote-actions">
              <Button
                className="green-button"
                disabled={busy}
                onClick={() =>
                  send({ type: "pauseVote", id: vote.id, accept: true })
                }
              >
                Agree to {vote.target}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  send({ type: "pauseVote", id: vote.id, accept: false })
                }
              >
                Decline
              </Button>
            </div>
          ) : (
            <p>
              {g.me < 0
                ? "Spectators can watch the vote."
                : "Waiting for the other players."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
function PauseSeconds({
  until,
  serverTime,
}: {
  until: number;
  serverTime: number;
}) {
  const [remaining, setRemaining] = useState(
    Math.max(0, Math.ceil((until - serverTime) / 1000)),
  );
  useEffect(() => {
    const received = Date.now();
    const tick = () =>
      setRemaining(
        Math.max(
          0,
          Math.ceil((until - serverTime - (Date.now() - received)) / 1000),
        ),
      );
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [until, serverTime]);
  return <span>{remaining}s</span>;
}
