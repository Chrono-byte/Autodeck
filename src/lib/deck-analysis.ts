export type ScryfallCard = {
  name: string;
  oracle_id?: string;
  type_line: string;
  oracle_text?: string;
  mana_cost?: string;
  cmc: number;
  color_identity: string[];
  legalities?: Record<string, string>;
  produced_mana?: string[];
  image_uris?: {
    normal?: string;
    art_crop?: string;
  };
  layout?: string;
  card_faces?: Array<{
    name: string;
    type_line?: string;
    oracle_text?: string;
    mana_cost?: string;
    image_uris?: {
      normal?: string;
      art_crop?: string;
    };
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

export const MANA_CURVE_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7+"] as const;

export type ManaCurveBucket = (typeof MANA_CURVE_KEYS)[number];

export const MANA_COLORS = ["W", "U", "B", "R", "G"] as const;

export type ManaColor = (typeof MANA_COLORS)[number];

export type ColorBalanceAssessment =
  | "noDemand"
  | "unsupported"
  | "underSupported"
  | "balanced"
  | "overSupported";

export function parseDecklist(text: string): DeckEntry[] {
  const byName = new Map<string, DeckEntry>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine
      .replace(/^\s*[-*]\s*/, "")
      .replace(/\s+#.*$/, "")
      .replace(/\s+\([A-Z0-9]+\)\s+\d+[a-z]?\s*$/i, "")
      .trim();

    if (
      !line ||
      line.startsWith("//") ||
      /^(?:deck|commander|commanders|mainboard|main deck|sideboard|maybeboard|companion)$/i.test(
        line,
      )
    ) {
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

function landProfile(card: ScryfallCard) {
  const faceTypeLines = card.card_faces?.flatMap((face) =>
    face.type_line ? [face.type_line] : [],
  );
  const typeLines = faceTypeLines?.length ? faceTypeLines : [card.type_line];
  const landFaces = typeLines.filter((typeLine) => /(^|\s|—)land(\s|$|—)/i.test(typeLine));
  return {
    hasLandFace: landFaces.length > 0,
    isPureLand: landFaces.length === typeLines.length,
  };
}

function emptyColorRecord(): Record<ManaColor, number> {
  return Object.fromEntries(MANA_COLORS.map((color) => [color, 0])) as Record<ManaColor, number>;
}

function manaCosts(card: ScryfallCard) {
  if (card.mana_cost) return [card.mana_cost];
  return card.card_faces?.flatMap((face) => (face.mana_cost ? [face.mana_cost] : [])) ?? [];
}

function countColoredPips(card: ScryfallCard) {
  const pips = emptyColorRecord();

  for (const symbol of manaCosts(card).flatMap((cost) => cost.match(/\{[^}]+\}/g) ?? [])) {
    const parts = symbol.slice(1, -1).toUpperCase().split("/");
    const colors = MANA_COLORS.filter((color) => parts.includes(color));
    if (colors.length === 0) continue;
    const weight = 1 / parts.length;
    for (const color of colors) pips[color] += weight;
  }

  return pips;
}

function producedColors(card: ScryfallCard): ManaColor[] {
  const produced = new Set(card.produced_mana ?? []);
  const text = searchableText(card).toUpperCase();

  if (!card.produced_mana?.length) {
    if (/ADD (?:ONE MANA OF )?ANY COLOR/.test(text)) {
      for (const color of MANA_COLORS) produced.add(color);
    }

    for (const match of text.matchAll(/ADD ((?:\{[WUBRGC]\})+)/g)) {
      for (const symbol of match[1].matchAll(/\{([WUBRG])\}/g)) produced.add(symbol[1]);
    }
  }

  const typeText = [card.type_line, ...(card.card_faces?.map((face) => face.type_line ?? "") ?? [])]
    .join(" ")
    .toUpperCase();
  const basicLandTypes: Array<[string, ManaColor]> = [
    ["PLAINS", "W"],
    ["ISLAND", "U"],
    ["SWAMP", "B"],
    ["MOUNTAIN", "R"],
    ["FOREST", "G"],
  ];
  for (const [landType, color] of basicLandTypes) {
    if (typeText.includes(landType)) produced.add(color);
  }

  return MANA_COLORS.filter((color) => produced.has(color));
}

function isReusableManaSource(card: ScryfallCard) {
  return /(?:^|\s|—)(?:land|artifact|creature|enchantment|planeswalker)(?:\s|$|—)/i.test(
    card.type_line,
  );
}

function analyzeColorBalance(entries: DeckEntry[], cardMap: Map<string, ScryfallCard>) {
  const pips = emptyColorRecord();
  const sources = emptyColorRecord();
  let resolvedCards = 0;
  let reusableSourceCards = 0;

  for (const entry of entries) {
    const card = cardMap.get(entry.name.toLocaleLowerCase());
    if (!card) continue;
    resolvedCards += entry.quantity;

    const cardPips = countColoredPips(card);
    for (const color of MANA_COLORS) pips[color] += cardPips[color] * entry.quantity;

    if (isReusableManaSource(card)) {
      const colors = producedColors(card);
      if (colors.length > 0) reusableSourceCards += entry.quantity;
      for (const color of colors) sources[color] += entry.quantity;
    }
  }

  const totalPips = MANA_COLORS.reduce((total, color) => total + pips[color], 0);
  const totalSourceAssignments = MANA_COLORS.reduce(
    (total, color) => total + (pips[color] > 0 ? sources[color] : 0),
    0,
  );
  const colors = Object.fromEntries(
    MANA_COLORS.map((color) => {
      const pipShare = totalPips ? pips[color] / totalPips : 0;
      const sourceShare =
        pips[color] > 0 && totalSourceAssignments ? sources[color] / totalSourceAssignments : 0;
      const shareDelta = sourceShare - pipShare;
      let assessment: ColorBalanceAssessment;
      if (pips[color] === 0) assessment = "noDemand";
      else if (sources[color] === 0) assessment = "unsupported";
      else if (shareDelta < -0.08) assessment = "underSupported";
      else if (shareDelta > 0.08) assessment = "overSupported";
      else assessment = "balanced";

      return [
        color,
        {
          pips: Number(pips[color].toFixed(2)),
          sources: sources[color],
          pipShare: Number(pipShare.toFixed(3)),
          sourceShare: Number(sourceShare.toFixed(3)),
          assessment,
        },
      ];
    }),
  ) as Record<
    ManaColor,
    {
      pips: number;
      sources: number;
      pipShare: number;
      sourceShare: number;
      assessment: ColorBalanceAssessment;
    }
  >;
  const overallSourceCountAssessment: "low" | "reasonable" =
    resolvedCards > 0 && reusableSourceCards / resolvedCards < 0.3 ? "low" : "reasonable";

  return {
    colors,
    totalPips: Number(totalPips.toFixed(2)),
    totalSourceAssignments,
    reusableSourceCards,
    sourceDensity: resolvedCards ? Number((reusableSourceCards / resolvedCards).toFixed(3)) : 0,
    overallSourceCountAssessment,
    note: "Hybrid and alternative-cost pips are split across their payment options. Reusable sources count once for every demanded color they can produce, so flexible sources overlap. Color assessments compare each demanded color's share of pips with its share of relevant source assignments. Overall source density below 30% is flagged as low. This is not a casting-probability model.",
  };
}

export function classifyCard(card: ScryfallCard): Role[] {
  const text = searchableText(card);
  const roles = new Set<Role>();
  const { hasLandFace } = landProfile(card);

  if (hasLandFace) roles.add("lands");

  if (
    !hasLandFace &&
    (/add (?:\{[wubrgc]\})+/.test(text) ||
      /add (?:one|two|three|four|five|six|seven|eight|nine|ten|an amount of|x) mana/.test(text) ||
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
  const manaCurve = Object.fromEntries(MANA_CURVE_KEYS.map((bucket) => [bucket, 0])) as Record<
    ManaCurveBucket,
    number
  >;
  const examples = ROLE_KEYS.reduce(
    (result, role) => ({ ...result, [role]: [] }),
    {} as Record<Role, string[]>,
  );
  let totalCards = 0;
  let totalManaValue = 0;
  let nonlandCards = 0;
  let resolvedCards = 0;

  for (const entry of entries) {
    totalCards += entry.quantity;
    const card = cardMap.get(entry.name.toLocaleLowerCase());
    if (!card) continue;
    resolvedCards += entry.quantity;
    const roles = classifyCard(card);
    for (const role of roles) {
      counts[role] += entry.quantity;
      if (examples[role].length < 8) examples[role].push(card.name);
    }
    if (!landProfile(card).isPureLand) {
      totalManaValue += card.cmc * entry.quantity;
      nonlandCards += entry.quantity;
      const bucket: ManaCurveBucket =
        card.cmc >= 7 ? "7+" : (String(Math.max(0, Math.floor(card.cmc))) as ManaCurveBucket);
      manaCurve[bucket] += entry.quantity;
    }
  }

  return {
    totalCards,
    resolvedCards,
    unresolved,
    counts,
    examples,
    manaCurve,
    nonlandCards,
    averageManaValue: nonlandCards ? Number((totalManaValue / nonlandCards).toFixed(2)) : 0,
    colorBalance: analyzeColorBalance(entries, cardMap),
    note: "Role counts overlap by design. Heuristics are a starting point and should be reviewed in context.",
  };
}
