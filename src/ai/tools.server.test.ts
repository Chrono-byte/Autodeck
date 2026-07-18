import { describe, expect, it } from "vitest";
import {
  activeDeckEntries,
  analyzeDeckInputSchema,
  createSearchActiveDeckTool,
} from "./tools.server";

describe("analyzeDeckInputSchema", () => {
  it("treats a null decklist as a request to analyze the live deck", () => {
    expect(analyzeDeckInputSchema.parse({ decklist: null })).toEqual({ decklist: null });
    expect(analyzeDeckInputSchema.parse({})).toEqual({});
  });
});

describe("activeDeckEntries", () => {
  it("reads the playable active deck while excluding the maybeboard", () => {
    expect(
      activeDeckEntries([
        { name: "Talrand, Sky Summoner", quantity: 1, zone: "commander" },
        { name: "Island", quantity: 20, zone: "main" },
        { name: "Counterspell", quantity: 1, zone: "main" },
        { name: "Negate", quantity: 1, zone: "maybeboard" },
      ]),
    ).toEqual([
      { name: "Talrand, Sky Summoner", quantity: 1 },
      { name: "Island", quantity: 20 },
      { name: "Counterspell", quantity: 1 },
    ]);
  });

  it("combines a card stored in multiple playable zones", () => {
    expect(
      activeDeckEntries([
        { name: "Faceless One", quantity: 1, zone: "commander" },
        { name: "Faceless One", quantity: 2, zone: "main" },
      ]),
    ).toEqual([{ name: "Faceless One", quantity: 3 }]);
  });
});

describe("createSearchActiveDeckTool", () => {
  it("executes a compound query locally and excludes the maybeboard by default", async () => {
    const tool = createSearchActiveDeckTool(async () => ({
      cards: [
        {
          name: "Sol Ring",
          quantity: 1,
          zone: "main" as const,
          typeLine: "Artifact",
          oracleText: "{T}: Add {C}{C}.",
          manaValue: 1,
          colorIdentity: [],
          tags: ["Ramp"],
        },
        {
          name: "Arcane Denial",
          quantity: 1,
          zone: "maybeboard" as const,
          typeLine: "Instant",
          oracleText: "Counter target spell.",
          manaValue: 2,
          colorIdentity: ["U"],
          tags: [],
        },
      ],
    }));

    const result = await tool.execute?.({
      query: "t:artifact mv<=2",
      includeMaybeboard: null,
    });

    expect(result).toMatchObject({
      searchedCards: 1,
      matchedCards: 1,
      matchedQuantity: 1,
      matches: [expect.objectContaining({ name: "Sol Ring" })],
    });
  });
});
