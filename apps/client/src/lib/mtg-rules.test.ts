import { describe, expect, it } from "vitest";
import currentRulesText from "../data/mtg-rules/MagicCompRules-2026-06-19.txt?raw";
import { parseComprehensiveRules, searchComprehensiveRules } from "./mtg-rules";

const sample = `Magic: The Gathering Comprehensive Rules

These rules are effective as of June 19, 2026.

Contents
100. General

1. Game Concepts
100. General
100.1. These rules apply to any Magic game.
101. The Magic Golden Rules
101.2. When one effect says something can't happen, that effect wins.

Glossary

Flying
A keyword ability that restricts which creatures can block an attacking creature. See rule 702.9.

Credits
Someone`;

describe("comprehensive rules lookup", () => {
  const document = parseComprehensiveRules(sample);

  it("skips the contents and captures metadata, rules, and glossary entries", () => {
    expect(document.effectiveDate).toBe("June 19, 2026");
    expect(document.entries.filter((entry) => entry.id === "100")).toHaveLength(1);
    expect(document.entries).toContainEqual({
      id: "Flying",
      text: "A keyword ability that restricts which creatures can block an attacking creature. See rule 702.9.",
      kind: "glossary",
    });
  });

  it("resolves exact rule numbers and natural-language terms", () => {
    expect(searchComprehensiveRules(document, "rule 101.2")[0]?.id).toBe("101.2");
    expect(searchComprehensiveRules(document, "which creatures can block")[0]?.id).toBe("Flying");
  });
});

describe("current local Wizards document", () => {
  const document = parseComprehensiveRules(currentRulesText);

  it("indexes the expected edition and known rules from the retained source", () => {
    expect(document.effectiveDate).toBe("June 19, 2026");
    expect(document.entries.length).toBeGreaterThan(2500);
    expect(searchComprehensiveRules(document, "704.5f", 1)[0]?.text).toContain(
      "toughness 0 or less",
    );
    expect(
      searchComprehensiveRules(document, "replacement effects", 5).some(({ id }) => id === "616"),
    ).toBe(true);
  });
});
