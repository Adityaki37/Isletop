"use client";
import { RESOURCES } from "@/lib/board";
import type { Good } from "@/lib/cities-knights";
import type { GameHand } from "@/lib/cities-room";
import { GOOD_LABELS, goodImage } from "@/lib/goods-ui";
import { Input } from "./ui/input";
export default function GoodsCounters({
  value,
  setValue,
  max,
  title,
  goods = RESOURCES,
}: {
  value: GameHand;
  setValue: (h: GameHand) => void;
  max: GameHand;
  title: string;
  goods?: readonly Good[];
}) {
  return (
    <div>
      <h3>{title}</h3>
      <div className="resource-inputs">
        {goods.map((r) => (
          <label key={r}>
            <img src={goodImage(r)} alt="" />
            <span>{GOOD_LABELS[r]}</span>
            <Input
              type="number"
              min={0}
              max={max[r] ?? 0}
              value={value[r] ?? 0}
              aria-label={`${title} ${GOOD_LABELS[r]}`}
              onChange={(e) =>
                setValue({
                  ...value,
                  [r]: Math.min(
                    max[r] ?? 0,
                    Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  ),
                })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}
