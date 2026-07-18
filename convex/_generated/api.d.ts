/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as chatPreferences from "../chatPreferences.js";
import type * as deckCards from "../deckCards.js";
import type * as deckEvents from "../deckEvents.js";
import type * as decks from "../decks.js";
import type * as http from "../http.js";
import type * as messageChunks from "../messageChunks.js";
import type * as openaiCodex from "../openaiCodex.js";
import type * as threads from "../threads.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chatPreferences: typeof chatPreferences;
  deckCards: typeof deckCards;
  deckEvents: typeof deckEvents;
  decks: typeof decks;
  http: typeof http;
  messageChunks: typeof messageChunks;
  openaiCodex: typeof openaiCodex;
  threads: typeof threads;
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

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
