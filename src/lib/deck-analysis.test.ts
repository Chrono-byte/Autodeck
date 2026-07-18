import { describe, expect, it } from "vitest";
import { classifyCard, parseDecklist, summarizeDeck, type ScryfallCard } from "./deck-analysis";

describe("parseDecklist", () => {
  it("parses common Arena and plain-text formats", () => {
    expect(
      parseDecklist("Commander\n1x Sol Ring\n2 Island (FDN) 275\n- Arcane Signet # ramp"),
    ).toEqual([
      { quantity: 1, name: "Sol Ring" },
      { quantity: 2, name: "Island" },
      { quantity: 1, name: "Arcane Signet" },
    ]);
  });

  it("ignores common deck section headers", () => {
    expect(
      parseDecklist("Commander\n1 Atraxa, Praetors' Voice\nMainboard\n2 Forest\nMaybeboard"),
    ).toEqual([
      { quantity: 1, name: "Atraxa, Praetors' Voice" },
      { quantity: 2, name: "Forest" },
    ]);
  });
});

describe("classifyCard", () => {
  it("allows a card to fill more than one functional role", () => {
    const card: ScryfallCard = {
      name: "Elegant Multi-tool",
      type_line: "Instant",
      oracle_text: "Destroy target creature. Draw a card.",
      cmc: 2,
      color_identity: ["U", "B"],
    };
    expect(classifyCard(card)).toEqual(["draw", "targetedRemoval"]);
  });

  it("does not count lands that tap for mana as ramp", () => {
    const card: ScryfallCard = {
      name: "Forest",
      type_line: "Basic Land — Forest",
      oracle_text: "({T}: Add {G}.)",
      cmc: 0,
      color_identity: ["G"],
    };
    expect(classifyCard(card)).toEqual(["lands"]);
  });

  it("recognizes mana-symbol producers as ramp", () => {
    const card: ScryfallCard = {
      name: "Sol Ring",
      type_line: "Artifact",
      oracle_text: "{T}: Add {C}{C}.",
      cmc: 1,
      color_identity: [],
    };
    expect(classifyCard(card)).toContain("ramp");
  });
});

describe("summarizeDeck", () => {
  it("weights quantities and excludes lands from average mana value", () => {
    const entries = [
      { quantity: 2, name: "Island" },
      { quantity: 1, name: "Divination" },
    ];
    const cards: ScryfallCard[] = [
      { name: "Island", type_line: "Basic Land — Island", cmc: 0, color_identity: ["U"] },
      {
        name: "Divination",
        type_line: "Sorcery",
        oracle_text: "Draw two cards.",
        cmc: 3,
        color_identity: ["U"],
      },
    ];
    const result = summarizeDeck(entries, cards, []);
    expect(result.totalCards).toBe(3);
    expect(result.counts.lands).toBe(2);
    expect(result.counts.draw).toBe(1);
    expect(result.nonlandCards).toBe(1);
    expect(result.manaCurve).toEqual({
      "0": 0,
      "1": 0,
      "2": 0,
      "3": 1,
      "4": 0,
      "5": 0,
      "6": 0,
      "7+": 0,
    });
    expect(result.averageManaValue).toBe(3);
  });

  it("weights curve buckets and resolved cards by quantity", () => {
    const entries = [
      { quantity: 2, name: "Known Spell" },
      { quantity: 4, name: "Unknown Spell" },
    ];
    const cards: ScryfallCard[] = [
      { name: "Known Spell", type_line: "Sorcery", cmc: 7.5, color_identity: [] },
    ];

    const result = summarizeDeck(entries, cards, ["Unknown Spell"]);

    expect(result.totalCards).toBe(6);
    expect(result.resolvedCards).toBe(2);
    expect(result.nonlandCards).toBe(2);
    expect(result.manaCurve["7+"]).toBe(2);
    expect(result.averageManaValue).toBe(7.5);
  });

  it("includes modal spell/lands in both the land count and spell curve", () => {
    const entries = [{ quantity: 1, name: "Bala Ged Recovery // Bala Ged Sanctuary" }];
    const cards: ScryfallCard[] = [
      {
        name: "Bala Ged Recovery // Bala Ged Sanctuary",
        type_line: "Sorcery // Land",
        cmc: 3,
        color_identity: ["G"],
        card_faces: [
          { name: "Bala Ged Recovery", type_line: "Sorcery" },
          { name: "Bala Ged Sanctuary", type_line: "Land" },
        ],
      },
    ];

    const result = summarizeDeck(entries, cards, []);

    expect(result.counts.lands).toBe(1);
    expect(result.nonlandCards).toBe(1);
    expect(result.manaCurve["3"]).toBe(1);
  });

  it("compares colored pip demand with reusable mana sources", () => {
    const entries = [
      { quantity: 2, name: "White Spell" },
      { quantity: 1, name: "Hybrid Spell" },
      { quantity: 3, name: "Plains" },
      { quantity: 1, name: "Island" },
      { quantity: 1, name: "Flexible Rock" },
      { quantity: 1, name: "One-shot Ritual" },
    ];
    const cards: ScryfallCard[] = [
      {
        name: "White Spell",
        type_line: "Creature",
        mana_cost: "{1}{W}{W}",
        cmc: 3,
        color_identity: ["W"],
      },
      {
        name: "Hybrid Spell",
        type_line: "Creature",
        mana_cost: "{W/U}",
        cmc: 1,
        color_identity: ["W", "U"],
      },
      {
        name: "Plains",
        type_line: "Basic Land — Plains",
        cmc: 0,
        color_identity: ["W"],
        produced_mana: ["W"],
      },
      {
        name: "Island",
        type_line: "Basic Land — Island",
        cmc: 0,
        color_identity: ["U"],
        produced_mana: ["U"],
      },
      {
        name: "Flexible Rock",
        type_line: "Artifact",
        oracle_text: "{T}: Add one mana of any color.",
        cmc: 2,
        color_identity: ["W", "U"],
        produced_mana: ["W", "U"],
      },
      {
        name: "One-shot Ritual",
        type_line: "Instant",
        oracle_text: "Add {U}.",
        mana_cost: "{U}",
        cmc: 1,
        color_identity: ["U"],
        produced_mana: ["U"],
      },
    ];

    const result = summarizeDeck(entries, cards, []);

    expect(result.colorBalance.totalPips).toBe(6);
    expect(result.colorBalance.totalSourceAssignments).toBe(6);
    expect(result.colorBalance.reusableSourceCards).toBe(5);
    expect(result.colorBalance.sourceDensity).toBe(0.556);
    expect(result.colorBalance.overallSourceCountAssessment).toBe("reasonable");
    expect(result.colorBalance.colors.W).toMatchObject({
      pips: 4.5,
      sources: 4,
      assessment: "underSupported",
    });
    expect(result.colorBalance.colors.U).toMatchObject({
      pips: 1.5,
      sources: 2,
      assessment: "overSupported",
    });
  });
});
