import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireOwnedCard, requireOwnedDeck, requireOwnerId, validateThreadForDeck } from "./authz";
import { actor, color, deckCardDocument, deckZone } from "./validators";

const colorOrder = ["W", "U", "B", "R", "G"] as const;

function uniqueTrimmed(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function syncDeckCommanderMetadata(ctx: MutationCtx, deckId: Id<"decks">, updatedAt: number) {
  const cards = await ctx.db
    .query("deckCards")
    .withIndex("by_deck", (q) => q.eq("deckId", deckId))
    .collect();
  const commanders = cards
    .filter((card) => card.zone === "commander")
    .sort((left, right) => left.createdAt - right.createdAt);
  const colors = new Set(commanders.flatMap((commander) => commander.colorIdentity));
  await ctx.db.patch(deckId, {
    commanderName: commanders.length
      ? commanders.map((commander) => commander.name).join(" & ")
      : undefined,
    colorIdentity: colorOrder.filter((colorValue) => colors.has(colorValue)),
    updatedAt,
    lastActivityAt: updatedAt,
  });
}

export const syncCommanderMetadata = mutation({
  args: { deckId: v.id("decks") },
  returns: v.null(),
  handler: async (ctx, { deckId }) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedDeck(ctx, ownerId, deckId);
    await syncDeckCommanderMetadata(ctx, deckId, Date.now());
    return null;
  },
});

export const list = query({
  args: { deckId: v.id("decks") },
  returns: v.array(deckCardDocument),
  handler: async (ctx, { deckId }) => {
    const ownerId = await requireOwnerId(ctx);
    try {
      await requireOwnedDeck(ctx, ownerId, deckId);
    } catch {
      return [];
    }
    return ctx.db
      .query("deckCards")
      .withIndex("by_deck", (q) => q.eq("deckId", deckId))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    deckId: v.id("decks"),
    threadId: v.optional(v.id("threads")),
    name: v.string(),
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
    actor,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedDeck(ctx, ownerId, args.deckId);
    await validateThreadForDeck(ctx, ownerId, args.deckId, args.threadId);
    const name = args.name.trim();
    if (!name) throw new Error("Card name is required");
    const normalizedName = name.toLowerCase();
    const existing = await ctx.db
      .query("deckCards")
      .withIndex("by_deck_name_zone", (q) =>
        q.eq("deckId", args.deckId).eq("normalizedName", normalizedName).eq("zone", args.zone),
      )
      .unique();
    const now = Date.now();
    const values = {
      ownerId,
      deckId: args.deckId,
      name,
      normalizedName,
      quantity: Math.max(1, Math.floor(args.quantity)),
      zone: args.zone,
      typeLine: args.typeLine,
      oracleText: args.oracleText,
      manaValue: args.manaValue,
      colorIdentity: args.colorIdentity,
      oracleId: args.oracleId,
      oracleTags: args.oracleTags,
      illustrationIds: args.illustrationIds,
      artTags: args.artTags,
      tags: uniqueTrimmed(args.tags),
      addedBy: args.actor,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("deckCards", { ...values, createdAt: now });
    if (args.zone === "commander") await syncDeckCommanderMetadata(ctx, args.deckId, now);
    else await ctx.db.patch(args.deckId, { updatedAt: now, lastActivityAt: now });
    await ctx.db.insert("deckEvents", {
      ownerId,
      deckId: args.deckId,
      threadId: args.threadId,
      actor: args.actor,
      action: existing ? "updated card" : "added card",
      cardName: name,
      detail: `${Math.max(1, Math.floor(args.quantity))} × ${args.zone}`,
      createdAt: now,
    });
    return null;
  },
});

export const remove = mutation({
  args: {
    cardId: v.id("deckCards"),
    threadId: v.optional(v.id("threads")),
    actor,
  },
  returns: v.null(),
  handler: async (ctx, { cardId, threadId, actor: eventActor }) => {
    const ownerId = await requireOwnerId(ctx);
    const card = await requireOwnedCard(ctx, ownerId, cardId);
    await requireOwnedDeck(ctx, ownerId, card.deckId);
    await validateThreadForDeck(ctx, ownerId, card.deckId, threadId);
    await ctx.db.delete(cardId);
    const now = Date.now();
    if (card.zone === "commander") await syncDeckCommanderMetadata(ctx, card.deckId, now);
    else await ctx.db.patch(card.deckId, { updatedAt: now, lastActivityAt: now });
    await ctx.db.insert("deckEvents", {
      ownerId,
      deckId: card.deckId,
      threadId,
      actor: eventActor,
      action: "removed card",
      cardName: card.name,
      createdAt: now,
    });
    return null;
  },
});

export const updateTags = mutation({
  args: { cardId: v.id("deckCards"), tags: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { cardId, tags }) => {
    const ownerId = await requireOwnerId(ctx);
    const card = await requireOwnedCard(ctx, ownerId, cardId);
    await requireOwnedDeck(ctx, ownerId, card.deckId);
    const now = Date.now();
    await ctx.db.patch(cardId, { tags: uniqueTrimmed(tags), updatedAt: now });
    await ctx.db.patch(card.deckId, { updatedAt: now, lastActivityAt: now });
    return null;
  },
});

export const updateSearchMetadata = mutation({
  args: {
    cardId: v.id("deckCards"),
    oracleId: v.string(),
    oracleTags: v.array(v.string()),
    illustrationIds: v.array(v.string()),
    artTags: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { cardId, oracleId, oracleTags, illustrationIds, artTags }) => {
    const ownerId = await requireOwnerId(ctx);
    const card = await requireOwnedCard(ctx, ownerId, cardId);
    await requireOwnedDeck(ctx, ownerId, card.deckId);
    await ctx.db.patch(cardId, {
      oracleId: oracleId.trim(),
      oracleTags: uniqueTrimmed(oracleTags),
      illustrationIds: uniqueTrimmed(illustrationIds),
      artTags: uniqueTrimmed(artTags),
      updatedAt: Date.now(),
    });
    return null;
  },
});
