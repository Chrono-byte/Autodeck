import { createFileRoute } from "@tanstack/react-router";
import { getScryfallCard } from "../lib/scryfall.server";
import { scryfallArtTagCatalog } from "../lib/scryfall-art-tags.server";
import { scryfallOracleTagCatalog } from "../lib/scryfall-tags.server";

export const Route = createFileRoute("/api/cards/resolve")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const name = new URL(request.url).searchParams.get("name")?.trim();
        if (!name) return Response.json({ error: "Card name is required." }, { status: 400 });
        try {
          const card = await getScryfallCard(name);
          const [oracleTagIndex, artTagIndex] = await Promise.all([
            scryfallOracleTagCatalog.tagSlugsForOracleIds([card.oracleId]),
            scryfallArtTagCatalog.tagSlugsForIllustrationIds(card.illustrationIds),
          ]);
          return Response.json({
            ...card,
            oracleTags: [...(oracleTagIndex.tagsByOracleId.get(card.oracleId) ?? [])],
            artTags: [
              ...new Set(
                card.illustrationIds.flatMap((illustrationId) => [
                  ...(artTagIndex.tagsByIllustrationId.get(illustrationId) ?? []),
                ]),
              ),
            ],
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Card lookup failed." },
            { status: 404 },
          );
        }
      },
    },
  },
});
