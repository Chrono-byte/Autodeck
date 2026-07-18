import { describe, expect, it } from "vitest";
import {
  queryUsesOracleTags,
  searchLocalDeck,
  type LocalDeckSearchCard,
} from "./local-scryfall-query";

const cards: LocalDeckSearchCard[] = [
  {
    name: "Sol Ring",
    quantity: 1,
    zone: "main",
    typeLine: "Artifact",
    oracleText: "{T}: Add {C}{C}.",
    manaValue: 1,
    colorIdentity: [],
    oracleId: "sol-ring",
    tags: ["Ramp"],
  },
  {
    name: "Cultivate",
    quantity: 1,
    zone: "main",
    typeLine: "Sorcery",
    oracleText: "Search your library for up to two basic land cards.",
    manaValue: 3,
    colorIdentity: ["G"],
    oracleId: "cultivate",
    tags: [],
  },
  {
    name: "Rhystic Study",
    quantity: 1,
    zone: "main",
    typeLine: "Enchantment",
    oracleText: "Whenever an opponent casts a spell, you may draw a card.",
    manaValue: 3,
    colorIdentity: ["U"],
    oracleId: "rhystic-study",
    tags: ["Draw"],
  },
  {
    name: "Island",
    quantity: 12,
    zone: "main",
    typeLine: "Basic Land — Island",
    manaValue: 0,
    colorIdentity: ["U"],
    oracleId: "island",
    tags: [],
  },
];

const oracleTagsById = new Map<string, ReadonlySet<string>>([
  ["sol-ring", new Set(["mana-rock", "ramp"])],
  ["cultivate", new Set(["ramp"])],
  ["rhystic-study", new Set(["card-advantage"])],
]);

describe("searchLocalDeck", () => {
  it("combines Oracle tags, numeric comparisons, types, and negation", () => {
    expect(
      searchLocalDeck(cards, "otag:ramp mv<=2 -t:land", { oracleTagsById }).map(
        (card) => card.name,
      ),
    ).toEqual(["Sol Ring"]);
  });

  it("supports boolean groups, quoted Oracle text, and implicit AND", () => {
    expect(
      searchLocalDeck(cards, '(t:artifact or t:enchantment) -o:"counter target"').map(
        (card) => card.name,
      ),
    ).toEqual(["Sol Ring", "Rhystic Study"]);
    expect(searchLocalDeck(cards, "o:/draw a card/").map((card) => card.name)).toEqual([
      "Rhystic Study",
    ]);
  });

  it("supports exact names, identity subsets, zones, and local deck tags", () => {
    expect(searchLocalDeck(cards, '!"Sol Ring"').map((card) => card.name)).toEqual(["Sol Ring"]);
    expect(searchLocalDeck(cards, "id<=ug -id:c").map((card) => card.name)).toEqual([
      "Cultivate",
      "Rhystic Study",
      "Island",
    ]);
    expect(searchLocalDeck(cards, "zone:main decktag:ramp").map((card) => card.name)).toEqual([
      "Sol Ring",
    ]);
    expect(searchLocalDeck(cards, "commander:ug").map((card) => card.name)).toEqual([
      "Sol Ring",
      "Cultivate",
      "Rhystic Study",
      "Island",
    ]);
  });

  it("rejects unsupported operators instead of silently approximating them", () => {
    expect(() => searchLocalDeck(cards, "price<2")).toThrow(
      'Unsupported local Scryfall operator "price"',
    );
  });

  it("detects when a query needs the local Oracle-tag index", () => {
    expect(queryUsesOracleTags("(otag:ramp or t:land) -oracletag:draw")).toBe(true);
    expect(queryUsesOracleTags("t:artifact mv<=2")).toBe(false);
  });
});
