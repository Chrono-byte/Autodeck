import { describe, expect, it, vi } from "vitest";
import { ScryfallOracleTagCatalog, type ScryfallOracleTag } from "./scryfall-tags.server";
import type { ScryfallBulkData } from "./scryfall.server";

function tag(
  id: string,
  label: string,
  options: {
    aliases?: string[];
    children?: string[];
    description?: string;
    oracleIds?: string[];
    parents?: string[];
  } = {},
): ScryfallOracleTag {
  const slug = label.replaceAll(" ", "-");
  return {
    object: "tag",
    id,
    label,
    slug,
    type: "oracle",
    uri: `https://tagger.scryfall.com/tags/card/${slug}`,
    description: options.description ?? null,
    parent_ids: options.parents ?? [],
    child_ids: options.children ?? [],
    aliases: options.aliases ?? [],
    taggings: (options.oracleIds ?? []).map((oracleId) => ({
      oracle_id: oracleId,
      weight: "median",
    })),
  };
}

function metadata(updatedAt = "2026-07-17T21:00:36Z"): ScryfallBulkData {
  return {
    object: "bulk_data",
    id: "bulk-id",
    type: "oracle_tags",
    updated_at: updatedAt,
    name: "Oracle Tags",
    description: "All Oracle tags",
    size: 123,
    download_uri: "https://data.scryfall.io/oracle-tags.json",
    content_type: "application/json",
    content_encoding: "gzip",
  };
}

const fixtureTags = [
  tag("ramp", "ramp", {
    aliases: ["acceleration"],
    children: ["mana-rock"],
    description: "Effects that increase available mana.",
    oracleIds: ["oracle-root"],
  }),
  tag("mana-rock", "mana rock", {
    children: ["mana-rock-any-color"],
    description: "Noncreature artifacts that net increase your mana.",
    oracleIds: ["oracle-sol-ring"],
    parents: ["ramp"],
  }),
  tag("mana-rock-any-color", "mana rock any color", {
    oracleIds: ["oracle-arcane-signet"],
    parents: ["mana-rock"],
  }),
];

describe("ScryfallOracleTagCatalog", () => {
  it("discovers tags by label and alias with resolved hierarchy and descendant counts", async () => {
    const catalog = new ScryfallOracleTagCatalog({
      fetchMetadata: async () => metadata(),
      fetchTags: async () => fixtureTags,
    });

    const exact = await catalog.search("mana rock", 1);
    expect(exact.matches).toEqual([
      expect.objectContaining({
        label: "mana rock",
        slug: "mana-rock",
        directCardCount: 1,
        cardCount: 2,
        parents: [{ label: "ramp", slug: "ramp" }],
        children: [{ label: "mana rock any color", slug: "mana-rock-any-color" }],
        searchQuery: "otag:mana-rock",
      }),
    ]);

    const alias = await catalog.search("acceleration", 1);
    expect(alias.matches[0]?.slug).toBe("ramp");
    expect(alias.matches[0]?.cardCount).toBe(3);

    const naturalPhrase = await catalog.search("mana rock cards", 1);
    expect(naturalPhrase.matches[0]?.slug).toBe("mana-rock");
  });

  it("returns direct card tags and inherited parent categories", async () => {
    const catalog = new ScryfallOracleTagCatalog({
      fetchMetadata: async () => metadata(),
      fetchTags: async () => fixtureTags,
      resolveCard: async () => ({ name: "Arcane Signet", oracleId: "oracle-arcane-signet" }),
    });

    const result = await catalog.tagsForCard("arcane signet");
    expect(result.cardName).toBe("Arcane Signet");
    expect(result.tags).toEqual([
      expect.objectContaining({ slug: "mana-rock-any-color", relationship: "direct" }),
      expect.objectContaining({ slug: "mana-rock", relationship: "inherited" }),
      expect.objectContaining({ slug: "ramp", relationship: "inherited" }),
    ]);
  });

  it("deduplicates concurrent loads and reuses an unchanged export after expiry", async () => {
    let now = 0;
    const fetchMetadata = vi.fn(async () => metadata());
    const fetchTags = vi.fn(async () => fixtureTags);
    const catalog = new ScryfallOracleTagCatalog({
      fetchMetadata,
      fetchTags,
      now: () => now,
    });

    await Promise.all([catalog.search("ramp"), catalog.search("mana")]);
    expect(fetchMetadata).toHaveBeenCalledTimes(1);
    expect(fetchTags).toHaveBeenCalledTimes(1);

    now = 12 * 60 * 60_000 + 1;
    await catalog.search("ramp");
    expect(fetchMetadata).toHaveBeenCalledTimes(2);
    expect(fetchTags).toHaveBeenCalledTimes(1);
  });

  it("serves the previous snapshot when a refresh temporarily fails", async () => {
    let now = 0;
    const fetchMetadata = vi
      .fn<() => Promise<ScryfallBulkData>>()
      .mockResolvedValueOnce(metadata())
      .mockRejectedValueOnce(new Error("temporary failure"));
    const catalog = new ScryfallOracleTagCatalog({
      fetchMetadata,
      fetchTags: async () => fixtureTags,
      now: () => now,
    });

    await catalog.search("ramp");
    now = 12 * 60 * 60_000 + 1;
    await expect(catalog.search("ramp")).resolves.toEqual(
      expect.objectContaining({ updatedAt: metadata().updated_at }),
    );
  });
});
