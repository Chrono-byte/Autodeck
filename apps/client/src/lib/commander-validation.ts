import type { ScryfallCard } from "./deck-analysis";

export type CommanderDeckCard = {
  name: string;
  quantity: number;
  zone: "commander" | "main" | "maybeboard";
  typeLine: string;
  oracleText?: string;
  colorIdentity: string[];
};

export type ResolvedCommanderCard = {
  name: string;
  typeLine: string;
  oracleText?: string;
  colorIdentity: string[];
  commanderLegality: string;
};

const normalizeName = (name: string) => name.trim().toLocaleLowerCase();

function isBasicLand(typeLine: string) {
  return /\bBasic Land\b/i.test(typeLine);
}

function allowsMultipleCopies(oracleText = "") {
  return /a deck can have (?:any number of|up to (?:\w+|\d+)) cards named/i.test(oracleText);
}

function isLegendaryCreature(typeLine: string) {
  return /\bLegendary\b.*\bCreature\b/i.test(typeLine);
}

function isBackground(typeLine: string) {
  return /\bBackground\b/i.test(typeLine);
}

function isLegendaryBackgroundEnchantment(typeLine: string) {
  return /\bLegendary\b.*\bEnchantment\b.*\bBackground\b/i.test(typeLine);
}

function requiresChooseBackgroundPartner(typeLine: string) {
  return isBackground(typeLine) && !isLegendaryCreature(typeLine);
}

export function canOccupyCommandZone(card: Pick<CommanderDeckCard, "typeLine" | "oracleText">) {
  return (
    isLegendaryCreature(card.typeLine) ||
    isBackground(card.typeLine) ||
    /can be your commander/i.test(card.oracleText ?? "")
  );
}

function hasKeyword(oracleText: string | undefined, keyword: string) {
  return new RegExp(`(?:^|\\n)${keyword}(?:\\s*\\(|$)`, "i").test(oracleText ?? "");
}

function partnerWithName(oracleText: string | undefined) {
  return oracleText?.match(/(?:^|\n)Partner with ([^(\n.]+)/i)?.[1]?.trim();
}

function partnerVariant(oracleText: string | undefined) {
  const variants = ["Character select", "Father & son", "Friends forever", "Survivors"];
  return variants.find((variant) => hasKeyword(oracleText, variant))?.toLocaleLowerCase();
}

function isTimeLordDoctor(typeLine: string) {
  return /[—-]\s*Time Lord Doctor\s*$/i.test(typeLine);
}

export function commandersCanPartner(
  first: Pick<CommanderDeckCard, "name" | "typeLine" | "oracleText">,
  second: Pick<CommanderDeckCard, "name" | "typeLine" | "oracleText">,
) {
  const firstPartner = partnerWithName(first.oracleText);
  const secondPartner = partnerWithName(second.oracleText);
  if (
    firstPartner &&
    secondPartner &&
    normalizeName(firstPartner) === normalizeName(second.name) &&
    normalizeName(secondPartner) === normalizeName(first.name)
  ) {
    return true;
  }

  if (hasKeyword(first.oracleText, "Partner") && hasKeyword(second.oracleText, "Partner")) {
    return true;
  }
  const firstVariant = partnerVariant(first.oracleText);
  const secondVariant = partnerVariant(second.oracleText);
  if (firstVariant && firstVariant === secondVariant) return true;
  if (
    (/choose a background/i.test(first.oracleText ?? "") &&
      isLegendaryBackgroundEnchantment(second.typeLine)) ||
    (/choose a background/i.test(second.oracleText ?? "") &&
      isLegendaryBackgroundEnchantment(first.typeLine))
  ) {
    return true;
  }
  return (
    (/doctor's companion/i.test(first.oracleText ?? "") && isTimeLordDoctor(second.typeLine)) ||
    (/doctor's companion/i.test(second.oracleText ?? "") && isTimeLordDoctor(first.typeLine))
  );
}

function currentCardMap(cards: ScryfallCard[]) {
  return new Map(cards.map((card) => [normalizeName(card.name), card]));
}

function currentOracleText(card: ScryfallCard) {
  return (
    card.oracle_text ??
    card.card_faces
      ?.map((face) => face.oracle_text)
      .filter((text): text is string => Boolean(text))
      .join("\n")
  );
}

export function validateCommanderDeck(cards: CommanderDeckCard[], currentCards: ScryfallCard[]) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const currentByName = currentCardMap(currentCards);
  const playableCards = cards
    .filter((card) => card.zone !== "maybeboard")
    .map((card) => {
      const current = currentByName.get(normalizeName(card.name));
      return current
        ? {
            ...card,
            typeLine: current.type_line,
            oracleText: currentOracleText(current),
            colorIdentity: current.color_identity,
          }
        : card;
    });
  const commanders = playableCards.filter((card) => card.zone === "commander");
  const totalCards = playableCards.reduce((total, card) => total + card.quantity, 0);

  if (totalCards !== 100)
    errors.push(`The playable deck has ${totalCards} cards; Commander requires exactly 100.`);
  if (commanders.length === 0) errors.push("The deck has no commander.");
  if (commanders.length > 2)
    errors.push(
      `The command zone contains ${commanders.length} cards; at most two commanders are supported.`,
    );

  for (const commander of commanders) {
    if (commander.quantity !== 1)
      errors.push(`${commander.name} must have quantity 1 in the command zone.`);
    if (!canOccupyCommandZone(commander))
      errors.push(`${commander.name} is not eligible for the command zone.`);
  }
  if (commanders.length === 1 && requiresChooseBackgroundPartner(commanders[0].typeLine)) {
    errors.push(`${commanders[0].name} requires a commander with Choose a Background.`);
  }
  if (commanders.length === 2 && !commandersCanPartner(commanders[0], commanders[1])) {
    errors.push(
      `${commanders[0].name} and ${commanders[1].name} do not have a recognized two-commander pairing.`,
    );
  }

  const commanderColors = new Set(commanders.flatMap((card) => card.colorIdentity));
  const quantities = new Map<string, number>();
  for (const card of playableCards) {
    const key = normalizeName(card.name);
    quantities.set(key, (quantities.get(key) ?? 0) + card.quantity);
    const current = currentByName.get(key);
    const legality = current?.legalities?.commander;
    if (legality && legality !== "legal") errors.push(`${card.name} is ${legality} in Commander.`);
    if (!current) warnings.push(`${card.name} could not be checked against current Scryfall data.`);

    if (card.zone === "main" && commanders.length > 0) {
      const colors = current?.color_identity ?? card.colorIdentity;
      const outsideIdentity = colors.filter((color) => !commanderColors.has(color));
      if (outsideIdentity.length > 0) {
        errors.push(
          `${card.name} is outside the commanders' ${[...commanderColors].join("") || "colorless"} color identity.`,
        );
      }
    }
  }

  for (const [key, quantity] of quantities) {
    if (quantity <= 1) continue;
    const stored = playableCards.find((card) => normalizeName(card.name) === key);
    const current = currentByName.get(key);
    const typeLine = current?.type_line ?? stored?.typeLine ?? "";
    const oracleText = current?.oracle_text ?? stored?.oracleText;
    if (!isBasicLand(typeLine) && !allowsMultipleCopies(oracleText)) {
      errors.push(
        `${stored?.name ?? key} appears ${quantity} times and has no recognized singleton exception.`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    totalCards,
    commanderCount: commanders.length,
    colorIdentity: [...commanderColors],
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

export function validateAssistantAddition(
  card: ResolvedCommanderCard,
  zone: CommanderDeckCard["zone"],
  quantity: number,
  activeCards: CommanderDeckCard[],
) {
  if (zone === "maybeboard") return [];

  const errors: string[] = [];
  if (card.commanderLegality !== "legal") {
    errors.push(`${card.name} is ${card.commanderLegality} in Commander.`);
  }

  const allCommanders = activeCards.filter((item) => item.zone === "commander");
  const existingCommanders = allCommanders.filter(
    (item) => item.zone === "commander" && normalizeName(item.name) !== normalizeName(card.name),
  );
  if (zone === "commander") {
    if (quantity !== 1) errors.push("A command-zone card must have quantity 1.");
    if (!canOccupyCommandZone(card))
      errors.push(`${card.name} is not eligible for the command zone.`);
    if (requiresChooseBackgroundPartner(card.typeLine) && existingCommanders.length === 0) {
      errors.push(`${card.name} requires a commander with Choose a Background.`);
    }
    if (existingCommanders.length >= 2)
      errors.push("The command zone already contains two commanders.");
    if (existingCommanders.length === 1 && !commandersCanPartner(existingCommanders[0], card)) {
      errors.push(
        `${existingCommanders[0].name} and ${card.name} do not have a recognized two-commander pairing.`,
      );
    }
  }

  if (zone === "main" && allCommanders.length > 0) {
    const commanderColors = new Set(allCommanders.flatMap((item) => item.colorIdentity));
    const outsideIdentity = card.colorIdentity.filter((color) => !commanderColors.has(color));
    if (outsideIdentity.length > 0) {
      errors.push(`${card.name} is outside the active commanders' color identity.`);
    }
  }

  const otherPlayableQuantity = activeCards
    .filter(
      (item) =>
        item.zone !== "maybeboard" &&
        item.zone !== zone &&
        normalizeName(item.name) === normalizeName(card.name),
    )
    .reduce((total, item) => total + item.quantity, 0);
  if (
    otherPlayableQuantity + quantity > 1 &&
    !isBasicLand(card.typeLine) &&
    !allowsMultipleCopies(card.oracleText)
  ) {
    errors.push(`${card.name} would violate Commander singleton rules.`);
  }

  return errors;
}
