import type { DeckEntry, ScryfallCard } from "./deck-analysis";

const SCRYFALL = "https://api.scryfall.com";
const APP_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Autodekt/0.1 (Commander deck research tool)",
};

async function scryfallFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SCRYFALL}${path}`, {
    ...init,
    headers: { ...APP_HEADERS, ...init?.headers },
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Scryfall request failed (${response.status}): ${error.slice(0, 240)}`);
  }
  return response.json() as Promise<T>;
}

export async function searchScryfall(query: string, limit = 12) {
  const result = await scryfallFetch<{ data: Array<ScryfallCard & { scryfall_uri: string }> }>(
    `/cards/search?q=${encodeURIComponent(query)}&order=edhrec`,
  );
  return result.data.slice(0, limit).map((card) => ({
    name: card.name,
    typeLine: card.type_line,
    oracleText:
      card.oracle_text ??
      card.card_faces
        ?.map((face) => face.oracle_text)
        .filter(Boolean)
        .join(" // "),
    manaValue: card.cmc,
    colorIdentity: card.color_identity,
    url: card.scryfall_uri,
  }));
}

export async function getScryfallCard(name: string) {
  const card = await scryfallFetch<
    ScryfallCard & {
      scryfall_uri: string;
      legalities: Record<string, string>;
    }
  >(`/cards/named?fuzzy=${encodeURIComponent(name)}`);

  return {
    name: card.name,
    typeLine: card.type_line,
    oracleText:
      card.oracle_text ??
      card.card_faces?.map((face) => `${face.name}: ${face.oracle_text ?? ""}`).join("\n"),
    manaValue: card.cmc,
    colorIdentity: card.color_identity,
    commanderLegality: card.legalities.commander ?? "unknown",
    url: card.scryfall_uri,
  };
}

export async function fetchDeckCards(entries: DeckEntry[]) {
  const cards: ScryfallCard[] = [];
  const unresolved: string[] = [];

  for (let offset = 0; offset < entries.length; offset += 75) {
    const chunk = entries.slice(offset, offset + 75);
    const result = await scryfallFetch<{
      data: ScryfallCard[];
      not_found: Array<{ name?: string }>;
    }>("/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: chunk.map(({ name }) => ({ name })) }),
    });
    cards.push(...result.data);
    unresolved.push(...result.not_found.map((item) => item.name ?? "Unknown card"));
  }

  return { cards, unresolved };
}
