import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOwnedDeck, requireOwnerId } from "./authz";
import { color, deckDocument } from "./validators";

export const list = query({
  args: {},
  returns: v.array(deckDocument),
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    return ctx.db
      .query("decks")
      .withIndex("by_owner_deleting_activity", (q) =>
        q.eq("ownerId", ownerId).eq("deletingAt", undefined),
      )
      .order("desc")
      .take(100);
  },
});

export const get = query({
  args: { deckId: v.id("decks") },
  returns: v.union(deckDocument, v.null()),
  handler: async (ctx, { deckId }) => {
    const ownerId = await requireOwnerId(ctx);
    const deck = await ctx.db.get(deckId);
    return deck?.ownerId === ownerId && deck.deletingAt === undefined ? deck : null;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    commanderName: v.optional(v.string()),
    colorIdentity: v.optional(v.array(color)),
  },
  returns: v.object({ deckId: v.id("decks"), threadId: v.id("threads") }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const now = Date.now();
    const deckId = await ctx.db.insert("decks", {
      ownerId,
      name: args.name.trim() || "Untitled deck",
      format: "commander",
      commanderName: args.commanderName?.trim() || undefined,
      colorIdentity: args.colorIdentity ?? [],
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
    const threadId = await ctx.db.insert("threads", {
      ownerId,
      deckId,
      title: "Deck study",
      archived: false,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
    return { deckId, threadId };
  },
});

export const update = mutation({
  args: {
    deckId: v.id("decks"),
    name: v.optional(v.string()),
    commanderName: v.optional(v.string()),
    description: v.optional(v.string()),
    colorIdentity: v.optional(v.array(color)),
  },
  returns: v.null(),
  handler: async (ctx, { deckId, name, commanderName, description, colorIdentity }) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedDeck(ctx, ownerId, deckId);
    const now = Date.now();
    await ctx.db.patch(deckId, {
      ...(name !== undefined ? { name: name.trim() || "Untitled deck" } : {}),
      ...(commanderName !== undefined ? { commanderName: commanderName.trim() || undefined } : {}),
      ...(description !== undefined ? { description: description.trim() || undefined } : {}),
      ...(colorIdentity !== undefined ? { colorIdentity } : {}),
      updatedAt: now,
      lastActivityAt: now,
    });
    return null;
  },
});

export const remove = mutation({
  args: { deckId: v.id("decks") },
  returns: v.null(),
  handler: async (ctx, { deckId }) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedDeck(ctx, ownerId, deckId);
    await ctx.db.patch(deckId, { deletingAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.decks.deleteBatch, { deckId });
    return null;
  },
});

export const deleteBatch = internalMutation({
  args: { deckId: v.id("decks") },
  returns: v.null(),
  handler: async (ctx, { deckId }) => {
    const deck = await ctx.db.get(deckId);
    if (!deck || deck.deletingAt === undefined) return null;

    const thread = await ctx.db
      .query("threads")
      .withIndex("by_deck_archived_pinned_activity", (q) => q.eq("deckId", deckId))
      .first();
    if (thread) {
      const message = await ctx.db
        .query("threadMessages")
        .withIndex("by_thread_order", (q) => q.eq("threadId", thread._id))
        .first();
      if (message) {
        const chunks = await ctx.db
          .query("threadMessagePayloadChunks")
          .withIndex("by_message_chunk", (q) => q.eq("messageId", message._id))
          .take(100);
        if (chunks.length > 0) {
          await Promise.all(chunks.map((chunk) => ctx.db.delete(chunk._id)));
        } else {
          await ctx.db.delete(message._id);
        }
      } else {
        await ctx.db.delete(thread._id);
      }
      await ctx.scheduler.runAfter(0, internal.decks.deleteBatch, { deckId });
      return null;
    }

    const cards = await ctx.db
      .query("deckCards")
      .withIndex("by_deck", (q) => q.eq("deckId", deckId))
      .take(100);
    if (cards.length > 0) {
      await Promise.all(cards.map((card) => ctx.db.delete(card._id)));
      await ctx.scheduler.runAfter(0, internal.decks.deleteBatch, { deckId });
      return null;
    }

    const events = await ctx.db
      .query("deckEvents")
      .withIndex("by_deck_created", (q) => q.eq("deckId", deckId))
      .take(100);
    if (events.length > 0) {
      await Promise.all(events.map((event) => ctx.db.delete(event._id)));
      await ctx.scheduler.runAfter(0, internal.decks.deleteBatch, { deckId });
      return null;
    }

    await ctx.db.delete(deckId);
    return null;
  },
});
