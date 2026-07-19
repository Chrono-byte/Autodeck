import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  actor,
  color,
  deckEventAction,
  deckZone,
  messageRole,
  messageStatus,
  model,
  reasoningEffort,
  speed,
} from "./validators";

export default defineSchema({
  decks: defineTable({
    ownerId: v.string(),
    name: v.string(),
    format: v.literal("commander"),
    commanderName: v.optional(v.string()),
    description: v.optional(v.string()),
    colorIdentity: v.array(color),
    deletingAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastActivityAt: v.number(),
  }).index("by_owner_deleting_activity", ["ownerId", "deletingAt", "lastActivityAt"]),

  threads: defineTable({
    ownerId: v.string(),
    deckId: v.id("decks"),
    title: v.string(),
    archived: v.boolean(),
    pinned: v.boolean(),
    firstUserText: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastActivityAt: v.number(),
  })
    .index("by_deck_archived_pinned_activity", ["deckId", "archived", "pinned", "lastActivityAt"])
    .index("by_owner_archived_pinned_activity", [
      "ownerId",
      "archived",
      "pinned",
      "lastActivityAt",
    ]),

  threadMessages: defineTable({
    threadId: v.id("threads"),
    messageId: v.string(),
    order: v.number(),
    role: messageRole,
    status: messageStatus,
    serializedPayload: v.optional(v.string()),
    chunkCount: v.number(),
    searchText: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread_order", ["threadId", "order"])
    .index("by_thread_message", ["threadId", "messageId"]),

  threadMessagePayloadChunks: defineTable({
    messageId: v.id("threadMessages"),
    chunkIndex: v.number(),
    content: v.string(),
  }).index("by_message_chunk", ["messageId", "chunkIndex"]),

  deckCards: defineTable({
    ownerId: v.string(),
    deckId: v.id("decks"),
    name: v.string(),
    normalizedName: v.string(),
    quantity: v.number(),
    zone: deckZone,
    typeLine: v.string(),
    oracleText: v.optional(v.string()),
    manaValue: v.number(),
    colorIdentity: v.array(color),
    oracleId: v.optional(v.string()),
    oracleTags: v.optional(v.array(v.string())),
    illustrationIds: v.optional(v.array(v.string())),
    artTags: v.optional(v.array(v.string())),
    tags: v.array(v.string()),
    addedBy: actor,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_deck", ["deckId"])
    .index("by_deck_name_zone", ["deckId", "normalizedName", "zone"]),

  deckEvents: defineTable({
    ownerId: v.string(),
    deckId: v.id("decks"),
    threadId: v.optional(v.id("threads")),
    actor,
    action: deckEventAction,
    cardName: v.optional(v.string()),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_deck_created", ["deckId", "createdAt"]),

  chatPreferences: defineTable({
    ownerId: v.string(),
    model,
    reasoningEffort,
    speed,
    titleModel: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),
});
