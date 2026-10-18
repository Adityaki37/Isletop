"use client";

import { useRef, useState, type PointerEvent, type KeyboardEvent, type MouseEvent } from "react";
import Image from "next/image";
import type { Good } from "@/lib/cities-knights";
import { goodImage } from "@/lib/goods-ui";

export type TradeCardSource = "palette" | "hand" | "give" | "receive";
export type TradeCardTarget = "give" | "receive" | "hand" | "outside";
type Gesture = { resource: Good; source: TradeCardSource; pointer: number; x: number; y: number; moved: boolean };

// Pointer capture keeps mouse, pen and touch drags working outside the source card.
export function useTradeCardDrag(onDrop: (resource: Good, source: TradeCardSource, target: TradeCardTarget) => void) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{ resource: Good; x: number; y: number; target: string | null } | null>(null);
  const targetAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-trade-drop]")?.dataset.tradeDrop ?? null;
  const cancel = () => { gesture.current = null; setPreview(null); };
  const bind = (resource: Good, source: TradeCardSource) => ({
    className: "trade-picture-card trade-draggable-card",
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      gesture.current = { resource, source, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const drag = gesture.current;
      if (!drag || event.pointerId !== drag.pointer) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      drag.moved = true;
      setPreview({ resource: drag.resource, x: event.clientX, y: event.clientY, target: targetAt(event.clientX, event.clientY) });
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      const drag = gesture.current;
      if (!drag || event.pointerId !== drag.pointer) return;
      if (drag.moved) {
        suppressClick.current = true;
        const target = targetAt(event.clientX, event.clientY);
        if (target === "give" || target === "receive" || target === "hand") onDrop(drag.resource, drag.source, target);
        else if (drag.source === "give" || drag.source === "receive") onDrop(drag.resource, drag.source, "outside");
      }
      cancel();
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => { if (event.key === "Escape") cancel(); },
    onClickCapture: (event: MouseEvent<HTMLButtonElement>) => {
      if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
      suppressClick.current = false;
    },
  });
  return {
    bind,
    activeZone: preview?.target,
    ghost: preview ? <div className="trade-drag-preview" aria-hidden="true" style={{ left: preview.x, top: preview.y }}><Image src={goodImage(preview.resource)} alt="" width={36} height={48} draggable={false} /></div> : null,
  };
}
