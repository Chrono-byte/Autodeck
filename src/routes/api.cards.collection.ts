import { createFileRoute } from "@tanstack/react-router";
import { parseDecklist } from "../lib/deck-analysis";
import { fetchDeckCards } from "../lib/scryfall.server";
import { scryfallOracleTagCatalog } from "../lib/scryfall-tags.server";

export const Route = createFileRoute("/api/cards/collection")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { decklist?: string };
        const entries = parseDecklist(body.decklist ?? "");
        if (!entries.length)
          return Response.json({ error: "No card names found." }, { status: 400 });
        if (entries.length > 110)
          return Response.json({ error: "Too many unique cards." }, { status: 400 });
        const { cards, unresolved } = await fetchDeckCards(entries);
        const oracleIds = cards
          .map((card) => card.oracle_id)
          .filter((oracleId): oracleId is string => oracleId !== undefined);
        const tagIndex = await scryfallOracleTagCatalog.tagSlugsForOracleIds(oracleIds);
        const quantities = new Map(
          entries.map((entry) => [entry.name.toLocaleLowerCase(), entry.quantity]),
        );
        return Response.json({
          cards: cards.map((card) => ({
            name: card.name,
            oracleId: card.oracle_id,
            oracleTags: card.oracle_id
              ? [...(tagIndex.tagsByOracleId.get(card.oracle_id) ?? [])]
              : [],
            quantity: quantities.get(card.name.toLocaleLowerCase()) ?? 1,
            typeLine: card.type_line,
            oracleText:
              card.oracle_text ??
              card.card_faces?.map((face) => `${face.name}: ${face.oracle_text ?? ""}`).join("\n"),
            manaValue: card.cmc,
            colorIdentity: card.color_identity,
          })),
          unresolved,
        });
      },
    },
  },
});
