import rulesText from "../data/mtg-rules/MagicCompRules-2026-06-19.txt?raw";
import { parseComprehensiveRules, searchComprehensiveRules } from "./mtg-rules";

const document = parseComprehensiveRules(rulesText);

export const COMPREHENSIVE_RULES_SOURCE = {
  effectiveDate: document.effectiveDate,
  pdfFile: "src/data/mtg-rules/MagicCompRules-2026-06-19.pdf",
  officialUrl: "https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf",
};

export function lookupComprehensiveRules(query: string, limit = 8) {
  return {
    source: COMPREHENSIVE_RULES_SOURCE,
    matches: searchComprehensiveRules(document, query, limit),
    guidance:
      "Quote or closely paraphrase the returned rule text and cite its rule number. If the result is insufficient, search again with a narrower rule number or rules term.",
  };
}
