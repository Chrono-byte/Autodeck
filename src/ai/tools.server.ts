import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { parseDecklist, summarizeDeck, type DeckEntry } from "../lib/deck-analysis";
import { searchBraveWeb } from "../lib/brave-search.server";
import { lookupComprehensiveRules } from "../lib/mtg-rules.server";
import { scryfallOracleTagCatalog } from "../lib/scryfall-tags.server";
import { fetchDeckCards, getScryfallCard, searchScryfall } from "../lib/scryfall.server";

const cardResultSchema = z.object({
  name: z.string(),
  typeLine: z.string(),
  oracleText: z.string().optional(),
  manaValue: z.number(),
  colorIdentity: z.array(z.string()),
  commanderLegality: z.string(),
  url: z.string(),
});

const getCardDefinition = toolDefinition({
  name: "get_card_text",
  description:
    "Fetch current Oracle text and Commander legality for one named card. For an opening prompt that names a commander, this MUST be your first tool call. Also call it before explaining, judging, comparing, or recommending changes involving any named card. Do not rely on memory.",
  inputSchema: z.object({
    name: z
      .string()
      .min(1)
      .describe("The printed card name; fuzzy matching corrects minor spelling errors."),
  }),
  outputSchema: cardResultSchema,
});

export const getCardTool = getCardDefinition.server(async ({ name }) => getScryfallCard(name));

const searchCardsDefinition = toolDefinition({
  name: "search_cards",
  description:
    "Search current Magic card data using Scryfall syntax. Use this to discover candidates; use get_card_text before giving feedback about a specific named card.",
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
});

export const searchCardsTool = searchCardsDefinition.server(async ({ query, limit }) =>
  searchScryfall(query, limit),
);

const oracleTagSummarySchema = z.object({
  label: z.string(),
  slug: z.string(),
});

const searchOracleTagsDefinition = toolDefinition({
  name: "search_oracle_tags",
  description:
    "Discover Scryfall Tagger Oracle tags by gameplay concept. Returns current community-curated tag definitions, aliases, hierarchy, card counts, and a ready-to-use otag search query. Use this when you know the role or synergy you want but do not know the correct Scryfall tag. Then pass a returned searchQuery, optionally with other Scryfall filters, to search_cards.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .max(120)
      .describe("A concise gameplay concept such as repeatable card draw or sacrifice outlet."),
    limit: z.number().int().min(1).max(15).default(8),
  }),
  outputSchema: z.object({
    updatedAt: z.string(),
    matches: z.array(
      oracleTagSummarySchema.extend({
        description: z.string().optional(),
        aliases: z.array(z.string()),
        parents: z.array(oracleTagSummarySchema),
        children: z.array(oracleTagSummarySchema),
        directCardCount: z.number().int().nonnegative(),
        cardCount: z.number().int().nonnegative(),
        searchQuery: z.string(),
        taggerUrl: z.string().url(),
      }),
    ),
  }),
});

export const searchOracleTagsTool = searchOracleTagsDefinition.server(async ({ query, limit }) =>
  scryfallOracleTagCatalog.search(query, limit),
);

const getCardOracleTagsDefinition = toolDefinition({
  name: "get_card_oracle_tags",
  description:
    "Look up the current Scryfall Tagger Oracle tags associated with one named card. Direct tags were assigned to that card; inherited tags are its broader parent categories. Use this to understand a card's community-classified roles or to discover tags for finding similar cards. Tags are discovery metadata, not authoritative card text or rules.",
  inputSchema: z.object({
    name: z.string().min(1).describe("The printed card name; fuzzy matching is supported."),
    limit: z.number().int().min(1).max(60).default(40),
  }),
  outputSchema: z.object({
    updatedAt: z.string(),
    cardName: z.string(),
    tags: z.array(
      oracleTagSummarySchema.extend({
        description: z.string().optional(),
        relationship: z.enum(["direct", "inherited"]),
        searchQuery: z.string(),
        taggerUrl: z.string().url(),
      }),
    ),
  }),
});

export const getCardOracleTagsTool = getCardOracleTagsDefinition.server(async ({ name, limit }) =>
  scryfallOracleTagCatalog.tagsForCard(name, limit),
);

const colorBalanceEntrySchema = z.object({
  pips: z.number(),
  sources: z.number(),
  pipShare: z.number(),
  sourceShare: z.number(),
  assessment: z.enum(["noDemand", "unsupported", "underSupported", "balanced", "overSupported"]),
});

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
  manaCurve: z.object({
    "0": z.number(),
    "1": z.number(),
    "2": z.number(),
    "3": z.number(),
    "4": z.number(),
    "5": z.number(),
    "6": z.number(),
    "7+": z.number(),
  }),
  nonlandCards: z.number(),
  averageManaValue: z.number(),
  colorBalance: z.object({
    colors: z.object({
      W: colorBalanceEntrySchema,
      U: colorBalanceEntrySchema,
      B: colorBalanceEntrySchema,
      R: colorBalanceEntrySchema,
      G: colorBalanceEntrySchema,
    }),
    totalPips: z.number(),
    totalSourceAssignments: z.number(),
    reusableSourceCards: z.number(),
    sourceDensity: z.number(),
    overallSourceCountAssessment: z.enum(["low", "reasonable"]),
    note: z.string(),
  }),
  note: z.string(),
});

const analyzeDeckDefinition = toolDefinition({
  name: "analyze_decklist",
  description:
    "Analyze the active Commander deck, or parse a supplied decklist, using current Scryfall card data. Omit decklist to read the live active deck. Counts functional roles, returns a quantity-weighted mana curve and average mana value excluding pure lands, and identifies unresolved card names. Spell/land modal cards appear in both the land count and mana curve. Role counts can overlap.",
  inputSchema: z.object({
    decklist: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional pasted list with one card per line. Omit this field to analyze the live active deck.",
      ),
  }),
  outputSchema: deckAnalysisSchema,
});

type ActiveDeckAnalysisCard = {
  name: string;
  quantity: number;
  zone: "commander" | "main" | "maybeboard";
};

export function activeDeckEntries(cards: ActiveDeckAnalysisCard[]): DeckEntry[] {
  const entries = new Map<string, DeckEntry>();
  for (const card of cards) {
    if (card.zone === "maybeboard") continue;
    const key = card.name.toLocaleLowerCase();
    const existing = entries.get(key);
    entries.set(key, {
      name: existing?.name ?? card.name,
      quantity: (existing?.quantity ?? 0) + card.quantity,
    });
  }
  return [...entries.values()];
}

export function createAnalyzeDeckTool(
  readActiveDeck: () => Promise<{ cards: ActiveDeckAnalysisCard[] }>,
) {
  return analyzeDeckDefinition.server(async ({ decklist }) => {
    const entries = decklist
      ? parseDecklist(decklist)
      : activeDeckEntries((await readActiveDeck()).cards);
    if (entries.length === 0) {
      throw new Error(
        decklist
          ? "No card names were found in the decklist."
          : "No cards were found in the active deck.",
      );
    }
    if (entries.length > 110) throw new Error("Decklist contains more than 110 unique entries.");
    const { cards, unresolved } = await fetchDeckCards(entries);
    return summarizeDeck(entries, cards, unresolved);
  });
}

const comprehensiveRulesDefinition = toolDefinition({
  name: "lookup_comprehensive_rules",
  description:
    "Search the locally stored, current official Magic Comprehensive Rules by exact rule number, rules term, or natural-language phrase. Use this before answering rules or card-interaction questions, and cite returned rule numbers.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        "A rule number such as 704.5f, a term such as deathtouch, or a focused rules question.",
      ),
    limit: z.number().int().min(1).max(12).default(8),
  }),
  outputSchema: z.object({
    source: z.object({
      effectiveDate: z.string(),
      pdfFile: z.string(),
      officialUrl: z.string().url(),
    }),
    matches: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        kind: z.enum(["rule", "glossary"]),
      }),
    ),
    guidance: z.string(),
  }),
});

export const comprehensiveRulesTool = comprehensiveRulesDefinition.server(
  async ({ query, limit }) => lookupComprehensiveRules(query, limit),
);

const braveSearchDefinition = toolDefinition({
  name: "search_web",
  description:
    "Search the current web with Brave Search for Commander deck-tech guides, strategy articles, metagame context, budget ideas, and other time-sensitive sources. Return source URLs and snippets. Use focused queries, compare multiple sources, and cite the URLs used in the answer.",
  inputSchema: z.object({
    query: z.string().min(1).max(400).describe("A focused web query of no more than 50 words."),
    count: z.number().int().min(1).max(20).default(6),
    freshness: z
      .enum(["pd", "pw", "pm", "py"])
      .optional()
      .describe("Optional freshness: past day, week, month, or year."),
  }),
  outputSchema: z.object({
    query: z.string(),
    moreResultsAvailable: z.boolean(),
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string().url(),
        description: z.string(),
        age: z.string().optional(),
        extraSnippets: z.array(z.string()),
      }),
    ),
  }),
});

export const braveSearchTool = braveSearchDefinition.server(async ({ query, count, freshness }) =>
  searchBraveWeb({ query, count, freshness }),
);
