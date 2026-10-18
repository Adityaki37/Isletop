import { ASSETS, PLAYER_COLORS } from "./assets";

export const DEFAULT_AVATAR = "player" as const;
export const AVATARS = [
  { id: DEFAULT_AVATAR, name: "Player", src: ASSETS.icon_player },
] as const;
export type AvatarId = typeof DEFAULT_AVATAR;
export class AvatarSelectionError extends Error {
  constructor() {
    super("Choose an available player avatar.");
  }
}
export function normalizeAvatar(value: unknown): AvatarId {
  return value === DEFAULT_AVATAR ? value : DEFAULT_AVATAR;
}
export function selectAvatar(value: unknown): AvatarId {
  if (value !== DEFAULT_AVATAR)
    throw new AvatarSelectionError();
  return DEFAULT_AVATAR;
}
export function avatarAsset(value: unknown): string {
  return AVATARS.find((a) => a.id === normalizeAvatar(value))!.src;
}

export function botAvatarAsset(color: number): string {
  return ["black", "brown", "navy"].includes(PLAYER_COLORS[color]) ? ASSETS.icon_bot_black : ASSETS.icon_bot;
}
