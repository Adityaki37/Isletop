import { SOUNDS, type Sound } from "./sound-assets";

/** Lazy original MP3 decoding. No catch-up queue after autoplay or mute. */
export class SoundPlayer {
  private context: AudioContext | null = null;
  private buffers = new Map<Sound, Promise<AudioBuffer>>();
  private sources = new Set<AudioBufferSourceNode>();
  private gain: GainNode | null = null;
  private generation = 0;
  private disposed = false;
  private volume = 0.7;
  private muted = false;

  async unlock() {
    if (this.disposed) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.gain = this.context.createGain();
        this.gain.gain.value = this.muted ? 0 : this.volume;
        this.gain.connect(this.context.destination);
      }
      if (this.context.state === "suspended") await this.context.resume();
    } catch {
      /* Sound never prevents a move on browsers without Web Audio. */
    }
  }
  configure(volume: number, muted: boolean) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : this.volume;
    if (muted || this.volume === 0) this.stop();
  }
  stop() {
    this.generation++;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
    }
    this.sources.clear();
  }
  async play(sound: Sound) {
    const ctx = this.context;
    if (
      !ctx ||
      ctx.state !== "running" ||
      this.disposed ||
      this.muted ||
      !this.volume
    )
      return;
    const generation = this.generation;
    const started = performance.now();
    try {
      let buffer = this.buffers.get(sound);
      if (!buffer) {
        buffer = fetch(SOUNDS[sound]).then(async (r) => {
          if (!r.ok) throw new Error("Sound unavailable");
          return ctx.decodeAudioData(await r.arrayBuffer());
        });
        this.buffers.set(sound, buffer);
        void buffer.catch(() => this.buffers.delete(sound));
      }
      const decoded = await buffer;
      if (
        generation !== this.generation ||
        this.disposed ||
        this.muted ||
        !this.volume ||
        ctx.state !== "running" ||
        performance.now() - started > 3000
      )
        return;
      if (this.sources.size >= 4) {
        const oldest = this.sources.values().next().value!;
        oldest.stop();
        this.sources.delete(oldest);
      }
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(this.gain!);
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        source.disconnect();
      };
      source.start();
    } catch {
      /* Missing audio or denied playback remains silent. */
    }
  }
  dispose() {
    this.disposed = true;
    this.stop();
    this.buffers.clear();
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
