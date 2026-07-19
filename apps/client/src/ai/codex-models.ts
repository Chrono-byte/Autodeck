export const CODEX_MODELS = [
  { value: "gpt-5.6-sol", label: "5.6 Sol", maxReasoning: true },
  { value: "gpt-5.6-terra", label: "5.6 Terra", maxReasoning: true },
  { value: "gpt-5.6-luna", label: "5.6 Luna", maxReasoning: true },
  { value: "gpt-5.5", label: "5.5", maxReasoning: false },
  { value: "gpt-5.4", label: "5.4", maxReasoning: false },
  { value: "gpt-5.4-mini", label: "5.4 Mini", maxReasoning: false },
  { value: "gpt-5.3-codex-spark", label: "5.3 Codex Spark", maxReasoning: false },
] as const;

export type CodexModel = (typeof CODEX_MODELS)[number]["value"];
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export const DEFAULT_CODEX_MODEL: CodexModel = "gpt-5.6-sol";

export function isCodexModel(value: unknown): value is CodexModel {
  return typeof value === "string" && CODEX_MODELS.some((model) => model.value === value);
}

export function supportsMaxReasoning(model: CodexModel) {
  return CODEX_MODELS.find((candidate) => candidate.value === model)?.maxReasoning === true;
}

export function normalizeReasoningEffort(value: unknown, model: CodexModel): ReasoningEffort {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    (value === "max" && supportsMaxReasoning(model))
  ) {
    return value;
  }
  return "medium";
}
