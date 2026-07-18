import { describe, expect, it } from "vitest";
import { activeDeckEntries } from "./tools.server";

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
