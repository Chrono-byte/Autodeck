import { describe, expect, it } from "vitest";
import type { ScryfallCard } from "./deck-analysis";
import {
  commandersCanPartner,
  validateAssistantAddition,
  validateCommanderDeck,
  type CommanderDeckCard,
  type ResolvedCommanderCard,
} from "./commander-validation";

function currentCard(
  name: string,
  typeLine: string,
  colorIdentity: string[],
  legality = "legal",
  oracleText?: string,
): ScryfallCard {
  return {
    name,
    type_line: typeLine,
    oracle_text: oracleText,
    cmc: 0,
    color_identity: colorIdentity,
    legalities: { commander: legality },
  };
}

const talrand: CommanderDeckCard = {
  name: "Talrand, Sky Summoner",
  quantity: 1,
  zone: "commander",
  typeLine: "Legendary Creature — Merfolk Wizard",
  oracleText:
    "Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.",
  colorIdentity: ["U"],
};

describe("validateCommanderDeck", () => {
  it("accepts a complete legal deck and basic-land copies", () => {
    const cards: CommanderDeckCard[] = [
      talrand,
      {
        name: "Island",
        quantity: 98,
        zone: "main",
        typeLine: "Basic Land — Island",
        colorIdentity: ["U"],
      },
      {
        name: "Sol Ring",
        quantity: 1,
        zone: "main",
        typeLine: "Artifact",
        colorIdentity: [],
      },
    ];
    const current = [
      currentCard(talrand.name, talrand.typeLine, ["U"]),
      currentCard("Island", "Basic Land — Island", ["U"]),
      currentCard("Sol Ring", "Artifact", []),
    ];

    expect(validateCommanderDeck(cards, current)).toMatchObject({
      valid: true,
      totalCards: 100,
      commanderCount: 1,
      errors: [],
      warnings: [],
    });
  });

  it("reports count, singleton, color-identity, and legality failures together", () => {
    const cards: CommanderDeckCard[] = [
      talrand,
      {
        name: "Lightning Bolt",
        quantity: 2,
        zone: "main",
        typeLine: "Instant",
        colorIdentity: ["R"],
      },
    ];
    const result = validateCommanderDeck(cards, [
      currentCard(talrand.name, talrand.typeLine, ["U"]),
      currentCard("Lightning Bolt", "Instant", ["R"], "banned"),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("3 cards"),
        expect.stringContaining("banned"),
        expect.stringContaining("color identity"),
        expect.stringContaining("singleton exception"),
      ]),
    );
  });

  it("allows a recognized commander and Background pair", () => {
    expect(
      commandersCanPartner(
        {
          name: "Wilson, Refined Grizzly",
          typeLine: "Legendary Creature — Bear Warrior",
          oracleText: "Choose a Background",
        },
        {
          name: "Raised by Giants",
          typeLine: "Legendary Enchantment — Background",
          oracleText: "Commander creatures you own have base power and toughness 10/10.",
        },
      ),
    ).toBe(true);
  });

  it("requires matching partner variants and reciprocal partner-with names", () => {
    expect(
      commandersCanPartner(
        {
          name: "One",
          typeLine: "Legendary Creature — Human",
          oracleText: "Survivors",
        },
        {
          name: "Two",
          typeLine: "Legendary Creature — Human",
          oracleText: "Friends forever",
        },
      ),
    ).toBe(false);
    expect(
      commandersCanPartner(
        {
          name: "One",
          typeLine: "Legendary Creature — Human",
          oracleText: "Partner with Two",
        },
        {
          name: "Two",
          typeLine: "Legendary Creature — Human",
          oracleText: "Partner with One",
        },
      ),
    ).toBe(true);
  });

  it("does not accept a noncreature Background as the only commander", () => {
    const background: CommanderDeckCard = {
      name: "Raised by Giants",
      quantity: 1,
      zone: "commander",
      typeLine: "Legendary Enchantment — Background",
      colorIdentity: ["G"],
    };

    expect(
      validateCommanderDeck(
        [background],
        [currentCard(background.name, background.typeLine, ["G"])],
      ).errors,
    ).toContain("Raised by Giants requires a commander with Choose a Background.");
  });
});

describe("validateAssistantAddition", () => {
  const legalBlueCard: ResolvedCommanderCard = {
    name: "Counterspell",
    typeLine: "Instant",
    oracleText: "Counter target spell.",
    colorIdentity: ["U"],
    commanderLegality: "legal",
  };

  it("allows an upsert that replaces the existing quantity in the same zone", () => {
    expect(
      validateAssistantAddition(legalBlueCard, "main", 1, [
        talrand,
        { ...legalBlueCard, quantity: 1, zone: "main" },
      ]),
    ).toEqual([]);
  });

  it("rejects off-color and Commander-illegal playable additions", () => {
    expect(
      validateAssistantAddition(
        {
          name: "Off-color card",
          typeLine: "Sorcery",
          colorIdentity: ["R"],
          commanderLegality: "banned",
        },
        "main",
        1,
        [talrand],
      ),
    ).toEqual([
      "Off-color card is banned in Commander.",
      "Off-color card is outside the active commanders' color identity.",
    ]);
  });

  it("allows maybeboard ideas without treating them as playable deck entries", () => {
    expect(
      validateAssistantAddition(
        {
          name: "Off-color idea",
          typeLine: "Sorcery",
          colorIdentity: ["R"],
          commanderLegality: "not_legal",
        },
        "maybeboard",
        1,
        [talrand],
      ),
    ).toEqual([]);
  });
});
