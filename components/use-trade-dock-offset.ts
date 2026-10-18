"use client";
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

export function useTradeDockOffset(dock: RefObject<HTMLDivElement | null>, active: boolean) {
  const [bottom, setBottom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!active || !dock.current) return;
    const element = dock.current;
    const hand = element.querySelector<HTMLElement>(".hand");
    const measure = () => {
      // On narrow screens the hand floats at the bottom, outside the dock's flow.
      const anchor = window.innerWidth <= 800 && hand ? hand : element;
      setBottom(Math.max(0, Math.ceil(window.innerHeight - anchor.getBoundingClientRect().top + 8)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (hand) observer.observe(hand);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [active, dock]);
  return bottom === null ? undefined : { "--trade-dock-bottom": `${bottom}px` } as CSSProperties;
}
