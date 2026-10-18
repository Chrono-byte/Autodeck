import type { DeckEntry } from "./deck-analysis";

export type ImportZone = "commander" | "main" | "maybeboard";

export type ImportedDeckEntry = DeckEntry & {
  zone: ImportZone;
};

function sectionZone(line: string): ImportZone | null {
  if (/^(?:commander|commanders)$/i.test(line)) return "commander";
  if (/^(?:sideboard|maybeboard|considering)$/i.test(line)) return "maybeboard";
  if (/^(?:deck|mainboard|main deck)$/i.test(line)) return "main";
  return null;
}

export function parseImportedDecklist(text: string): ImportedDeckEntry[] {
  const entries = new Map<string, ImportedDeckEntry>();
  let zone: ImportZone = "main";

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const nextZone = sectionZone(trimmed.replace(/:$/, ""));
    if (nextZone) {
      zone = nextZone;
      continue;
    }

    const line = trimmed
      .replace(/^\s*[-*]\s*/, "")
      .replace(/\s+#.*$/, "")
      .replace(/\s+\([A-Z0-9]+\)\s+\d+[a-z]?\s*$/i, "")
      .trim();
    if (!line || line.startsWith("//") || /^companion$/i.test(line)) continue;

    const match = line.match(/^(?:(\d+)\s*[xX]?\s+)?(.+?)\s*$/);
    if (!match) continue;

    const quantity = Number(match[1] ?? 1);
    const name = match[2].trim();
    if (!name || !Number.isFinite(quantity) || quantity < 1) continue;

    const key = `${zone}:${name.toLocaleLowerCase()}`;
    const existing = entries.get(key);
    entries.set(key, {
      quantity: (existing?.quantity ?? 0) + quantity,
      name,
      zone,
    });
  }

  return [...entries.values()];
}
