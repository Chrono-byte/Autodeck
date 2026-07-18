import { describe, expect, it } from "vitest";
import { ScryfallArtTagCatalog, type ScryfallArtTag } from "./scryfall-art-tags.server";

function tag(
  id: string,
  slug: string,
  options: { illustrationIds?: string[]; parents?: string[] } = {},
): ScryfallArtTag {
  return {
    object: "tag",
    id,
    label: slug.replaceAll("-", " "),
    slug,
    type: "illustration",
    uri: `https://tagger.scryfall.com/tags/artwork/${slug}`,
    description: null,
    parent_ids: options.parents ?? [],
    child_ids: [],
    aliases: [],
    taggings: (options.illustrationIds ?? []).map((illustrationId) => ({
      illustration_id: illustrationId,
      weight: "median",
    })),
  };
}

describe("ScryfallArtTagCatalog", () => {
  it("indexes direct and inherited art-tag slugs by illustration ID", async () => {
    const catalog = new ScryfallArtTagCatalog({
      fetchMetadata: async () => ({
        object: "bulk_data",
        id: "art-tags",
        type: "art_tags",
        updated_at: "2026-07-18T00:00:00Z",
        name: "Art Tags",
        description: "fixture",
        size: 1,
        download_uri: "https://example.test/art-tags.json",
        content_type: "application/json",
        content_encoding: "gzip",
      }),
      fetchTags: async () => [
        tag("creature", "creature"),
        tag("dragon", "dragon", { illustrationIds: ["illustration-one"], parents: ["creature"] }),
      ],
    });

    const index = await catalog.tagSlugsForIllustrationIds(["illustration-one"]);

    expect(index.tagsByIllustrationId.get("illustration-one")).toEqual(
      new Set(["dragon", "creature"]),
    );
  });
});
