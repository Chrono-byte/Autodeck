import { v } from "convex/values";

export const color = v.union(
  v.literal("W"),
  v.literal("U"),
  v.literal("B"),
  v.literal("R"),
  v.literal("G"),
);

export const deckZone = v.union(v.literal("commander"), v.literal("main"), v.literal("maybeboard"));

export const actor = v.union(v.literal("user"), v.literal("assistant"));

export const deckEventAction = v.union(
  v.literal("added card"),
  v.literal("updated card"),
  v.literal("removed card"),
);

export const messageRole = v.union(v.literal("user"), v.literal("assistant"), v.literal("system"));

export const messageStatus = v.union(
  v.literal("streaming"),
  v.literal("complete"),
  v.literal("error"),
);

export const model = v.union(
  v.literal("local"),
  v.literal("gpt-5.6-sol"),
  v.literal("gpt-5.6-terra"),
  v.literal("gpt-5.6-luna"),
  v.literal("gpt-5.5"),
  v.literal("gpt-5.4"),
  v.literal("gpt-5.4-mini"),
  v.literal("gpt-5.3-codex-spark"),
);

export const reasoningEffort = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("xhigh"),
  v.literal("max"),
);

export const speed = v.union(v.literal("standard"), v.literal("fast"));

export const threadSummary = v.object({
  _id: v.id("threads"),
  _creationTime: v.number(),
  ownerId: v.string(),
  deckId: v.id("decks"),
  title: v.string(),
  archived: v.boolean(),
  pinned: v.boolean(),
  firstUserText: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastActivityAt: v.number(),
});

export const persistedMessage = v.object({
  messageId: v.string(),
  order: v.number(),
  serializedPayload: v.string(),
});

export const deckDocument = v.object({
  _id: v.id("decks"),
  _creationTime: v.number(),
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
});

export const deckCardDocument = v.object({
  _id: v.id("deckCards"),
  _creationTime: v.number(),
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
});

export const deckEventDocument = v.object({
  _id: v.id("deckEvents"),
  _creationTime: v.number(),
  ownerId: v.string(),
  deckId: v.id("decks"),
  threadId: v.optional(v.id("threads")),
  actor,
  action: deckEventAction,
  cardName: v.optional(v.string()),
  detail: v.optional(v.string()),
  createdAt: v.number(),
});

export const chatPreferenceSelection = v.object({
  model,
  reasoningEffort,
  speed,
  titleModel: v.string(),
});
