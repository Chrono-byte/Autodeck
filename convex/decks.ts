import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

async function ownerId(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Not authenticated')
  return identity.subject
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const owner = await ownerId(ctx)
    return ctx.db
      .query('decks')
      .withIndex('by_owner_updated', (q) => q.eq('ownerId', owner))
      .order('desc')
      .collect()
  },
})

export const get = query({
  args: { deckId: v.id('decks') },
  handler: async (ctx, { deckId }) => {
    const owner = await ownerId(ctx)
    const deck = await ctx.db.get(deckId)
    return deck?.ownerId === owner ? deck : null
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    commanderName: v.optional(v.string()),
    colorIdentity: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const owner = await ownerId(ctx)
    const now = Date.now()
    const deckId = await ctx.db.insert('decks', {
      ownerId: owner,
      name: args.name.trim() || 'Untitled deck',
      format: 'commander',
      commanderName: args.commanderName,
      colorIdentity: args.colorIdentity ?? [],
      createdAt: now,
      updatedAt: now,
    })
    const threadId = await ctx.db.insert('threads', {
      ownerId: owner,
      deckId,
      title: 'Deck study',
      archived: false,
      createdAt: now,
      updatedAt: now,
    })
    return { deckId, threadId }
  },
})

export const update = mutation({
  args: {
    deckId: v.id('decks'),
    name: v.optional(v.string()),
    commanderName: v.optional(v.string()),
    description: v.optional(v.string()),
    colorIdentity: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { deckId, ...patch }) => {
    const owner = await ownerId(ctx)
    const deck = await ctx.db.get(deckId)
    if (!deck || deck.ownerId !== owner) throw new Error('Deck not found')
    await ctx.db.patch(deckId, { ...patch, updatedAt: Date.now() })
  },
})

export const remove = mutation({
  args: { deckId: v.id('decks') },
  handler: async (ctx, { deckId }) => {
    const owner = await ownerId(ctx)
    const deck = await ctx.db.get(deckId)
    if (!deck || deck.ownerId !== owner) throw new Error('Deck not found')
    const cards = await ctx.db.query('deckCards').withIndex('by_deck', (q) => q.eq('deckId', deckId)).collect()
    const threads = await ctx.db.query('threads').withIndex('by_deck_updated', (q) => q.eq('deckId', deckId)).collect()
    const events = await ctx.db.query('deckEvents').withIndex('by_deck_created', (q) => q.eq('deckId', deckId)).collect()
    await Promise.all([...cards, ...threads, ...events].map((record) => ctx.db.delete(record._id)))
    await ctx.db.delete(deckId)
  },
})
