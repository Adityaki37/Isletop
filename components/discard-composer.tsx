"use client";

import type { Good } from "@/lib/cities-knights";
import type { GameHand } from "@/lib/cities-room";
import { GOOD_LABELS, goodImage } from "@/lib/goods-ui";
import type { useTradeCardDrag } from "./trade-card-drag";

export default function DiscardComposer({ goods, selection, remove, drag, busy }: {
  goods: readonly Good[];
  selection: GameHand;
  remove: (resource: Good) => void;
  drag: ReturnType<typeof useTradeCardDrag>;
  busy: boolean;
}) {
  return (
    <div className="trade-composer discard-composer">
      <section data-trade-drop="give" aria-label="Discard cards"
        className={`trade-drop-zone ${drag.activeZone === "give" ? "trade-drop-active" : ""}`}>
        <h3>Discard</h3>
        <div className="trade-selection" aria-label="Selected discard cards">
          <span className="trade-direction" aria-hidden="true">↑</span>
          {goods.filter(resource => (selection[resource] ?? 0) > 0).map(resource => (
            <button type="button" key={resource} {...drag.bind(resource, "give")}
              disabled={busy} aria-label={`Remove ${GOOD_LABELS[resource]} from discard`}
              onClick={() => remove(resource)}>
              <img src={goodImage(resource)} alt="" draggable={false} />
              <strong>{selection[resource]}</strong>
            </button>
          ))}
        </div>
      </section>
      {drag.ghost}
    </div>
  );
}
