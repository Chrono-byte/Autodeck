import { describe, expect, it } from "vitest";
import { cleanGeneratedThreadTitle } from "./thread-title";

describe("cleanGeneratedThreadTitle", () => {
  it("removes model formatting and trailing punctuation", () => {
    expect(cleanGeneratedThreadTitle('Title: **"Fixing the mana curve."**')).toBe(
      "Fixing the mana curve",
    );
  });

  it("uses only the first line", () => {
    expect(cleanGeneratedThreadTitle("Choosing a new commander\nAdditional explanation")).toBe(
      "Choosing a new commander",
    );
  });

  it("limits long titles", () => {
    const title = cleanGeneratedThreadTitle(
      "Review every creature in this Commander deck and identify the weakest cards to replace",
    );
    expect(title.length).toBeLessThanOrEqual(65);
    expect(title.endsWith("…")).toBe(true);
  });

  it("returns a fallback for an empty response", () => {
    expect(cleanGeneratedThreadTitle(" ** ")).toBe("New conversation");
  });
});
