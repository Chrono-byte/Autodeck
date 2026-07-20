import { describe, expect, it } from "vitest";
import {
  CODEX_MODELS,
  DEFAULT_CODEX_MODEL,
  isCodexModel,
  normalizeReasoningEffort,
  supportsMaxReasoning,
} from "./codex-models";

describe("Codex model catalog", () => {
  it("contains unique model identifiers and its default", () => {
    const ids = CODEX_MODELS.map((model) => model.value);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isCodexModel(DEFAULT_CODEX_MODEL)).toBe(true);
  });

  it("reports max reasoning support from the UI catalog", () => {
    for (const model of CODEX_MODELS) {
      expect(supportsMaxReasoning(model.value)).toBe(model.maxReasoning);
    }
  });

  it("clamps unsupported or invalid reasoning values", () => {
    expect(normalizeReasoningEffort("max", "gpt-5.6-sol")).toBe("max");
    expect(normalizeReasoningEffort("max", "gpt-5.5")).toBe("medium");
    expect(normalizeReasoningEffort("unlimited", "gpt-5.6-sol")).toBe("medium");
  });
});
