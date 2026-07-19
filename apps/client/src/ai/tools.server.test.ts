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
          oracleId: "sol-ring",
          oracleTags: ["mana-rock", "ramp"],
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
          oracleId: "arcane-denial",
          oracleTags: ["counterspell"],
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

  it("searches stored Oracle tags without resolving cards during execution", async () => {
    let reads = 0;
    const tool = createSearchActiveDeckTool(async () => {
      reads += 1;
      return {
        cards: [
          {
            name: "Sol Ring",
            quantity: 1,
            zone: "main" as const,
            typeLine: "Artifact",
            oracleText: "{T}: Add {C}{C}.",
            manaValue: 1,
            colorIdentity: [],
            oracleId: "sol-ring",
            oracleTags: ["mana-rock", "ramp"],
            tags: [],
          },
          {
            name: "Worn Powerstone",
            quantity: 1,
            zone: "main" as const,
            typeLine: "Artifact",
            oracleText: "Worn Powerstone enters tapped.",
            manaValue: 3,
            colorIdentity: [],
            oracleId: "worn-powerstone",
            oracleTags: ["mana-rock", "ramp"],
            tags: [],
          },
        ],
      };
    });

    const result = await tool.execute?.({ query: "otag:mana-rock mv<=2" });

    expect(reads).toBe(1);
    expect(result).toMatchObject({
      matchedCards: 1,
      warnings: [],
      matches: [expect.objectContaining({ name: "Sol Ring" })],
    });
  });

  it("warns when legacy cards have not been locally indexed for Oracle tags", async () => {
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
          tags: [],
        },
      ],
    }));

    const result = await tool.execute?.({ query: "otag:ramp" });

    expect(result).toMatchObject({
      matchedCards: 0,
      warnings: [expect.stringContaining("Local Oracle-tag metadata is missing for: Sol Ring")],
    });
  });

  it("searches stored art tags and warns about missing local art metadata", async () => {
    const tool = createSearchActiveDeckTool(async () => ({
      cards: [
        {
          name: "Dragon's Hoard",
          quantity: 1,
          zone: "main" as const,
          typeLine: "Artifact",
          manaValue: 3,
          colorIdentity: [],
          artTags: ["dragon"],
          tags: [],
        },
        {
          name: "Sol Ring",
          quantity: 1,
          zone: "main" as const,
          typeLine: "Artifact",
          manaValue: 1,
          colorIdentity: [],
          tags: [],
        },
      ],
    }));

    const result = await tool.execute?.({ query: "art:dragon" });

    expect(result).toMatchObject({
      matchedCards: 1,
      matches: [expect.objectContaining({ name: "Dragon's Hoard" })],
      warnings: [expect.stringContaining("Local art-tag metadata is missing for: Sol Ring")],
    });
  });
});
