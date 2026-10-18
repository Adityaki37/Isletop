"use client";

import type { Good } from "@/lib/cities-knights";
import type { GameHand } from "@/lib/cities-room";
import { GOOD_LABELS, goodImage } from "@/lib/goods-ui";
import type { useTradeCardDrag } from "./trade-card-drag";

export default function TradeComposer({goods, give, want, setGive, setWant, rates, drag, onReceive, receiveLimits}: {
  goods: readonly Good[]; give: GameHand; want: GameHand;
  setGive: (value: GameHand) => void; setWant: (value: GameHand) => void;
  rates: Partial<Record<Good, number>>;
  drag: ReturnType<typeof useTradeCardDrag>; onReceive: (resource: Good) => void;
  receiveLimits?: Partial<Record<Good, number>>;
}) {
  const selection = (value: GameHand, receiving: boolean) => (
    <div className="trade-selection" aria-label={receiving ? "Cards you receive" : "Cards you give"}>
      <span className="trade-direction" aria-hidden="true">{receiving ? "↓" : "↑"}</span>
      {goods.filter(resource => (value[resource] ?? 0) > 0).map(resource => (
        <button type="button" key={resource} {...drag.bind(resource, receiving ? "receive" : "give")} aria-label={`Remove ${GOOD_LABELS[resource]} from ${receiving ? "You receive" : "You give"}`}
          onClick={() => (receiving ? setWant : setGive)({...value, [resource]: (value[resource] ?? 0) - 1})}>
          <img src={goodImage(resource)} alt="" draggable={false} />
          <strong>{value[resource]}</strong>
          {!receiving && <small>{rates[resource] ?? 4}:1</small>}
        </button>
      ))}
    </div>
  );
  return <div className="trade-composer">
    <section className="trade-resource-palette" aria-label="Choose resources to receive">
      <div className="trade-picture-row">{goods.map(resource => <button key={resource} type="button" {...drag.bind(resource, "palette")}
        aria-label={`Add ${GOOD_LABELS[resource]} to You receive`} title={`Receive ${GOOD_LABELS[resource]}`}
        disabled={(want[resource] ?? 0) >= (receiveLimits?.[resource] ?? 50)} onClick={() => onReceive(resource)}><img src={goodImage(resource)} alt="" draggable={false} /></button>)}</div>
    </section>
    <section data-trade-drop="receive" className={`trade-drop-zone ${drag.activeZone === "receive" ? "trade-drop-active" : ""}`}><h3>You receive</h3>{selection(want, true)}</section>
    <section data-trade-drop="give" className={`trade-drop-zone ${drag.activeZone === "give" ? "trade-drop-active" : ""}`}><h3>You give</h3>{selection(give, false)}</section>
    {drag.ghost}
  </div>;
}
