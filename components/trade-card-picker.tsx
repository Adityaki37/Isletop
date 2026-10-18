"use client";
import type { Good } from "@/lib/cities-knights";
import type { GameHand } from "@/lib/cities-room";
import { GOOD_LABELS, goodImage } from "@/lib/goods-ui";
import { Input } from "./ui/input";
export default function TradeCardPicker({
  title,
  value,
  max,
  goods,
  setValue,
}: {
  title: string;
  value: GameHand;
  max: GameHand;
  goods: readonly Good[];
  setValue: (h: GameHand) => void;
}) {
  const update = (r: Good, n: number) =>
    setValue({
      ...value,
      [r]: Math.min(max[r] ?? 0, Math.max(0, Math.floor(n) || 0)),
    });
  return (
    <fieldset className="trade-card-row">
      <legend>
        <span aria-hidden="true">{title === "You give" ? "↑" : "↓"}</span>{" "}
        {title}
      </legend>
      <div className="trade-card-options">
        {goods
          .filter((r) => title !== "You give" || (max[r] ?? 0) > 0)
          .map((r) => (
            <div className="trade-card-choice" key={r} data-resource={r}>
              <button
                type="button"
                aria-label={`Add ${GOOD_LABELS[r]} to ${title}`}
                disabled={(value[r] ?? 0) >= (max[r] ?? 0)}
                onClick={() => update(r, (value[r] ?? 0) + 1)}
              >
                <img
                  src={goodImage(r)}
                  alt={
                    r === "ore"
                      ? "Ore (stone)"
                      : r === "sheep"
                        ? "Wool (sheep)"
                        : GOOD_LABELS[r]
                  }
                />
                <span>{GOOD_LABELS[r]}</span>
              </button>
              <div className="trade-card-quantity">
                <button
                  type="button"
                  aria-label={`Remove ${GOOD_LABELS[r]} from ${title}`}
                  disabled={!value[r]}
                  onClick={() => update(r, (value[r] ?? 0) - 1)}
                >
                  −
                </button>
                <Input
                  aria-label={`${title} ${GOOD_LABELS[r]}`}
                  type="number"
                  min={0}
                  max={max[r] ?? 0}
                  value={value[r] ?? 0}
                  onChange={(e) => update(r, Number(e.target.value))}
                />
                <button
                  type="button"
                  aria-label={`Increase ${GOOD_LABELS[r]} in ${title}`}
                  disabled={(value[r] ?? 0) >= (max[r] ?? 0)}
                  onClick={() => update(r, (value[r] ?? 0) + 1)}
                >
                  +
                </button>
              </div>
            </div>
          ))}
      </div>
    </fieldset>
  );
}
