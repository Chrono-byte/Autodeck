import {
  getScryfallBulkData,
  SCRYFALL_APP_HEADERS,
  type ScryfallBulkData,
} from "./scryfall.server";

const CATALOG_TTL_MS = 12 * 60 * 60_000;
const RETRY_TTL_MS = 5 * 60_000;

export type ArtTagging = {
  illustration_id: string;
  weight: string;
};

export type ScryfallArtTag = {
  object: "tag";
  id: string;
  label: string;
  slug: string;
  type: "illustration";
  uri: string;
  description: string | null;
  parent_ids: string[];
  child_ids: string[];
  aliases: string[];
  taggings: ArtTagging[];
};

type CatalogSnapshot = {
  updatedAt: string;
  tagsById: Map<string, ScryfallArtTag>;
  tagIdsByIllustrationId: Map<string, string[]>;
};

type CatalogDependencies = {
  fetchMetadata: () => Promise<ScryfallBulkData>;
  fetchTags: (downloadUri: string) => Promise<ScryfallArtTag[]>;
  now: () => number;
};

async function fetchArtTags(downloadUri: string) {
  const response = await fetch(downloadUri, { headers: SCRYFALL_APP_HEADERS });
  if (!response.ok) throw new Error(`Scryfall Art Tags download failed (${response.status}).`);
  return response.json() as Promise<ScryfallArtTag[]>;
}

function buildSnapshot(updatedAt: string, tags: ScryfallArtTag[]): CatalogSnapshot {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const tagIdsByIllustrationId = new Map<string, string[]>();
  for (const tag of tags) {
    for (const tagging of tag.taggings) {
      const tagIds = tagIdsByIllustrationId.get(tagging.illustration_id) ?? [];
      tagIds.push(tag.id);
      tagIdsByIllustrationId.set(tagging.illustration_id, tagIds);
    }
  }
  return { updatedAt, tagsById, tagIdsByIllustrationId };
}

export class ScryfallArtTagCatalog {
  private readonly dependencies: CatalogDependencies;
  private snapshot?: CatalogSnapshot;
  private expiresAt = 0;
  private pending?: Promise<CatalogSnapshot>;

  constructor(dependencies: Partial<CatalogDependencies> = {}) {
    this.dependencies = {
      fetchMetadata: dependencies.fetchMetadata ?? (() => getScryfallBulkData("art_tags")),
      fetchTags: dependencies.fetchTags ?? fetchArtTags,
      now: dependencies.now ?? Date.now,
    };
  }

  async tagSlugsForIllustrationIds(illustrationIds: string[]) {
    const snapshot = await this.load();
    const tagsByIllustrationId = new Map<string, ReadonlySet<string>>();
    for (const illustrationId of new Set(illustrationIds)) {
      const allIds = new Set(snapshot.tagIdsByIllustrationId.get(illustrationId) ?? []);
      const pending = [...allIds];
      while (pending.length > 0) {
        const id = pending.pop();
        if (!id) continue;
        const tag = snapshot.tagsById.get(id);
        if (!tag) continue;
        for (const parentId of tag.parent_ids) {
          if (allIds.has(parentId)) continue;
          allIds.add(parentId);
          pending.push(parentId);
        }
      }
      tagsByIllustrationId.set(
        illustrationId,
        new Set(
          [...allIds]
            .map((id) => snapshot.tagsById.get(id)?.slug.toLocaleLowerCase())
            .filter((slug): slug is string => slug !== undefined),
        ),
      );
    }
    return { updatedAt: snapshot.updatedAt, tagsByIllustrationId };
  }

  private async load() {
    if (this.snapshot && this.expiresAt > this.dependencies.now()) return this.snapshot;
    if (this.pending) return this.pending;
    this.pending = this.refresh();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  private async refresh() {
    try {
      const metadata = await this.dependencies.fetchMetadata();
      if (this.snapshot?.updatedAt === metadata.updated_at) {
        this.expiresAt = this.dependencies.now() + CATALOG_TTL_MS;
        return this.snapshot;
      }
      const tags = await this.dependencies.fetchTags(metadata.download_uri);
      this.snapshot = buildSnapshot(metadata.updated_at, tags);
      this.expiresAt = this.dependencies.now() + CATALOG_TTL_MS;
      return this.snapshot;
    } catch (error) {
      if (!this.snapshot) throw error;
      this.expiresAt = this.dependencies.now() + RETRY_TTL_MS;
      return this.snapshot;
    }
  }
}

export const scryfallArtTagCatalog = new ScryfallArtTagCatalog();
