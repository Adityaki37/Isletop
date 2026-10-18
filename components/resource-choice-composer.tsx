"use client";

import Image from "next/image";
import { RESOURCES, type Hand, type Resource } from "@/lib/board";
import { GOOD_LABELS, goodImage } from "@/lib/goods-ui";
import type { useTradeCardDrag } from "./trade-card-drag";

export default function ResourceChoiceComposer({ selection, bank, monopoly, busy, drag, add, remove }: {
  selection: Hand;
  bank: Hand | null;
  monopoly: boolean;
  busy: boolean;
  drag: ReturnType<typeof useTradeCardDrag>;
  add: (resource: Resource) => void;
  remove: (resource: Resource) => void;
}) {
  const count = RESOURCES.reduce((sum, resource) => sum + selection[resource], 0);
  return (
    <div className="trade-composer resource-choice-composer">
      <section className="trade-resource-palette" aria-label={monopoly ? "Choose Monopoly resource" : "Choose resources from bank"}>
        <div className="trade-picture-row">
          {RESOURCES.map(resource => (
            <button key={resource} type="button" {...drag.bind(resource, "palette")}
              aria-label={`Choose ${GOOD_LABELS[resource]}`}
              aria-pressed={selection[resource] > 0}
              title={GOOD_LABELS[resource]}
              disabled={busy || (!monopoly && (count >= 2 || (bank !== null && selection[resource] >= bank[resource])))}
              onClick={() => add(resource)}>
              <Image src={goodImage(resource)} alt="" width={36} height={48} draggable={false} />
            </button>
          ))}
        </div>
      </section>
      <section data-trade-drop="receive" className={`trade-drop-zone ${drag.activeZone === "receive" ? "trade-drop-active" : ""}`}>
        <h3>{monopoly ? "Collect" : "You receive"}</h3>
        <div className="trade-selection" aria-label="Cards you receive">
          <span className="trade-direction" aria-hidden="true">↓</span>
          {RESOURCES.filter(resource => selection[resource] > 0).map(resource => (
            <button key={resource} type="button" {...drag.bind(resource, "receive")}
              disabled={busy} aria-label={`Remove ${GOOD_LABELS[resource]} from selection`}
              onClick={() => remove(resource)}>
              <Image src={goodImage(resource)} alt="" width={36} height={48} draggable={false} />
              {!monopoly && <strong>{selection[resource]}</strong>}
            </button>
          ))}
        </div>
      </section>
      {drag.ghost}
    </div>
  );
}
