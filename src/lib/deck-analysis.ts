export type ScryfallCard = {
  name: string;
  type_line: string;
  oracle_text?: string;
  cmc: number;
  color_identity: string[];
  layout?: string;
  card_faces?: Array<{
    name: string;
    type_line?: string;
    oracle_text?: string;
  }>;
};

export type DeckEntry = { quantity: number; name: string };

export const ROLE_KEYS = [
  "lands",
  "ramp",
  "draw",
  "targetedRemoval",
  "boardWipes",
  "protection",
  "tutors",
] as const;

export type Role = (typeof ROLE_KEYS)[number];

export function parseDecklist(text: string): DeckEntry[] {
  const byName = new Map<string, DeckEntry>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine
      .replace(/^\s*[-*]\s*/, "")
      .replace(/\s+#.*$/, "")
      .replace(/\s+\([A-Z0-9]+\)\s+\d+[a-z]?\s*$/i, "")
      .trim();

    if (!line || line.startsWith("//") || /^deck$/i.test(line) || /^commander$/i.test(line)) {
      continue;
    }

    const match = line.match(/^(?:(\d+)\s*[xX]?\s+)?(.+?)\s*$/);
    if (!match) continue;

    const quantity = Number(match[1] ?? 1);
    const name = match[2].trim();
    if (!name || !Number.isFinite(quantity) || quantity < 1) continue;

    const key = name.toLocaleLowerCase();
    const existing = byName.get(key);
    byName.set(key, { quantity: (existing?.quantity ?? 0) + quantity, name });
  }

  return [...byName.values()];
}

function searchableText(card: ScryfallCard) {
  const faces = card.card_faces ?? [];
  return [
    card.type_line,
    card.oracle_text,
    ...faces.flatMap((face) => [face.type_line, face.oracle_text]),
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase();
}

export function classifyCard(card: ScryfallCard): Role[] {
  const text = searchableText(card);
  const roles = new Set<Role>();
  const isLand = /(^|\s|—)land(\s|$|—)/i.test(card.type_line);

  if (isLand) roles.add("lands");

  if (
    !isLand &&
    (/add (?:one|two|three|four|five|six|seven|eight|nine|ten|an amount of|x) mana/.test(text) ||
      /search your library for (?:a|up to \w+) (?:basic )?land card/.test(text) ||
      /put (?:a|that|those) (?:basic )?land card/.test(text) ||
      /treasure token/.test(text))
  ) {
    roles.add("ramp");
  }

  if (
    /draw (?:a|one|two|three|four|five|six|seven|x|that many|cards equal)/.test(text) ||
    /draws? cards equal/.test(text) ||
    /whenever .+ draw a card/.test(text) ||
    /at the beginning of .+ draw/.test(text)
  ) {
    roles.add("draw");
  }

  if (
    /(destroy|exile) target (?:nonland )?(?:permanent|creature|artifact|enchantment|planeswalker)/.test(
      text,
    ) ||
    /target player sacrifices? (?:a|an) (?:creature|permanent)/.test(text) ||
    /counter target (?:spell|activated ability|triggered ability)/.test(text)
  ) {
    roles.add("targetedRemoval");
  }

  if (
    /(destroy|exile) all (?:nonland )?(?:permanents|creatures|artifacts|enchantments)/.test(text) ||
    /each player sacrifices? all/.test(text) ||
    /all creatures get -\d+\/-\d+/.test(text)
  ) {
    roles.add("boardWipes");
  }

  if (
    /(?:you|permanents you control|creatures you control|target .+) (?:gain|gains|have|has) (?:hexproof|indestructible|protection)/.test(
      text,
    ) ||
    /phase out/.test(text) ||
    /counter target spell that targets/.test(text)
  ) {
    roles.add("protection");
  }

  if (/search your library for (?!a basic land|a land|up to \w+ basic land)/.test(text)) {
    roles.add("tutors");
  }

  return [...roles];
}

export function summarizeDeck(entries: DeckEntry[], cards: ScryfallCard[], unresolved: string[]) {
  const cardMap = new Map(cards.map((card) => [card.name.toLocaleLowerCase(), card]));
  const counts = Object.fromEntries(ROLE_KEYS.map((role) => [role, 0])) as Record<Role, number>;
  const examples = ROLE_KEYS.reduce(
    (result, role) => ({ ...result, [role]: [] }),
    {} as Record<Role, string[]>,
  );
  let totalCards = 0;
  let totalManaValue = 0;
  let nonlandCards = 0;

  for (const entry of entries) {
    totalCards += entry.quantity;
    const card = cardMap.get(entry.name.toLocaleLowerCase());
    if (!card) continue;
    const roles = classifyCard(card);
    for (const role of roles) {
      counts[role] += entry.quantity;
      if (examples[role].length < 8) examples[role].push(card.name);
    }
    if (!roles.includes("lands")) {
      totalManaValue += card.cmc * entry.quantity;
      nonlandCards += entry.quantity;
    }
  }

  return {
    totalCards,
    resolvedCards: totalCards - unresolved.length,
    unresolved,
    counts,
    examples,
    averageManaValue: nonlandCards ? Number((totalManaValue / nonlandCards).toFixed(2)) : 0,
    note: "Role counts overlap by design. Heuristics are a starting point and should be reviewed in context.",
  };
}
