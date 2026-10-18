export type TablePresence = { created: number; connected: boolean[] };
// Connection lease timings control online presence and reconnection grace.
export const TABLE_CONNECTION_TTL = 60000;
export const TABLE_HEARTBEAT = 15000;
export const BOT_DISCONNECT_GRACE = 15000;
