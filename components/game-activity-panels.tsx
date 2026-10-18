"use client";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Maximize2, Minimize2, Minus, Plus } from "lucide-react";

type Panel = "log" | "chat";

function PanelHeading({
  panel,
  collapsed,
  maximized,
  onCollapse,
  onExpand,
}: {
  panel: Panel;
  collapsed: boolean;
  maximized: boolean;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  const name = panel === "log" ? "Game Log" : "Chat";
  const collapseLabel = `${collapsed ? "Restore" : "Minimize"} ${name}`;
  const expandLabel = maximized
    ? `Restore ${name} size`
    : `Expand ${name} to column`;
  return (
    <h2
      id={`game-${panel}-heading`}
      className="sidebar-panel-heading"
      aria-label={name}
    >
      <span>{name}</span>
      <span className="activity-panel-controls">
        <button
          type="button"
          aria-label={collapseLabel}
          title={collapseLabel}
          aria-expanded={!collapsed}
          aria-controls={`game-${panel}-body`}
          onClick={onCollapse}
        >
          {collapsed ? (
            <Plus aria-hidden="true" />
          ) : (
            <Minus aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          aria-label={expandLabel}
          title={expandLabel}
          aria-pressed={maximized}
          onClick={onExpand}
        >
          {maximized ? (
            <Minimize2 aria-hidden="true" />
          ) : (
            <Maximize2 aria-hidden="true" />
          )}
        </button>
      </span>
    </h2>
  );
}

const mobileQuery = "(max-width: 600px)";
function subscribeLayout(onChange: () => void) {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const isHorizontal = () => window.matchMedia(mobileQuery).matches;
const serverLayout = () => false;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export default function GameActivityPanels({
  log,
  chat,
}: {
  log: ReactNode;
  chat: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointer: number;
    origin: number;
    logSize: number;
    available: number;
  } | null>(null);
  const horizontal = useSyncExternalStore(
    subscribeLayout,
    isHorizontal,
    serverLayout,
  );
  const [shares, setShares] = useState({ vertical: 0.6, horizontal: 0.45 });
  const [bounds, setBounds] = useState({ min: 0, max: 1 });
  const [resizing, setResizing] = useState(false);
  const [collapsed, setCollapsed] = useState({ log: false, chat: false });
  const [maximized, setMaximized] = useState<Panel | null>(null);
  const canResize = !maximized && !collapsed.log && !collapsed.chat;
  const axis = horizontal ? "horizontal" : "vertical";
  const share = shares[axis];

  useEffect(() => {
    const element = root.current;
    if (!element || !canResize) return;
    const observer = new ResizeObserver(() => {
      const first = element.querySelector<HTMLElement>(".game-log")!;
      const second = element.querySelector<HTMLElement>(".game-chat")!;
      const dimension = horizontal ? "width" : "height";
      const available =
        element.getBoundingClientRect()[dimension] -
        (divider.current?.getBoundingClientRect()[dimension] ?? 0);
      const minLog = parseFloat(
        getComputedStyle(first)[horizontal ? "minWidth" : "minHeight"],
      );
      const minChat = parseFloat(
        getComputedStyle(second)[horizontal ? "minWidth" : "minHeight"],
      );
      if (available <= 0) return;
      const min = Math.min(1, minLog / available),
        max = Math.max(min, 1 - minChat / available);
      setBounds((old) =>
        old.min === min && old.max === max ? old : { min, max },
      );
      setShares((old) => {
        const value = clamp(old[axis], min, max);
        return old[axis] === value ? old : { ...old, [axis]: value };
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [axis, horizontal, canResize]);

  function toggleCollapse(panel: Panel) {
    finishDrag();
    setMaximized(null);
    setCollapsed((old) => ({ ...old, [panel]: !old[panel] }));
  }
  function toggleExpand(panel: Panel) {
    finishDrag();
    setMaximized((old) => (old === panel ? null : panel));
    setCollapsed((old) => ({ ...old, [panel]: false }));
  }

  function updateShare(value: number) {
    setShares((old) => ({
      ...old,
      [axis]: clamp(value, bounds.min, bounds.max),
    }));
  }
  function finishDrag() {
    drag.current = null;
    setResizing(false);
  }
  const percent = Math.round(share * 100);
  return (
    <div
      ref={root}
      className="game-activity-panels"
      data-resizing={resizing || undefined}
      data-maximized={maximized ?? undefined}
      data-has-collapsed={
        (!maximized && (collapsed.log || collapsed.chat)) || undefined
      }
      data-all-collapsed={
        (!maximized && collapsed.log && collapsed.chat) || undefined
      }
      style={
        {
          "--activity-log-share": share,
          "--activity-chat-share": 1 - share,
        } as CSSProperties
      }
    >
      <section
        id="game-log-panel"
        className="panel game-log"
        aria-labelledby="game-log-heading"
        data-collapsed={collapsed.log || undefined}
        hidden={maximized === "chat"}
      >
        <PanelHeading
          panel="log"
          collapsed={collapsed.log}
          maximized={maximized === "log"}
          onCollapse={() => toggleCollapse("log")}
          onExpand={() => toggleExpand("log")}
        />
        <div
          id="game-log-body"
          hidden={collapsed.log}
          className="log"
          tabIndex={0}
          role="region"
          aria-label="Scrollable game log"
        >
          {log}
        </div>
      </section>
      <div
        ref={divider}
        className="activity-divider"
        hidden={!canResize}
        role="separator"
        tabIndex={0}
        aria-label="Resize game log and chat"
        aria-controls="game-log-panel game-chat-panel"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuemin={Math.round(bounds.min * 100)}
        aria-valuemax={Math.round(bounds.max * 100)}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% game log`}
        title="Drag to resize game log and chat; double-click to reset"
        onPointerDown={(event) => {
          if (event.button !== 0 || !root.current) return;
          event.preventDefault();
          const dimension = horizontal ? "width" : "height";
          const available =
            root.current.getBoundingClientRect()[dimension] -
            event.currentTarget.getBoundingClientRect()[dimension];
          const logSize = root.current
            .querySelector(".game-log")!
            .getBoundingClientRect()[dimension];
          drag.current = {
            pointer: event.pointerId,
            origin: horizontal ? event.clientX : event.clientY,
            logSize,
            available,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus();
          setResizing(true);
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (
            !active ||
            active.pointer !== event.pointerId ||
            active.available <= 0
          )
            return;
          updateShare(
            (active.logSize +
              (horizontal ? event.clientX : event.clientY) -
              active.origin) /
              active.available,
          );
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onDoubleClick={() => updateShare(horizontal ? 0.45 : 0.6)}
        onKeyDown={(event) => {
          const decrease = horizontal ? "ArrowLeft" : "ArrowUp";
          const increase = horizontal ? "ArrowRight" : "ArrowDown";
          if (![decrease, increase, "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          updateShare(
            event.key === "Home"
              ? bounds.min
              : event.key === "End"
                ? bounds.max
                : share + (event.key === increase ? 0.05 : -0.05),
          );
        }}
      >
        <span aria-hidden="true" />
      </div>
      <section
        id="game-chat-panel"
        className="panel game-chat"
        aria-labelledby="game-chat-heading"
        data-collapsed={collapsed.chat || undefined}
        hidden={maximized === "log"}
      >
        <PanelHeading
          panel="chat"
          collapsed={collapsed.chat}
          maximized={maximized === "chat"}
          onCollapse={() => toggleCollapse("chat")}
          onExpand={() => toggleExpand("chat")}
        />
        <div
          id="game-chat-body"
          className="game-chat-body"
          hidden={collapsed.chat}
        >
          {chat}
        </div>
      </section>
    </div>
  );
}
