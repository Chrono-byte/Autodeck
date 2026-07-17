import { createFileRoute } from "@tanstack/react-router";
import { parseDecklist } from "../lib/deck-analysis";
import { fetchDeckCards } from "../lib/scryfall.server";

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
        const quantities = new Map(
          entries.map((entry) => [entry.name.toLocaleLowerCase(), entry.quantity]),
        );
        return Response.json({
          cards: cards.map((card) => ({
            name: card.name,
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
