export const RECONNECT_STORAGE_KEY = "isletop:reconnect:v1";
export const RECONNECT_EVENT = "isletop:reconnect-change";

export type RememberedGame = {
  version: 1;
  code: string;
  created: number;
  dismissed: boolean;
};

type ReconnectView = { code: string; created: number; me: number; phase: string };

export function parseRememberedGame(raw: string | null): RememberedGame | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value?.version === 1 && /^[A-Z2-9]{6}$/.test(value.code) &&
      Number.isSafeInteger(value.created) && value.created > 0 && typeof value.dismissed === "boolean"
      ? { version: 1, code: value.code, created: value.created, dismissed: value.dismissed } : null;
  } catch {
    return null;
  }
}

export function sameRememberedGame(saved: RememberedGame, game: { code: string; created: number }) {
  return saved.code === game.code && saved.created === game.created;
}

export function canReconnect(saved: RememberedGame, game: ReconnectView) {
  return sameRememberedGame(saved, game) && game.me >= 0 &&
    !["lobby", "finished"].includes(game.phase);
}
