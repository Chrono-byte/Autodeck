import { describe, expect, it } from "vitest";
import { splitManaText } from "./mana-markdown";

describe("mana markdown", () => {
  it("extracts single, hybrid, and generic mana symbols", () => {
    const nodes = splitManaText("Pay ${W}$, ${WU}$, or ${2/W}$ plus ${10}$.");

    expect(nodes.filter((node) => node.type === "manaSymbol")).toHaveLength(4);
    expect(nodes.map((node) => node.children?.[0]?.value).filter(Boolean)).toEqual([
      "W",
      "WU",
      "2/W",
      "10",
    ]);
  });

  it("leaves invalid and ordinary template syntax alone", () => {
    const value = "Keep ${variable}$ and ${HELLO}$ as text.";
    expect(splitManaText(value)).toEqual([{ type: "text", value }]);
  });

  it("recognizes downloaded official symbol aliases", () => {
    const nodes = splitManaText("${WUP}$ ${100}$ ${∞}$ ${HALF}$");
    expect(nodes.filter((node) => node.type === "manaSymbol")).toHaveLength(4);
  });
});
