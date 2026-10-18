"use client";
import { useId, useState } from "react";
import { TURN_TIMER_PRESETS, turnTimerPreset } from "@/lib/turn-timer";

export default function TurnTimerControl({ value, onChange, disabled = false, describedBy }: {
  value: number; onChange: (seconds: number) => void; disabled?: boolean; describedBy?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState({ source: value, seconds: value });
  // Synchronize external lobby updates while previewing a slider adjustment.
  if (draft.source !== value) setDraft({ source: value, seconds: value });
  const preset = turnTimerPreset(draft.seconds);
  const select = (index: number, commit: boolean) => {
    const seconds = TURN_TIMER_PRESETS[index].seconds;
    setDraft({ source: value, seconds });
    if (commit && seconds !== value) onChange(seconds);
  };
  return <div className="turn-timer-control">
    <div className="turn-timer-heading">
      <label htmlFor={`${id}-preset`}>Turn timer</label>
      <output>{draft.seconds === 0 ? "No timer" : `${draft.seconds} seconds`}</output>
    </div>
    <div className="turn-timer-presets">
      <input id={`${id}-preset`} type="range" min={0} max={3} step={1}
        value={preset} disabled={disabled} aria-label="Turn timer preset" aria-describedby={describedBy}
        aria-valuetext={`${TURN_TIMER_PRESETS[preset].label}${draft.seconds ? ` · ${draft.seconds} seconds` : ""}`}
        onChange={event => select(Number(event.target.value), false)}
        onPointerUp={event => select(Number(event.currentTarget.value), true)}
        onKeyUp={event => {
          if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            select(Number(event.currentTarget.value), true);
        }} />
      <div className="turn-timer-marks">
        {TURN_TIMER_PRESETS.map((option, index) => <button key={option.label} type="button"
          disabled={disabled} aria-pressed={preset === index} onClick={() => select(index, true)}>
          {option.label}
        </button>)}
      </div>
    </div>
  </div>;
}
