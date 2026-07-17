import { v } from "convex/values";
import { query } from "./_generated/server";

export const list = query({
  args: { deckId: v.id("decks") },
  handler: async (ctx, { deckId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const deck = await ctx.db.get(deckId);
    if (!deck || deck.ownerId !== identity.subject) return [];
    return ctx.db
      .query("deckEvents")
      .withIndex("by_deck_created", (q) => q.eq("deckId", deckId))
      .order("desc")
      .take(100);
  },
});
