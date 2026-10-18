"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { CardEndpoint, CardFeedback, CardTransfer } from "@/lib/card-feedback";
import { ASSETS } from "@/lib/assets";
import { goodImage } from "@/lib/goods-ui";

type Flight = { transfer: CardTransfer; x: number; y: number; dx: number; dy: number; amount: number };
function cardAnchor(endpoint: CardEndpoint, card: CardTransfer["card"], me: number) {
  if (endpoint.type === "tile") return document.querySelector(`.board-stage [data-board-tile="${endpoint.tile}"] [data-terrain-hex]`);
  if (endpoint.type === "bank") return document.querySelector(`[data-bank-card="${card}"]`);
  if (endpoint.seat === me) {
    const cards = document.querySelectorAll(`.game-dock [data-hand-card="${card}"]`);
    return cards.item(cards.length - 1) ?? document.querySelector(".game-dock .hand");
  }
  return document.querySelector(`.game-roster [data-player-seat="${endpoint.seat}"]`);
}

export default function CardExchange({ feedback, me }: { feedback: CardFeedback; me: number }) {
  const [flights, setFlights] = useState<Flight[]>([]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const next = feedback.transfers.flatMap(transfer => {
        const origin = cardAnchor(transfer.from, transfer.card, me), target = cardAnchor(transfer.to, transfer.card, me);
        if (!origin || !target) return [];
        const a = origin.getBoundingClientRect(), b = target.getBoundingClientRect();
        const x = a.left + a.width / 2, y = a.top + a.height / 2;
        return Array.from({ length: Math.min(transfer.amount, 8) }, (_, index) => ({
          transfer, x, y, dx: b.left + b.width / 2 - x, dy: b.top + b.height / 2 - y,
          amount: index === 7 ? transfer.amount - 7 : 1,
        }));
      });
      setFlights(next.slice(0, 48));
    });
    const clear = () => setFlights([]);
    const timer = setTimeout(clear, 7200);
    window.addEventListener("resize", clear);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); window.removeEventListener("resize", clear); };
  }, [feedback, me]);
  return flights.length ? createPortal(<div className="resource-flights card-exchange-flights" data-card-animation={feedback.source} aria-hidden="true">
    {flights.map((flight, index) => <span key={index} className="resource-flight" data-card={flight.transfer.card}
      data-card-from={flight.transfer.from.type === "player" ? `player-${flight.transfer.from.seat}` : flight.transfer.from.type}
      data-card-to={flight.transfer.to.type === "player" ? `player-${flight.transfer.to.seat}` : flight.transfer.to.type}
      style={{ left: flight.x, top: flight.y, "--flight-x": `${flight.dx}px`, "--flight-y": `${flight.dy}px`, animationDelay: `${(index % 12) * 210}ms` } as CSSProperties}>
      <img src={flight.transfer.card === "development" ? ASSETS.card_devcardback : flight.transfer.card === "hidden" ? ASSETS.card_rescardback : goodImage(flight.transfer.card)} alt="" />
      {flight.amount > 1 && <b>×{flight.amount}</b>}
    </span>)}
  </div>, document.body) : null;
}
