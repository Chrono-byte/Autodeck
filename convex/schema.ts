import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  decks: defineTable({
    ownerId: v.string(),
    name: v.string(),
    format: v.literal('commander'),
    commanderName: v.optional(v.string()),
    description: v.optional(v.string()),
    colorIdentity: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_owner_updated', ['ownerId', 'updatedAt']),

  threads: defineTable({
    ownerId: v.string(),
    deckId: v.id('decks'),
    title: v.string(),
    archived: v.boolean(),
    messageState: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_deck_updated', ['deckId', 'updatedAt'])
    .index('by_owner_updated', ['ownerId', 'updatedAt']),

  deckCards: defineTable({
    ownerId: v.string(),
    deckId: v.id('decks'),
    name: v.string(),
    normalizedName: v.string(),
    quantity: v.number(),
    zone: v.union(v.literal('commander'), v.literal('main'), v.literal('maybeboard')),
    typeLine: v.string(),
    oracleText: v.optional(v.string()),
    manaValue: v.number(),
    colorIdentity: v.array(v.string()),
    tags: v.array(v.string()),
    addedBy: v.union(v.literal('user'), v.literal('assistant')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_deck', ['deckId'])
    .index('by_deck_name_zone', ['deckId', 'normalizedName', 'zone']),

  deckEvents: defineTable({
    ownerId: v.string(),
    deckId: v.id('decks'),
    threadId: v.optional(v.id('threads')),
    actor: v.union(v.literal('user'), v.literal('assistant')),
    action: v.string(),
    cardName: v.optional(v.string()),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_deck_created', ['deckId', 'createdAt']),
})
