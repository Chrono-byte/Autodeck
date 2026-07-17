import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

const zoneSchema = z.enum(['commander', 'main', 'maybeboard'])

export const getActiveDeckDefinition = toolDefinition({
  name: 'get_active_deck',
  description:
    'Read the active deck and its current card list before assessing the deck, its ratios, or proposed changes. This returns the live list edited by both the user and assistant.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    deck: z.object({
      name: z.string(),
      commanderName: z.string().optional(),
      colorIdentity: z.array(z.string()),
    }),
    cards: z.array(
      z.object({
        name: z.string(), quantity: z.number(), zone: zoneSchema,
        typeLine: z.string(), oracleText: z.string().optional(),
        manaValue: z.number(), tags: z.array(z.string()),
      }),
    ),
  }),
})

export const editActiveDeckDefinition = toolDefinition({
  name: 'edit_active_deck',
  description:
    'Edit the active deck after verifying card text. Use upsert to add or change a card and remove to cut it. State the reason in chat after the tool succeeds.',
  inputSchema: z.object({
    action: z.enum(['upsert', 'remove']),
    cardName: z.string().min(1),
    quantity: z.number().int().min(1).max(99).default(1),
    zone: zoneSchema.default('main'),
    tags: z.array(z.string()).default([]),
  }),
  outputSchema: z.object({ success: z.boolean(), message: z.string() }),
})
