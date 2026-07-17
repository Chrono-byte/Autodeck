import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

async function ownerId(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity.subject;
}

export const listByDeck = query({
  args: { deckId: v.id("decks") },
  handler: async (ctx, { deckId }) => {
    const owner = await ownerId(ctx);
    const deck = await ctx.db.get(deckId);
    if (!deck || deck.ownerId !== owner) return [];
    return ctx.db
      .query("threads")
      .withIndex("by_deck_updated", (q) => q.eq("deckId", deckId))
      .order("desc")
      .filter((q) => q.eq(q.field("archived"), false))
      .collect();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const owner = await ownerId(ctx);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", owner))
      .order("desc")
      .filter((q) => q.eq(q.field("archived"), false))
      .collect();
    return threads.sort((left, right) => {
      const pinDifference = Number(right.pinned === true) - Number(left.pinned === true);
      return pinDifference || right.updatedAt - left.updatedAt;
    });
  },
});

export const create = mutation({
  args: { deckId: v.id("decks"), title: v.optional(v.string()) },
  handler: async (ctx, { deckId, title }) => {
    const owner = await ownerId(ctx);
    const deck = await ctx.db.get(deckId);
    if (!deck || deck.ownerId !== owner) throw new Error("Deck not found");
    const now = Date.now();
    return ctx.db.insert("threads", {
      ownerId: owner,
      deckId,
      title: title?.trim() || "New thread",
      archived: false,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const saveMessages = mutation({
  args: { threadId: v.id("threads"), messages: v.any() },
  handler: async (ctx, { threadId, messages }) => {
    const owner = await ownerId(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.ownerId !== owner) throw new Error("Thread not found");
    await ctx.db.patch(threadId, { messageState: messages, updatedAt: Date.now() });
    await ctx.db.patch(thread.deckId, { updatedAt: Date.now() });
  },
});

export const rename = mutation({
  args: { threadId: v.id("threads"), title: v.string() },
  handler: async (ctx, { threadId, title }) => {
    const owner = await ownerId(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.ownerId !== owner) throw new Error("Thread not found");
    await ctx.db.patch(threadId, {
      title: title.trim() || "Untitled thread",
      updatedAt: Date.now(),
    });
  },
});

export const setPinned = mutation({
  args: { threadId: v.id("threads"), pinned: v.boolean() },
  handler: async (ctx, { threadId, pinned }) => {
    const owner = await ownerId(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.ownerId !== owner) throw new Error("Thread not found");
    await ctx.db.patch(threadId, { pinned, updatedAt: Date.now() });
  },
});

export const archive = mutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const owner = await ownerId(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.ownerId !== owner) throw new Error("Thread not found");
    await ctx.db.patch(threadId, { archived: true, pinned: false, updatedAt: Date.now() });
  },
});
