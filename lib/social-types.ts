import type { AccountProfile } from "./account-types";
export type SocialRoom = {
  code: string;
  title: string;
  mode: string;
  created: number;
  phase: "lobby" | "playing";
  players: number;
  capacity: number;
  joinable: boolean;
};
export type SocialPlayer = {
  profile: AccountProfile;
  online: boolean;
  lastSeen: number | null;
  room: SocialRoom | null;
};
export type SocialRelationship = {
  id: string;
  player: SocialPlayer;
  createdAt: number;
};
export type SocialNotification = {
  id: string;
  kind: "invite" | "accepted";
  sender: AccountProfile;
  createdAt: number;
  read: boolean;
  room: SocialRoom | null;
};
export type SocialOverview = {
  friends: SocialRelationship[];
  incoming: SocialRelationship[];
  outgoing: SocialRelationship[];
  blocked: AccountProfile[];
  notifications: SocialNotification[];
  showPresence: boolean;
  unread: number;
  roomPlayers: { seat: number; profile: AccountProfile }[];
};
export type SocialLookup = {
  profile: AccountProfile;
  relationship:
    | "self"
    | "none"
    | "friends"
    | "incoming"
    | "outgoing"
    | "blocked"
    | "unavailable";
  id: string | null;
};
