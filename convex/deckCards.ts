import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const zone = v.union(v.literal("commander"), v.literal("main"), v.literal("maybeboard"));

async function ownerId(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity.subject;
}

export const list = query({
  args: { deckId: v.id("decks") },
  handler: async (ctx, { deckId }) => {
    const owner = await ownerId(ctx);
    const deck = await ctx.db.get(deckId);
    if (!deck || deck.ownerId !== owner) return [];
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
    zone,
    typeLine: v.string(),
    oracleText: v.optional(v.string()),
    manaValue: v.number(),
    colorIdentity: v.array(v.string()),
    tags: v.array(v.string()),
    actor: v.union(v.literal("user"), v.literal("assistant")),
  },
  handler: async (ctx, args) => {
    const owner = await ownerId(ctx);
    const deck = await ctx.db.get(args.deckId);
    if (!deck || deck.ownerId !== owner) throw new Error("Deck not found");
    const normalizedName = args.name.trim().toLocaleLowerCase();
    const existing = await ctx.db
      .query("deckCards")
      .withIndex("by_deck_name_zone", (q) =>
        q.eq("deckId", args.deckId).eq("normalizedName", normalizedName).eq("zone", args.zone),
      )
      .unique();
    const now = Date.now();
    const values = {
      ownerId: owner,
      deckId: args.deckId,
      name: args.name.trim(),
      normalizedName,
      quantity: Math.max(1, Math.floor(args.quantity)),
      zone: args.zone,
      typeLine: args.typeLine,
      oracleText: args.oracleText,
      manaValue: args.manaValue,
      colorIdentity: args.colorIdentity,
      tags: [...new Set(args.tags.map((tag) => tag.trim()).filter(Boolean))],
      addedBy: args.actor,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("deckCards", { ...values, createdAt: now });
    await ctx.db.patch(args.deckId, { updatedAt: now });
    await ctx.db.insert("deckEvents", {
      ownerId: owner,
      deckId: args.deckId,
      threadId: args.threadId,
      actor: args.actor,
      action: existing ? "updated card" : "added card",
      cardName: args.name.trim(),
      detail: `${args.quantity} × ${args.zone}`,
      createdAt: now,
    });
  },
});

export const remove = mutation({
  args: {
    cardId: v.id("deckCards"),
    threadId: v.optional(v.id("threads")),
    actor: v.union(v.literal("user"), v.literal("assistant")),
  },
  handler: async (ctx, { cardId, threadId, actor }) => {
    const owner = await ownerId(ctx);
    const card = await ctx.db.get(cardId);
    if (!card || card.ownerId !== owner) throw new Error("Card not found");
    await ctx.db.delete(cardId);
    await ctx.db.patch(card.deckId, { updatedAt: Date.now() });
    await ctx.db.insert("deckEvents", {
      ownerId: owner,
      deckId: card.deckId,
      threadId,
      actor,
      action: "removed card",
      cardName: card.name,
      createdAt: Date.now(),
    });
  },
});

export const updateTags = mutation({
  args: { cardId: v.id("deckCards"), tags: v.array(v.string()) },
  handler: async (ctx, { cardId, tags }) => {
    const owner = await ownerId(ctx);
    const card = await ctx.db.get(cardId);
    if (!card || card.ownerId !== owner) throw new Error("Card not found");
    await ctx.db.patch(cardId, {
      tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))],
      updatedAt: Date.now(),
    });
  },
});
