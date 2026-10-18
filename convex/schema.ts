import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  requestLimits: defineTable({
    key: v.string(),
    window: v.number(),
    count: v.number(),
    expires: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expiry", ["expires"]),
  roomTimers: defineTable({
    code: v.string(),
    created: v.number(),
    wakeId: v.optional(v.id("_scheduled_functions")),
    wakeToken: v.optional(v.string()),
    wakeAt: v.optional(v.number()),
  }).index("by_code", ["code"]),
  matchmakingEntries: defineTable({
    player_id: v.string(),
    ticket: v.string(),
    queue: v.string(),
    map: v.optional(v.string()),
    name: v.string(),
    avatar: v.string(),
    color: v.number(),
    account_id: v.union(v.string(), v.null()),
    session_hash: v.union(v.string(), v.null()),
    joined_at: v.number(),
    expires_at: v.number(),
    room_code: v.union(v.string(), v.null()),
    room_created: v.union(v.number(), v.null()),
  })
    .index("by_player", ["player_id"])
    .index("by_queue", ["queue", "joined_at", "ticket"])
    .index("by_queue_pending", ["queue", "room_code", "joined_at", "ticket"])
    .index("by_queue_map_pending", ["queue", "map", "room_code", "joined_at", "ticket"])
    .index("by_waiting", ["room_code", "expires_at"])
    .index("by_ticket", ["ticket"])
    .index("by_expiry", ["expires_at"]),
  matchmakingCancellations: defineTable({
    player_id: v.string(),
    ticket: v.string(),
    expires_at: v.number(),
  })
    .index("by_player_ticket", ["player_id", "ticket"])
    .index("by_expiry", ["expires_at"]),
  friendships: defineTable({
    id: v.string(),
    low: v.string(),
    high: v.string(),
    requester: v.string(),
    status: v.string(),
    created_at: v.number(),
  })
    .index("by_pair", ["low", "high"])
    .index("by_friendship", ["id"])
    .index("by_low", ["low"])
    .index("by_high", ["high"]),
  socialBlocks: defineTable({ owner: v.string(), target: v.string() })
    .index("by_pair", ["owner", "target"])
    .index("by_owner", ["owner"]),
  socialPresence: defineTable({
    account_id: v.string(),
    seen_at: v.number(),
    show_presence: v.boolean(),
    room_code: v.union(v.string(), v.null()),
    room_created: v.union(v.number(), v.null()),
  }).index("by_account", ["account_id"]),
  socialNotifications: defineTable({
    id: v.string(),
    recipient: v.string(),
    sender: v.string(),
    kind: v.union(v.literal("invite"), v.literal("accepted")),
    room_code: v.union(v.string(), v.null()),
    room_created: v.union(v.number(), v.null()),
    created_at: v.number(),
    expires_at: v.number(),
    read: v.boolean(),
  })
    .index("by_notice", ["id"])
    .index("by_recipient", ["recipient", "created_at"]),
  accounts: defineTable({
    id: v.string(),
    username: v.string(),
    display_name: v.string(),
    password_hash: v.string(),
    recovery_hash: v.string(),
    player_id: v.string(),
    bio: v.string(),
    color: v.number(),
    avatar: v.string(),
    continent_code: v.string(),
    country_code: v.string(),
    region_code: v.string(),
    created_at: v.number(),
  })
    .index("by_account_id", ["id"])
    .index("by_username", ["username"])
    .index("by_player", ["player_id"]),
  accountPlayers: defineTable({ player_id: v.string(), account_id: v.string() })
    .index("by_player", ["player_id"])
    .index("by_account", ["account_id"]),
  accountSessions: defineTable({
    token_hash: v.string(),
    account_id: v.string(),
    expires_at: v.number(),
  })
    .index("by_token", ["token_hash"])
    .index("by_account", ["account_id"])
    .index("by_expiry", ["expires_at"]),
  authLimits: defineTable({
    key: v.string(),
    window: v.number(),
    count: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_window", ["window"]),
  tableConnections: defineTable({
    token: v.string(),
    room_code: v.string(),
    room_created: v.number(),
    player_id: v.string(),
    account_id: v.union(v.string(), v.null()),
    session_hash: v.union(v.string(), v.null()),
    expires_at: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_room", ["room_code", "room_created"])
    .index("by_expiry", ["expires_at"]),
  spectatorLeases: defineTable({
    token: v.string(),
    public_id: v.string(),
    room_code: v.string(),
    room_created: v.number(),
    viewer_key: v.string(),
    player_id: v.string(),
    account_id: v.union(v.string(), v.null()),
    session_hash: v.union(v.string(), v.null()),
    guest_name: v.string(),
    joined_at: v.number(),
    expires_at: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_room", ["room_code", "room_created"])
    .index("by_viewer", ["viewer_key", "room_code", "room_created"])
    .index("by_expiry", ["expires_at"]),
  rooms: defineTable({
    code: v.string(),
    state: v.string(),
    revision: v.number(),
    updated: v.number(),
    public: v.boolean(),
    directory: v.string(),
    wakeId: v.optional(v.id("_scheduled_functions")),
    wakeToken: v.optional(v.string()),
    wakeAt: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_public_updated", ["public", "updated"]),
  matches: defineTable({
    matchId: v.string(),
    code: v.string(),
    finishedAt: v.number(),
    summary: v.string(),
    result: v.string(),
    participants: v.array(v.string()),
  })
    .index("by_match", ["matchId"])
    .index("by_finished", ["finishedAt"]),
  matchPlayers: defineTable({
    matchId: v.string(),
    playerId: v.string(),
    won: v.boolean(),
    finishedAt: v.number(),
  })
    .index("by_player", ["playerId"])
    .index("by_match_player", ["matchId", "playerId"])
    .index("by_player_finished", ["playerId", "finishedAt", "matchId"]),
  replays: defineTable({
    matchId: v.string(),
    initial: v.string(),
    initialSequence: v.number(),
    complete: v.boolean(),
    lastSequence: v.number(),
    shareId: v.optional(v.string()),
  })
    .index("by_match", ["matchId"])
    .index("by_share", ["shareId"]),
  replayEvents: defineTable({
    matchId: v.string(),
    sequence: v.number(),
    frame: v.string(),
  }).index("by_match_sequence", ["matchId", "sequence"]),
  ratings: defineTable({
    accountId: v.string(),
    season: v.string(),
    mode: v.string(),
    rating: v.number(),
    games: v.number(),
    wins: v.number(),
    updated: v.number(),
  })
    .index("by_account_season_mode", ["accountId", "season", "mode"])
    .index("by_season_mode_rating", ["season", "mode", "rating"])
    .index("by_account_mode_season", ["accountId", "mode", "season"]),
  rankedResults: defineTable({
    matchId: v.string(),
    season: v.string(),
    mode: v.string(),
    finishedAt: v.number(),
    result: v.string(),
  }).index("by_match", ["matchId"]),
});
