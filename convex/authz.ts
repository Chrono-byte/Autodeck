import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type AuthContext = {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
};

export async function requireOwnerId(ctx: AuthContext) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity.subject;
}

export async function requireOwnedDeck(
  ctx: QueryCtx | MutationCtx,
  ownerId: string,
  deckId: Id<"decks">,
) {
  const deck = await ctx.db.get(deckId);
  if (!deck || deck.ownerId !== ownerId || deck.deletingAt !== undefined) {
    throw new Error("Deck not found");
  }
  return deck;
}

export async function requireOwnedThread(
  ctx: QueryCtx | MutationCtx,
  ownerId: string,
  threadId: Id<"threads">,
) {
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.ownerId !== ownerId) throw new Error("Thread not found");
  return thread;
}

export async function requireOwnedCard(
  ctx: QueryCtx | MutationCtx,
  ownerId: string,
  cardId: Id<"deckCards">,
) {
  const card = await ctx.db.get(cardId);
  if (!card || card.ownerId !== ownerId) throw new Error("Card not found");
  return card;
}

export async function validateThreadForDeck(
  ctx: QueryCtx | MutationCtx,
  ownerId: string,
  deckId: Id<"decks">,
  threadId: Id<"threads"> | undefined,
): Promise<Doc<"threads"> | undefined> {
  if (threadId === undefined) return undefined;
  const thread = await requireOwnedThread(ctx, ownerId, threadId);
  if (thread.deckId !== deckId) throw new Error("Thread does not belong to this deck");
  return thread;
}
