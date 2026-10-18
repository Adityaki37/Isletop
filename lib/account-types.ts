export type AccountProfile = {
  username: string;
  displayName: string;
  bio: string;
  color: number;
  avatar?: import("./avatars").AvatarId;
  createdAt: number;
  region?: import("./regions").PlayerRegion;
};
export type ProfileStats = {
  games: number;
  wins: number;
  trackedGames: number;
  modes: { mode: string; games: number; wins: number; trackedGames: number }[];
};
export type AccountOverview = {
  account: AccountProfile | null;
  guestGames: number;
  guestSeats: number;
  sessions: number;
  stats?: ProfileStats;
};
