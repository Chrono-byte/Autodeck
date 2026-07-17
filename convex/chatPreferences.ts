import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const model = v.union(
  v.literal("local"),
  v.literal("gpt-5.6-sol"),
  v.literal("gpt-5.6-terra"),
  v.literal("gpt-5.6-luna"),
  v.literal("gpt-5.5"),
  v.literal("gpt-5.4"),
  v.literal("gpt-5.4-mini"),
  v.literal("gpt-5.3-codex-spark"),
);

const reasoningEffort = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("xhigh"),
);

const speed = v.union(v.literal("standard"), v.literal("fast"));

async function ownerId(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity.subject;
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const owner = await ownerId(ctx);
    const preferences = await ctx.db
      .query("chatPreferences")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner))
      .unique();
    if (!preferences) return null;
    return {
      model: preferences.model,
      reasoningEffort: preferences.reasoningEffort,
      speed: preferences.speed,
    };
  },
});

export const save = mutation({
  args: { model, reasoningEffort, speed },
  handler: async (ctx, selection) => {
    const owner = await ownerId(ctx);
    const existing = await ctx.db
      .query("chatPreferences")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner))
      .unique();
    const value = { ownerId: owner, ...selection, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return ctx.db.insert("chatPreferences", value);
  },
});
