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
    expect(result.averageManaValue).toBe(3);
  });
});
