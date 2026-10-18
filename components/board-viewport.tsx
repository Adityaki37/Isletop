"use client";
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent, PointerEvent, ReactNode, Ref } from "react";
import { Button } from "./ui/button";
import {
  FIT_BOARD_CAMERA,
  MAX_BOARD_ZOOM,
  MIN_BOARD_ZOOM,
  boundedCamera,
  panCamera,
  pinchCamera,
  wheelZoom,
  zoomCamera,
} from "@/lib/board-navigation";
import type {
  BoardCamera,
  BoardPoint,
  BoardSize,
} from "@/lib/board-navigation";

export type BoardNavigationHandle = {
  zoomBy: (amount: number) => void;
  fit: () => void;
  focus: () => void;
};
type Pointer = BoardPoint & { target: Element };
type Gesture =
  | { kind: "pan"; id: number; start: BoardPoint; camera: BoardCamera }
  | {
      kind: "pinch";
      ids: [number, number];
      start: BoardPoint;
      distance: number;
      camera: BoardCamera;
    };
const middle = (a: BoardPoint, b: BoardPoint) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const distance = (a: BoardPoint, b: BoardPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export default function BoardViewport({
  children,
  className = "",
  showControls = true,
  ref,
}: {
  children: ReactNode;
  className?: string;
  showControls?: boolean;
  ref?: Ref<BoardNavigationHandle>;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    current = useRef<BoardCamera>({ ...FIT_BOARD_CAMERA });
  const pointers = useRef(new Map<number, Pointer>()),
    gesture = useRef<Gesture | null>(null);
  const moved = useRef(false),
    suppressClickUntil = useRef(0);
  const [camera, setCamera] = useState<BoardCamera>({ ...FIT_BOARD_CAMERA }),
    [dragging, setDragging] = useState(false);
  const hint = useId();
  const size = useCallback((): BoardSize => {
    const rect = viewport.current?.getBoundingClientRect();
    const width = rect?.width ?? 0, height = rect?.height ?? 0;
    const svg = viewport.current?.querySelector<SVGSVGElement>(".island");
    const box = svg?.viewBox.baseVal;
    if (!svg || !box?.width || !box.height) return { width, height };
    // The canvas leaves space around the island for panning at fit zoom.
    // Use the untransformed SVG size, rather than the outer camera frame.
    const fitScale = Math.min(svg.clientWidth / box.width, svg.clientHeight / box.height);
    return { width, height, contentWidth: box.width * fitScale, contentHeight: box.height * fitScale };
  }, []);
  const point = useCallback((p: BoardPoint): BoardPoint => {
    const rect = viewport.current!.getBoundingClientRect();
    return {
      x: p.x - rect.left - rect.width / 2,
      y: p.y - rect.top - rect.height / 2,
    };
  }, []);
  const commit = useCallback((next: BoardCamera) => {
    current.current = next;
    setCamera(next);
  }, []);
  const rebase = useCallback(() => {
    const entries = [...pointers.current.entries()];
    if (entries.length >= 2) {
      const [[aId, a], [bId, b]] = entries;
      gesture.current = {
        kind: "pinch",
        ids: [aId, bId],
        start: point(middle(a, b)),
        distance: Math.max(1, distance(a, b)),
        camera: current.current,
      };
    } else if (entries.length) {
      const [id, p] = entries[0];
      gesture.current = {
        kind: "pan",
        id,
        start: { x: p.x, y: p.y },
        camera: current.current,
      };
    } else gesture.current = null;
  }, [point]);
  const fit = useCallback(() => {
    for (const [id, p] of pointers.current) {
      if (p.target.hasPointerCapture(id)) p.target.releasePointerCapture(id);
    }
    pointers.current.clear();
    gesture.current = null;
    moved.current = false;
    setDragging(false);
    commit({ ...FIT_BOARD_CAMERA });
  }, [commit]);
  const zoomBy = useCallback(
    (amount: number) => {
      commit(
        zoomCamera(
          current.current,
          current.current.zoom + amount,
          { x: 0, y: 0 },
          size(),
        ),
      );
      rebase();
    },
    [commit, rebase, size],
  );
  useImperativeHandle(
    ref,
    () => ({ fit, zoomBy, focus: () => viewport.current?.focus() }),
    [fit, zoomBy],
  );
  useEffect(() => {
    const node = viewport.current!;
    // React's wheel listener is passive. This scoped native listener prevents
    // the page/browser from also zooming when the board handles a wheel/pinch.
    const wheel = (event: WheelEvent) => {
      if (pointers.current.size) return;
      event.preventDefault();
      commit(
        zoomCamera(
          current.current,
          wheelZoom(current.current, event.deltaY, event.deltaMode, size()),
          point({ x: event.clientX, y: event.clientY }),
          size(),
        ),
      );
    };
    node.addEventListener("wheel", wheel, { passive: false });
    const observer = new ResizeObserver(() =>
      commit(boundedCamera(current.current, size())),
    );
    observer.observe(node);
    return () => {
      node.removeEventListener("wheel", wheel);
      observer.disconnect();
    };
  }, [commit, point, size]);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!pointers.current.size) {
      moved.current = false;
      suppressClickUntil.current = 0;
    }
    const target = event.target as Element;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      target,
    });
    // Capture the actual SVG target so a normal tap still clicks its button.
    // Capturing the viewport itself would retarget settlement/road taps.
    target.setPointerCapture(event.pointerId);
    rebase();
    if (pointers.current.size >= 2) {
      moved.current = true;
      setDragging(true);
    }
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(event.pointerId),
      g = gesture.current;
    if (!p || !g) return;
    p.x = event.clientX;
    p.y = event.clientY;
    if (g.kind === "pinch") {
      const a = pointers.current.get(g.ids[0]),
        b = pointers.current.get(g.ids[1]);
      if (!a || !b) return;
      event.preventDefault();
      commit(
        pinchCamera(
          g.camera,
          g.start,
          point(middle(a, b)),
          distance(a, b) / g.distance,
          size(),
        ),
      );
    } else if (event.pointerId === g.id) {
      const delta = { x: p.x - g.start.x, y: p.y - g.start.y };
      if (!moved.current && Math.hypot(delta.x, delta.y) < 6) return;
      moved.current = true;
      setDragging(true);
      event.preventDefault();
      commit(panCamera(g.camera, delta, size()));
    }
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (moved.current) suppressClickUntil.current = performance.now() + 500;
    rebase();
    if (!pointers.current.size) setDragging(false);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    const delta: Record<string, BoardPoint> = {
      ArrowLeft: { x: 40, y: 0 },
      ArrowRight: { x: -40, y: 0 },
      ArrowUp: { x: 0, y: 40 },
      ArrowDown: { x: 0, y: -40 },
    };
    if (delta[event.key])
      commit(panCamera(current.current, delta[event.key], size()));
    else if (event.key === "+" || event.key === "=") zoomBy(0.25);
    else if (event.key === "-") zoomBy(-0.25);
    else if (event.key === "Home") fit();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div className={`board-navigation ${className}`}>
      {showControls && (
        <div className="board-navigation-controls">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom out"
            disabled={camera.zoom <= MIN_BOARD_ZOOM}
            onClick={() => zoomBy(-0.25)}
          >
            −
          </Button>
          <output aria-label="Board zoom">
            {Math.round(camera.zoom * 100)}%
          </output>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom in"
            disabled={camera.zoom >= MAX_BOARD_ZOOM}
            onClick={() => zoomBy(0.25)}
          >
            +
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Fit board"
            onClick={fit}
          >
            Fit
          </Button>
        </div>
      )}
      <span className="sr-only" id={hint}>
        Drag to pan. Scroll or pinch to zoom. When focused, use arrow keys to
        pan, plus or minus to zoom, and Home to fit the board.
      </span>
      <div
        ref={viewport}
        role="group"
        aria-label="Board navigation"
        aria-describedby={hint}
        tabIndex={0}
        className={`board-viewport${dragging ? " dragging" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onDragStart={(event) => event.preventDefault()}
        onKeyDown={key}
        onClickCapture={(event) => {
          const pointer =
            "pointerType" in event.nativeEvent && event.nativeEvent.pointerType;
          if (
            (event.detail !== 0 || pointer) &&
            performance.now() < suppressClickUntil.current
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div
          className="board-canvas"
          style={{
            transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
