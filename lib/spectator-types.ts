export type Spectator = {
  id: string;
  name: string;
  username: string | null;
  color: number | null;
  avatar?: import("./avatars").AvatarId;
};
export type SpectatorPage = {
  count: number;
  spectators: Spectator[];
  next: number | null;
};
