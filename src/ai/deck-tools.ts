import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

const zoneSchema = z.enum(["commander", "main", "maybeboard"]);

export const getActiveDeckDefinition = toolDefinition({
  name: "get_active_deck",
  description:
    "Read the live active deck and its card-level state for inspection or proposed edits.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    deck: z.object({
      name: z.string(),
      commanderName: z.string().optional(),
      colorIdentity: z.array(z.string()),
    }),
    cards: z.array(
      z.object({
        name: z.string(),
        quantity: z.number(),
        zone: zoneSchema,
        typeLine: z.string(),
        oracleText: z.string().optional(),
        manaValue: z.number(),
        colorIdentity: z.array(z.string()),
        tags: z.array(z.string()),
      }),
    ),
  }),
});

export const editActiveDeckDefinition = toolDefinition({
  name: "edit_active_deck",
  description: "Add, update, or remove one card in the live active deck.",
  inputSchema: z.object({
    action: z.enum(["upsert", "remove"]),
    cardName: z.string().min(1),
    quantity: z.number().int().min(1).max(99).default(1),
    zone: zoneSchema.default("main"),
    tags: z.array(z.string()).default([]),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    playableCardCount: z.number().int().nonnegative().optional(),
  }),
});

export type DeckToolContext = {
  readDeck: () => {
    deck: { name: string; commanderName?: string; colorIdentity: string[] };
    cards: Array<{
      name: string;
      quantity: number;
      zone: "commander" | "main" | "maybeboard";
      typeLine: string;
      oracleText?: string;
      manaValue: number;
      colorIdentity: string[];
      tags: string[];
    }>;
  };
  editDeck: (input: {
    action: "upsert" | "remove";
    cardName: string;
    quantity: number;
    zone: "commander" | "main" | "maybeboard";
    tags: string[];
  }) => Promise<{ success: boolean; message: string; playableCardCount?: number }>;
};

export const getActiveDeckClientTool = getActiveDeckDefinition.client<DeckToolContext>(
  (_input, ctx) => ctx.context.readDeck(),
);

export const editActiveDeckClientTool = editActiveDeckDefinition.client<DeckToolContext>(
  (input, ctx) =>
    ctx.context.editDeck({
      action: input.action,
      cardName: input.cardName,
      quantity: input.quantity ?? 1,
      zone: input.zone ?? "main",
      tags: input.tags ?? [],
    }),
);
