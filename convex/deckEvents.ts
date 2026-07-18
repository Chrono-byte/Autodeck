import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOwnedDeck, requireOwnerId } from "./authz";
import { deckEventDocument } from "./validators";

export const list = query({
  args: { deckId: v.id("decks") },
  returns: v.array(deckEventDocument),
  handler: async (ctx, { deckId }) => {
    const ownerId = await requireOwnerId(ctx);
    try {
      await requireOwnedDeck(ctx, ownerId, deckId);
    } catch {
      return [];
    }
    return ctx.db
      .query("deckEvents")
      .withIndex("by_deck_created", (q) => q.eq("deckId", deckId))
      .order("desc")
      .take(100);
  },
});
