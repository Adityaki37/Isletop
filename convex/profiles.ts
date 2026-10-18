import { normalizeAvatar } from "../lib/avatars";
import { storedRegion } from "../lib/regions";
import type { Doc } from "./_generated/dataModel";
export const publicProfile = (a: Doc<"accounts">) => ({
  username: a.username,
  displayName: a.display_name,
  bio: a.bio,
  color: a.color,
  avatar: normalizeAvatar(a.avatar),
  region: storedRegion(a),
  createdAt: a.created_at,
});
