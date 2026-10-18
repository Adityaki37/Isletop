"use client";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import type { useGameSound } from "./use-game-sound";

export default function SoundSettings({
  sound,
}: {
  sound: ReturnType<typeof useGameSound>;
}) {
  return (
    <section className="sound-settings" aria-label="Sound settings">
      <div className="settings-row">
        <span>Mute sounds</span>
        <Switch
          aria-label="Mute sounds"
          checked={sound.muted}
          onCheckedChange={sound.setMuted}
        />
      </div>
      <label className="sound-volume">
        <span>
          Volume <output>{sound.volume}%</output>
        </span>
        <input
          aria-label="Sound volume"
          type="range"
          min="0"
          max="100"
          step="10"
          value={sound.volume}
          onChange={(e) => sound.setVolume(Number(e.target.value))}
        />
      </label>
      <div className="settings-row">
        <span>Keyboard shortcuts</span>
        <Switch
          aria-label="Keyboard shortcuts"
          checked={sound.shortcuts}
          onCheckedChange={sound.setShortcuts}
        />
      </div>
      <p className="sound-shortcuts">
        <kbd>Space</kbd> roll / end turn · <kbd>F</kbd> fullscreen
        <br />
        <kbd>P</kbd> request pause · <kbd>M</kbd> mute · <kbd>↑</kbd> /{" "}
        <kbd>↓</kbd> volume
      </p>
      <Button
        variant="secondary"
        disabled={sound.muted || sound.volume === 0}
        onClick={sound.preview}
      >
        Test Sound
      </Button>
    </section>
  );
}
