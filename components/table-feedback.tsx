"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { View } from "@/lib/game";
import type { ProductionFeedback, ResourceTransfer } from "@/lib/production-feedback";
import { ASSETS } from "@/lib/assets";
import { COLORS } from "@/lib/board";
import { CITIES_ASSETS } from "@/lib/cities-assets";
import { goodImage, GOOD_LABELS } from "@/lib/goods-ui";

export function TableDice({ game, lastDice = [], animationKey, pending, canRoll, onRoll }: {
  game: View; lastDice?: number[]; animationKey: string | null; pending: boolean;
  canRoll: boolean; onRoll: () => void;
}) {
  const faces = game.dice.length ? game.dice : lastDice;
  return <div className={`dice${pending ? " dice-pending" : ""}`} aria-label={game.dice.length ? "Dice result" : faces.length ? "Previous dice result" : "Dice result"} aria-busy={pending}>
    {!pending && faces.length === 2 && <strong key={`total:${animationKey ?? "initial"}`}
      className={`dice-total${animationKey ? " dice-total-reveal" : ""}`}
      aria-label={`Total ${faces[0] + faces[1]}`}>{faces[0] + faces[1]}</strong>}
    <div key={`faces:${animationKey ?? "initial"}`} className={`dice-faces${animationKey ? " dice-tumble" : ""}`}>
      {(faces.length ? faces : pending || game.phase === "roll" ? [1, 1] : []).map((n, i) =>
        <button key={i} type="button" className="dice-roll-button"
          aria-label={`Roll dice using die ${i + 1}`} title={canRoll ? "Roll dice" : undefined}
          disabled={!canRoll || pending} onClick={onRoll}>
        <img src={game.cities && i === 1 ? CITIES_ASSETS[`dice_red_${n}`] : ASSETS[`dice_${n}`]}
          alt={pending ? "Rolling" : !faces.length ? "Ready to roll" : `${game.cities && i === 1 ? "Red die" : "Die"} ${n}`} />
        </button>)}
      {game.cities?.event && <img src={CITIES_ASSETS[`dice_event_${game.cities.event}`]} alt={`Event ${game.cities.event}`} />}
    </div>
  </div>;
}

type Flight = ResourceTransfer & { x: number; y: number; dx: number; dy: number };
export function ResourceDelivery({ game, feedback }: { game: View; feedback: ProductionFeedback }) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = requestAnimationFrame(() => {
      if (reduced) return;
      setFlights(feedback.transfers.flatMap((transfer) => {
        const target = transfer.seat === game.me
          ? document.querySelector(`.game-dock [data-hand-card="${transfer.good}"]`) ?? document.querySelector(".game-dock .hand")
          : document.querySelector(`.game-roster [data-player-seat="${transfer.seat}"]`);
        const origin = transfer.tile === null ? document.querySelector(".game-sidebar .bank")
          : document.querySelector(`.board-stage [data-board-tile="${transfer.tile}"] [data-terrain-hex]`);
        if (!target || !origin) return [];
        const a = origin.getBoundingClientRect(), b = target.getBoundingClientRect();
        const x = a.left + a.width / 2, y = a.top + a.height / 2;
        return [{ ...transfer, x, y, dx: b.left + b.width / 2 - x, dy: b.top + b.height / 2 - y }];
      }));
    });
    const hideFlights = setTimeout(() => setFlights([]), 6000);
    const hideReceipt = setTimeout(() => setVisible(false), 6500);
    const resize = () => setFlights([]);
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(frame); clearTimeout(hideFlights); clearTimeout(hideReceipt); window.removeEventListener("resize", resize); };
  }, [feedback, game.me]);
  const recipients = game.players.map((player, seat) => {
    const cards = feedback.transfers.filter(t => t.seat === seat);
    if (!cards.length) return null;
    const goods = [...new Set(cards.map(t => t.good))];
    return <span key={seat} className="resource-recipient"><strong style={{ color: player.color === 3 ? "#637078" : COLORS[player.color] }}>{player.name}</strong>
      {goods.map(good => <span key={good} title={GOOD_LABELS[good]}><img src={goodImage(good)} alt={GOOD_LABELS[good]} />
        +{cards.filter(t => t.good === good).reduce((sum, t) => sum + t.amount, 0)}</span>)}</span>;
  });
  return <>
    {visible && feedback.transfers.length > 0 && <div className="production-receipt" role="status" aria-label="Resource distribution">
      {recipients}
    </div>}
    {flights.length > 0 && createPortal(<div className="resource-flights" aria-hidden="true">
      {flights.map((flight, index) => <span key={index} className="resource-flight" data-card={flight.good}
        data-card-to={flight.seat === game.me ? "hand" : `player-${flight.seat}`} style={{
        left: flight.x, top: flight.y, "--flight-x": `${flight.dx}px`, "--flight-y": `${flight.dy}px`,
        animationDelay: `${(index % 5) * 195 + (feedback.source === "dice" ? 500 : 0)}ms`,
      } as CSSProperties}><img src={goodImage(flight.good)} alt="" /><b>+{flight.amount}</b></span>)}
    </div>, document.body)}
  </>;
}
