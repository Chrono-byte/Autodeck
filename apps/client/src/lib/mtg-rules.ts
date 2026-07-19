export type ComprehensiveRuleEntry = {
  id: string;
  text: string;
  kind: "rule" | "glossary";
};

export type ComprehensiveRulesDocument = {
  effectiveDate: string;
  entries: ComprehensiveRuleEntry[];
};

const RULE_LINE = /^(\d{3}(?:\.\d+[a-z]?)?)\.?\s+(.+)$/;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "with",
  "you",
  "your",
]);

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseComprehensiveRules(text: string): ComprehensiveRulesDocument {
  const normalizedText = text.replace(/\r\n?/g, "\n");
  const effectiveDate =
    normalizedText.match(/These rules are effective as of ([^.]+)\./)?.[1] ?? "Unknown";
  const lines = normalizedText.split("\n");
  const starts = lines
    .map((line, index) => (line.trim() === "100. General" ? index : -1))
    .filter((index) => index >= 0);
  const rulesStart = starts.at(-1) ?? 0;
  const glossaryStart = lines.findIndex(
    (line, index) => index > rulesStart && line.trim() === "Glossary",
  );
  const rulesEnd = glossaryStart >= 0 ? glossaryStart : lines.length;
  const entries: ComprehensiveRuleEntry[] = [];
  let current: ComprehensiveRuleEntry | undefined;

  for (const rawLine of lines.slice(rulesStart, rulesEnd)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(RULE_LINE);
    if (match) {
      current = { id: match[1], text: match[2], kind: "rule" };
      entries.push(current);
    } else if (current && !/^\d+\.\s/.test(line)) {
      current.text += ` ${line}`;
    }
  }

  if (glossaryStart >= 0) {
    const glossaryText = lines
      .slice(glossaryStart + 1)
      .join("\n")
      .split(/^Credits$/m)[0];
    for (const block of glossaryText.split(/\n\s*\n/)) {
      const blockLines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (blockLines.length < 2) continue;
      const [term, ...definition] = blockLines;
      if (term.length > 100 || /[.!?]$/.test(term)) continue;
      entries.push({ id: term, text: definition.join(" "), kind: "glossary" });
    }
  }

  return { effectiveDate, entries };
}

function queryTerms(query: string) {
  return normalize(query)
    .replace(/[^a-z0-9.'-]+/g, " ")
    .split(" ")
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

export function searchComprehensiveRules(
  document: ComprehensiveRulesDocument,
  query: string,
  limit = 8,
) {
  const trimmed = query.trim();
  const ruleQuery = trimmed.match(/^(?:rule\s+)?(\d{3}(?:\.\d+[a-z]?)?)\.?$/i)?.[1];

  if (ruleQuery) {
    const exact = document.entries.filter(
      (entry) =>
        entry.kind === "rule" && (entry.id === ruleQuery || entry.id.startsWith(`${ruleQuery}.`)),
    );
    return exact.slice(0, limit);
  }

  const phrase = normalize(trimmed);
  const terms = queryTerms(trimmed);
  if (!phrase || terms.length === 0) return [];

  return document.entries
    .map((entry) => {
      const id = normalize(entry.id);
      const body = normalize(entry.text);
      const searchable = `${id} ${body}`;
      let score = 0;
      if (id === phrase) score += 1000;
      if (id.includes(phrase)) score += 180;
      if (body.includes(phrase)) score += 120;
      for (const term of terms) {
        if (id.includes(term)) score += 45;
        const occurrences = body.split(term).length - 1;
        score += Math.min(occurrences, 5) * 8;
      }
      if (terms.every((term) => searchable.includes(term))) score += 35;
      if (body.length < 100 && terms.every((term) => body.includes(term))) score += 200;
      if (entry.kind === "glossary" && terms.some((term) => id.includes(term))) score += 30;
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.entry.id.localeCompare(b.entry.id, undefined, { numeric: true }),
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}
