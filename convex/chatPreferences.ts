import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOwnerId } from "./authz";
import { chatPreferenceSelection, model, reasoningEffort, speed } from "./validators";

export const get = query({
  args: {},
  returns: v.union(chatPreferenceSelection, v.null()),
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    const preferences = await ctx.db
      .query("chatPreferences")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .unique();
    if (!preferences) return null;
    return {
      model: preferences.model,
      reasoningEffort: preferences.reasoningEffort,
      speed: preferences.speed,
      titleModel: preferences.titleModel ?? "gpt-5.4-mini",
    };
  },
});

export const save = mutation({
  args: { model, reasoningEffort, speed },
  returns: v.id("chatPreferences"),
  handler: async (ctx, selection) => {
    const ownerId = await requireOwnerId(ctx);
    const existing = await ctx.db
      .query("chatPreferences")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .unique();
    const value = { ownerId, ...selection, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return ctx.db.insert("chatPreferences", value);
  },
});

export const saveTitleModel = mutation({
  args: { titleModel: v.string() },
  returns: v.id("chatPreferences"),
  handler: async (ctx, { titleModel }) => {
    const ownerId = await requireOwnerId(ctx);
    const normalized = titleModel.trim() || "local";
    const existing = await ctx.db
      .query("chatPreferences")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { titleModel: normalized, updatedAt: Date.now() });
      return existing._id;
    }
    return ctx.db.insert("chatPreferences", {
      ownerId,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      speed: "standard",
      titleModel: normalized,
      updatedAt: Date.now(),
    });
  },
});
