import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireOwnedDeck, requireOwnedThread, requireOwnerId } from "./authz";
import {
  INLINE_MESSAGE_LENGTH,
  chunkMessagePayload,
  restoreMessagePayload,
} from "./messagePayload";
import { messageRole, messageStatus, persistedMessage, threadSummary } from "./validators";

const changedMessage = v.object({
  messageId: v.string(),
  order: v.number(),
  role: messageRole,
  status: messageStatus,
  serializedPayload: v.string(),
  searchText: v.optional(v.string()),
});

async function payloadForMessage(ctx: QueryCtx, message: Doc<"threadMessages">) {
  if (message.serializedPayload !== undefined) return message.serializedPayload;
  const chunks = await ctx.db
    .query("threadMessagePayloadChunks")
    .withIndex("by_message_chunk", (q) => q.eq("messageId", message._id))
    .collect();
  if (chunks.length !== message.chunkCount) throw new Error("Stored message payload is incomplete");
  return restoreMessagePayload(undefined, chunks);
}

async function deleteMessage(ctx: MutationCtx, message: Doc<"threadMessages">) {
  const chunks = await ctx.db
    .query("threadMessagePayloadChunks")
    .withIndex("by_message_chunk", (q) => q.eq("messageId", message._id))
    .collect();
  await Promise.all(chunks.map((chunk) => ctx.db.delete(chunk._id)));
  await ctx.db.delete(message._id);
}

async function replacePayload(
  ctx: MutationCtx,
  messageId: Id<"threadMessages">,
  serializedPayload: string,
) {
  const oldChunks = await ctx.db
    .query("threadMessagePayloadChunks")
    .withIndex("by_message_chunk", (q) => q.eq("messageId", messageId))
    .collect();
  await Promise.all(oldChunks.map((chunk) => ctx.db.delete(chunk._id)));

  if (serializedPayload.length <= INLINE_MESSAGE_LENGTH) {
    return { serializedPayload, chunkCount: 0 };
  }
  const chunks = chunkMessagePayload(serializedPayload);
  await Promise.all(
    chunks.map((content, chunkIndex) =>
      ctx.db.insert("threadMessagePayloadChunks", { messageId, chunkIndex, content }),
    ),
  );
  return { serializedPayload: undefined, chunkCount: chunks.length };
}

export const listByDeck = query({
  args: { deckId: v.id("decks") },
  returns: v.array(threadSummary),
  handler: async (ctx, { deckId }) => {
    const ownerId = await requireOwnerId(ctx);
    try {
      await requireOwnedDeck(ctx, ownerId, deckId);
    } catch {
      return [];
    }
    return ctx.db
      .query("threads")
      .withIndex("by_deck_archived_pinned_activity", (q) =>
        q.eq("deckId", deckId).eq("archived", false),
      )
      .order("desc")
      .take(200);
  },
});

export const get = query({
  args: { threadId: v.id("threads") },
  returns: v.union(threadSummary, v.null()),
  handler: async (ctx, { threadId }) => {
    const ownerId = await requireOwnerId(ctx);
    const thread = await ctx.db.get(threadId);
    return thread?.ownerId === ownerId ? thread : null;
  },
});

export const listMessages = query({
  args: { threadId: v.id("threads"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(persistedMessage),
  handler: async (ctx, { threadId, paginationOpts }) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedThread(ctx, ownerId, threadId);
    const page = await ctx.db
      .query("threadMessages")
      .withIndex("by_thread_order", (q) => q.eq("threadId", threadId))
      .order("desc")
      .paginate({
        ...paginationOpts,
        maximumRowsRead: Math.min(paginationOpts.maximumRowsRead ?? 100, 100),
        maximumBytesRead: Math.min(paginationOpts.maximumBytesRead ?? 4_000_000, 4_000_000),
      });
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (message) => ({
          messageId: message.messageId,
          order: message.order,
          serializedPayload: await payloadForMessage(ctx, message),
        })),
      ),
    };
  },
});

export const create = mutation({
  args: { deckId: v.id("decks"), title: v.optional(v.string()) },
  returns: v.id("threads"),
  handler: async (ctx, { deckId, title }) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedDeck(ctx, ownerId, deckId);
    const now = Date.now();
    return ctx.db.insert("threads", {
      ownerId,
      deckId,
      title: title?.trim() || "New thread",
      archived: false,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
  },
});

export const syncMessages = mutation({
  args: {
    threadId: v.id("threads"),
    messages: v.array(changedMessage),
    truncateFromOrder: v.optional(v.number()),
    turnCompleted: v.boolean(),
  },
  returns: v.object({ saved: v.number(), truncated: v.number(), truncationComplete: v.boolean() }),
  handler: async (ctx, { threadId, messages, truncateFromOrder, turnCompleted }) => {
    const ownerId = await requireOwnerId(ctx);
    const thread = await requireOwnedThread(ctx, ownerId, threadId);
    const now = Date.now();
    let truncated = 0;
    let truncationComplete = true;

    if (truncateFromOrder !== undefined) {
      const staleMessages = await ctx.db
        .query("threadMessages")
        .withIndex("by_thread_order", (q) =>
          q.eq("threadId", threadId).gte("order", truncateFromOrder),
        )
        .take(100);
      await Promise.all(staleMessages.map((message) => deleteMessage(ctx, message)));
      truncated = staleMessages.length;
      truncationComplete = staleMessages.length < 100;
    }

    const seenIds = new Set<string>();
    for (const message of messages) {
      if (seenIds.has(message.messageId)) throw new Error("Duplicate message ID in sync batch");
      seenIds.add(message.messageId);
      if (!Number.isSafeInteger(message.order) || message.order < 0) {
        throw new Error("Message order must be a non-negative integer");
      }
      JSON.parse(message.serializedPayload) as unknown;
      chunkMessagePayload(message.serializedPayload);

      const byId = await ctx.db
        .query("threadMessages")
        .withIndex("by_thread_message", (q) =>
          q.eq("threadId", threadId).eq("messageId", message.messageId),
        )
        .unique();
      const byOrder = await ctx.db
        .query("threadMessages")
        .withIndex("by_thread_order", (q) => q.eq("threadId", threadId).eq("order", message.order))
        .unique();
      if (byOrder && byOrder._id !== byId?._id) await deleteMessage(ctx, byOrder);

      const storedId =
        byId?._id ??
        (await ctx.db.insert("threadMessages", {
          threadId,
          messageId: message.messageId,
          order: message.order,
          role: message.role,
          status: message.status,
          chunkCount: 0,
          searchText: message.searchText,
          createdAt: now,
          updatedAt: now,
        }));
      const payload = await replacePayload(ctx, storedId, message.serializedPayload);
      await ctx.db.patch(storedId, {
        order: message.order,
        role: message.role,
        status: message.status,
        searchText: message.searchText,
        updatedAt: now,
        ...payload,
      });
    }

    const firstUserText =
      thread.firstUserText ??
      messages.find((message) => message.role === "user" && message.searchText?.trim())?.searchText;
    if (turnCompleted || firstUserText !== thread.firstUserText) {
      await ctx.db.patch(threadId, {
        firstUserText,
        lastActivityAt: turnCompleted ? now : thread.lastActivityAt,
      });
      if (turnCompleted) await ctx.db.patch(thread.deckId, { lastActivityAt: now });
    }

    return { saved: messages.length, truncated, truncationComplete };
  },
});

export const rename = mutation({
  args: { threadId: v.id("threads"), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, title }) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedThread(ctx, ownerId, threadId);
    await ctx.db.patch(threadId, {
      title: title.trim() || "Untitled thread",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const renameIfUntitled = mutation({
  args: { threadId: v.id("threads"), title: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { threadId, title }) => {
    const ownerId = await requireOwnerId(ctx);
    const thread = await requireOwnedThread(ctx, ownerId, threadId);
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
  returns: v.null(),
  handler: async (ctx, { threadId, pinned }) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedThread(ctx, ownerId, threadId);
    await ctx.db.patch(threadId, { pinned, updatedAt: Date.now() });
    return null;
  },
});

export const archive = mutation({
  args: { threadId: v.id("threads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedThread(ctx, ownerId, threadId);
    await ctx.db.patch(threadId, { archived: true, pinned: false, updatedAt: Date.now() });
    return null;
  },
});
