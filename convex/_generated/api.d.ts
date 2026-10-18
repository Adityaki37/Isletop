/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as accounts from "../accounts.js";
import type * as clock from "../clock.js";
import type * as errors from "../errors.js";
import type * as history from "../history.js";
import type * as inspection from "../inspection.js";
import type * as matchmaking from "../matchmaking.js";
import type * as presence from "../presence.js";
import type * as profiles from "../profiles.js";
import type * as rankings from "../rankings.js";
import type * as requestLimits from "../requestLimits.js";
import type * as roomViews from "../roomViews.js";
import type * as rooms from "../rooms.js";
import type * as social from "../social.js";
import type * as tableActions from "../tableActions.js";
import type * as tableTimers from "../tableTimers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  accounts: typeof accounts;
  clock: typeof clock;
  errors: typeof errors;
  history: typeof history;
  inspection: typeof inspection;
  matchmaking: typeof matchmaking;
  presence: typeof presence;
  profiles: typeof profiles;
  rankings: typeof rankings;
  requestLimits: typeof requestLimits;
  roomViews: typeof roomViews;
  rooms: typeof rooms;
  social: typeof social;
  tableActions: typeof tableActions;
  tableTimers: typeof tableTimers;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
