import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { chunkSerializedMessage, restoreSerializedMessages } from "./messageChunks";

function withoutMessageState<T extends { messageState?: unknown }>(thread: T) {
  const { messageState: _messageState, ...summary } = thread;
  return summary;
}

async function storedMessages(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">,
  legacyMessageState?: unknown,
) {
  const chunks = await ctx.db
    .query("threadMessageChunks")
    .withIndex("by_thread_message", (q) => q.eq("threadId", threadId))
    .collect();
  if (chunks.length > 0) return restoreSerializedMessages(chunks);
  return Array.isArray(legacyMessageState) ? legacyMessageState : [];
}

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
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_deck_updated", (q) => q.eq("deckId", deckId))
      .order("desc")
      .filter((q) => q.eq(q.field("archived"), false))
      .collect();
    return threads.map(withoutMessageState);
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
    return threads.map(withoutMessageState).sort((left, right) => {
      const pinDifference = Number(right.pinned === true) - Number(left.pinned === true);
      return pinDifference || right.updatedAt - left.updatedAt;
    });
  },
});

export const get = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const owner = await ownerId(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.ownerId !== owner) return null;
    return {
      ...withoutMessageState(thread),
      messageState: await storedMessages(ctx, threadId, thread.messageState),
    };
  },
});

export const getMessages = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const owner = await ownerId(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.ownerId !== owner) return null;
    return storedMessages(ctx, threadId, thread.messageState);
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
  args: { threadId: v.id("threads"), messages: v.array(v.string()) },
  handler: async (ctx, { threadId, messages }) => {
    const owner = await ownerId(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.ownerId !== owner) throw new Error("Thread not found");
    const existingChunks = await ctx.db
      .query("threadMessageChunks")
      .withIndex("by_thread_message", (q) => q.eq("threadId", threadId))
      .collect();
    await Promise.all(existingChunks.map((chunk) => ctx.db.delete(chunk._id)));

    for (const [messageIndex, message] of messages.entries()) {
      const chunks = chunkSerializedMessage(message);
      await Promise.all(
        chunks.map((content, chunkIndex) =>
          ctx.db.insert("threadMessageChunks", {
            threadId,
            messageIndex,
            chunkIndex,
            content,
          }),
        ),
      );
    }

    await ctx.db.patch(threadId, { messageState: undefined, updatedAt: Date.now() });
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

export const renameIfUntitled = mutation({
  args: { threadId: v.id("threads"), title: v.string() },
  handler: async (ctx, { threadId, title }) => {
    const owner = await ownerId(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.ownerId !== owner) throw new Error("Thread not found");
    if (thread.title !== "New thread" && thread.title !== "Deck study") return false;
    await ctx.db.patch(threadId, {
      title: title.trim() || "Untitled thread",
      updatedAt: Date.now(),
    });
    return true;
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
