import { createFileRoute } from "@tanstack/react-router";
import { fetchDeckCards } from "../lib/scryfall.server";

export const Route = createFileRoute("/api/cards/images")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { names?: unknown };
        if (!Array.isArray(body.names)) {
          return Response.json({ error: "A card name list is required." }, { status: 400 });
        }
        const names = body.names.filter(
          (name): name is string => typeof name === "string" && name.trim().length > 0,
        );
        if (names.length > 110) {
          return Response.json({ error: "Too many card names." }, { status: 400 });
        }

        const { cards } = await fetchDeckCards(
          names.map((name) => ({ name: name.trim(), quantity: 1 })),
        );
        return Response.json({
          cards: cards.map((card) => {
            const firstFace = card.card_faces?.[0];
            return {
              name: card.name,
              aliases: card.card_faces?.map((face) => face.name) ?? [],
              imageUrl: card.image_uris?.normal ?? firstFace?.image_uris?.normal,
              artCropUrl: card.image_uris?.art_crop ?? firstFace?.image_uris?.art_crop,
            };
          }),
        });
      },
    },
  },
});
