import { describe, expect, it } from "vitest";
import { formatMtgoDeck, mtgoExportFilename } from "./mtgo-export";

describe("formatMtgoDeck", () => {
  it("writes an alphabetical main deck followed by commanders after a blank line", () => {
    expect(
      formatMtgoDeck([
        { name: "Sol Ring", quantity: 1, zone: "main" },
        { name: "Island", quantity: 12, zone: "main" },
        { name: "Talrand, Sky Summoner", quantity: 1, zone: "commander" },
      ]),
    ).toBe("12 Island\r\n1 Sol Ring\r\n\r\n1 Talrand, Sky Summoner\r\n");
  });

  it("omits maybeboard cards because MTGO has no maybeboard section", () => {
    expect(
      formatMtgoDeck([
        { name: "Counterspell", quantity: 1, zone: "main" },
        { name: "Negate", quantity: 1, zone: "maybeboard" },
      ]),
    ).toBe("1 Counterspell\r\n");
  });
});

describe("mtgoExportFilename", () => {
  it("creates a safe text filename", () => {
    expect(mtgoExportFilename("Alela: Artifacts / Faeries?")).toBe(
      "Alela- Artifacts - Faeries-mtgo.txt",
    );
    expect(mtgoExportFilename("  ")).toBe("deck-mtgo.txt");
  });
});
