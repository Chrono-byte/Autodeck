export type MtgoExportZone = "commander" | "main" | "maybeboard";

export type MtgoExportCard = {
  name: string;
  quantity: number;
  zone: MtgoExportZone;
};

function formatSection(cards: MtgoExportCard[]) {
  return cards
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((card) => `${card.quantity} ${card.name}`)
    .join("\r\n");
}

export function formatMtgoDeck(cards: MtgoExportCard[]) {
  const mainDeck = formatSection(cards.filter((card) => card.zone === "main"));
  const commanders = formatSection(cards.filter((card) => card.zone === "commander"));

  return [mainDeck, commanders].filter(Boolean).join("\r\n\r\n") + "\r\n";
}

export function mtgoExportFilename(deckName: string) {
  const safeName = deckName
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/-+/g, "-")
    .replace(/[-. ]+$/g, "");

  return `${safeName || "deck"}-mtgo.txt`;
}
