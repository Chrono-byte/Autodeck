import { createFileRoute } from "@tanstack/react-router";
import type { CardImageVersion } from "../lib/card-image";
import { fetchCardImage } from "../lib/card-image.server";

const IMAGE_VERSIONS = new Set<CardImageVersion>(["normal", "art_crop"]);

export const Route = createFileRoute("/api/cards/images")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const name = url.searchParams.get("name")?.trim() ?? "";
        const requestedVersion = url.searchParams.get("version") ?? "normal";
        if (
          !name ||
          name.length > 200 ||
          !IMAGE_VERSIONS.has(requestedVersion as CardImageVersion)
        ) {
          return Response.json(
            { error: "A valid card name and image version are required." },
            { status: 400 },
          );
        }
        return fetchCardImage(name, requestedVersion as CardImageVersion);
      },
    },
  },
});
