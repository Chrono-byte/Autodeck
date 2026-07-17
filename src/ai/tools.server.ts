import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { parseDecklist, summarizeDeck } from '../lib/deck-analysis'
import { lookupComprehensiveRules } from '../lib/mtg-rules.server'
import { fetchDeckCards, getScryfallCard, searchScryfall } from '../lib/scryfall.server'

const cardResultSchema = z.object({
  name: z.string(),
  typeLine: z.string(),
  oracleText: z.string().optional(),
  manaValue: z.number(),
  colorIdentity: z.array(z.string()),
  commanderLegality: z.string(),
  url: z.string(),
})

const getCardDefinition = toolDefinition({
  name: 'get_card_text',
  description:
    'Fetch current Oracle text and Commander legality for one named card. For an opening prompt that names a commander, this MUST be your first tool call. Also call it before explaining, judging, comparing, or recommending changes involving any named card. Do not rely on memory.',
  inputSchema: z.object({
    name: z.string().min(1).describe('The printed card name; fuzzy matching corrects minor spelling errors.'),
  }),
  outputSchema: cardResultSchema,
})

export const getCardTool = getCardDefinition.server(async ({ name }) => getScryfallCard(name))

const searchCardsDefinition = toolDefinition({
  name: 'search_cards',
  description:
    'Search current Magic card data using Scryfall syntax. Use this to discover candidates; use get_card_text before giving feedback about a specific named card.',
  inputSchema: z.object({
    query: z.string().min(1).describe('A Scryfall search query, such as id:simic o:"draw a card"'),
    limit: z.number().int().min(1).max(20).default(12),
  }),
  outputSchema: z.array(
    z.object({
      name: z.string(),
      typeLine: z.string(),
      oracleText: z.string().optional(),
      manaValue: z.number(),
      colorIdentity: z.array(z.string()),
      url: z.string(),
    }),
  ),
})

export const searchCardsTool = searchCardsDefinition.server(
  async ({ query, limit }) => searchScryfall(query, limit),
)

const deckAnalysisSchema = z.object({
  totalCards: z.number(),
  resolvedCards: z.number(),
  unresolved: z.array(z.string()),
  counts: z.object({
    lands: z.number(),
    ramp: z.number(),
    draw: z.number(),
    targetedRemoval: z.number(),
    boardWipes: z.number(),
    protection: z.number(),
    tutors: z.number(),
  }),
  examples: z.object({
    lands: z.array(z.string()),
    ramp: z.array(z.string()),
    draw: z.array(z.string()),
    targetedRemoval: z.array(z.string()),
    boardWipes: z.array(z.string()),
    protection: z.array(z.string()),
    tutors: z.array(z.string()),
  }),
  averageManaValue: z.number(),
  note: z.string(),
})

const analyzeDeckDefinition = toolDefinition({
  name: 'analyze_decklist',
  description:
    'Parse and analyze a Commander decklist using current Scryfall card data. Counts functional roles, reports curve, and identifies unresolved card names. Role counts can overlap.',
  inputSchema: z.object({
    decklist: z.string().min(1).describe('One card per line, optionally prefixed with a quantity.'),
  }),
  outputSchema: deckAnalysisSchema,
})

export const analyzeDeckTool = analyzeDeckDefinition.server(async ({ decklist }) => {
  const entries = parseDecklist(decklist)
  if (entries.length === 0) throw new Error('No card names were found in the decklist.')
  if (entries.length > 110) throw new Error('Decklist contains more than 110 unique entries.')
  const { cards, unresolved } = await fetchDeckCards(entries)
  return summarizeDeck(entries, cards, unresolved)
})

const comprehensiveRulesDefinition = toolDefinition({
  name: 'lookup_comprehensive_rules',
  description:
    'Search the locally stored, current official Magic Comprehensive Rules by exact rule number, rules term, or natural-language phrase. Use this before answering rules or card-interaction questions, and cite returned rule numbers.',
  inputSchema: z.object({
    query: z.string().min(1).describe('A rule number such as 704.5f, a term such as deathtouch, or a focused rules question.'),
    limit: z.number().int().min(1).max(12).default(8),
  }),
  outputSchema: z.object({
    source: z.object({
      effectiveDate: z.string(),
      pdfFile: z.string(),
      officialUrl: z.string().url(),
    }),
    matches: z.array(z.object({
      id: z.string(),
      text: z.string(),
      kind: z.enum(['rule', 'glossary']),
    })),
    guidance: z.string(),
  }),
})

export const comprehensiveRulesTool = comprehensiveRulesDefinition.server(
  async ({ query, limit }) => lookupComprehensiveRules(query, limit),
)
