import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { describe, expect, it } from "vitest";
import { CODEX_MODELS, normalizeReasoningEffort, supportsMaxReasoning } from "./codex-models";

describe("Codex model catalog", () => {
  it("matches Pi's OpenAI Codex provider", () => {
    const piModels = openaiCodexProvider().getModels();
    expect(CODEX_MODELS.map((model) => model.value).sort()).toEqual(
      piModels.map((model) => model.id).sort(),
    );
  });

  it("derives max reasoning support from Pi's catalog", () => {
    const piModels = openaiCodexProvider().getModels();
    for (const model of CODEX_MODELS) {
      const piModel = piModels.find((candidate) => candidate.id === model.value);
      expect(supportsMaxReasoning(model.value)).toBe(piModel?.thinkingLevelMap?.max === "max");
    }
  });

  it("clamps unsupported or invalid reasoning values", () => {
    expect(normalizeReasoningEffort("max", "gpt-5.6-sol")).toBe("max");
    expect(normalizeReasoningEffort("max", "gpt-5.5")).toBe("medium");
    expect(normalizeReasoningEffort("unlimited", "gpt-5.6-sol")).toBe("medium");
  });
});
