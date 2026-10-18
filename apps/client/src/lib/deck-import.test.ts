import { describe, expect, it } from "vitest";
import { parseImportedDecklist } from "./deck-import";

describe("parseImportedDecklist", () => {
  it("preserves Commander, main deck, and maybeboard sections", () => {
    expect(
      parseImportedDecklist(
        "Commander\n1 Alela, Artful Provocateur\nDeck\n1 Sol Ring\n2 Island (FDN) 275\nMaybeboard:\n1 Counterspell",
      ),
    ).toEqual([
      { quantity: 1, name: "Alela, Artful Provocateur", zone: "commander" },
      { quantity: 1, name: "Sol Ring", zone: "main" },
      { quantity: 2, name: "Island", zone: "main" },
      { quantity: 1, name: "Counterspell", zone: "maybeboard" },
    ]);
  });

  it("combines duplicate cards only within the same zone", () => {
    expect(parseImportedDecklist("1 Sol Ring\n2x Sol Ring\nConsidering\n1 Sol Ring")).toEqual([
      { quantity: 3, name: "Sol Ring", zone: "main" },
      { quantity: 1, name: "Sol Ring", zone: "maybeboard" },
    ]);
  });
});
