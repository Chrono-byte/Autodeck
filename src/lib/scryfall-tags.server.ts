import {
  getScryfallBulkData,
  getScryfallOracleIdentity,
  SCRYFALL_APP_HEADERS,
  type ScryfallBulkData,
} from "./scryfall.server";

const CATALOG_TTL_MS = 12 * 60 * 60_000;
const RETRY_TTL_MS = 5 * 60_000;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "card",
  "cards",
  "for",
  "of",
  "or",
  "that",
  "the",
  "to",
  "with",
]);

export type OracleTagging = {
  oracle_id: string;
  weight: string;
};

export type ScryfallOracleTag = {
  object: "tag";
  id: string;
  label: string;
  slug: string;
  type: "oracle";
  uri: string;
  description: string | null;
  parent_ids: string[];
  child_ids: string[];
  aliases: string[];
  taggings: OracleTagging[];
};

export type OracleTagSummary = {
  label: string;
  slug: string;
};

export type OracleTagMatch = OracleTagSummary & {
  description?: string;
  aliases: string[];
  parents: OracleTagSummary[];
  children: OracleTagSummary[];
  directCardCount: number;
  cardCount: number;
  searchQuery: string;
  taggerUrl: string;
};

type CatalogSnapshot = {
  updatedAt: string;
  tags: ScryfallOracleTag[];
  byId: Map<string, ScryfallOracleTag>;
  tagIdsByOracleId: Map<string, string[]>;
};

type CatalogDependencies = {
  fetchMetadata: () => Promise<ScryfallBulkData>;
  fetchTags: (downloadUri: string) => Promise<ScryfallOracleTag[]>;
  resolveCard: (name: string) => Promise<{ name: string; oracleId: string }>;
  now: () => number;
};

function normalized(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalized(value)
    .split(" ")
    .filter((token) => token && !STOP_WORDS.has(token));
}

function tagScore(tag: ScryfallOracleTag, query: string) {
  const queryTokens = tokens(query);
  const phrase = queryTokens.join(" ");
  if (!phrase) return 0;
  const label = normalized(tag.label);
  const slug = normalized(tag.slug);
  const aliases = tag.aliases.map(normalized);
  const description = normalized(tag.description ?? "");

  let score = 0;
  if (label === phrase || slug === phrase) score = 1_000;
  else if (aliases.includes(phrase)) score = 900;
  else if (label.startsWith(phrase) || slug.startsWith(phrase)) score = 700;
  else if (aliases.some((alias) => alias.startsWith(phrase))) score = 650;
  else if (label.includes(phrase) || slug.includes(phrase)) score = 600;
  else if (aliases.some((alias) => alias.includes(phrase))) score = 550;
  else if (description.includes(phrase)) score = 400;

  const searchable = [label, slug, ...aliases, description].join(" ");
  const matchedTokens = queryTokens.filter((token) => searchable.includes(token)).length;
  if (matchedTokens === 0) return 0;
  return score + matchedTokens * 20 + Math.round((matchedTokens / queryTokens.length) * 100);
}

async function fetchOracleTags(downloadUri: string) {
  const response = await fetch(downloadUri, { headers: SCRYFALL_APP_HEADERS });
  if (!response.ok) {
    throw new Error(`Scryfall Oracle Tags download failed (${response.status}).`);
  }
  return response.json() as Promise<ScryfallOracleTag[]>;
}

function buildSnapshot(updatedAt: string, tags: ScryfallOracleTag[]): CatalogSnapshot {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const tagIdsByOracleId = new Map<string, string[]>();
  for (const tag of tags) {
    for (const tagging of tag.taggings) {
      const tagIds = tagIdsByOracleId.get(tagging.oracle_id) ?? [];
      tagIds.push(tag.id);
      tagIdsByOracleId.set(tagging.oracle_id, tagIds);
    }
  }
  return { updatedAt, tags, byId, tagIdsByOracleId };
}

function summary(snapshot: CatalogSnapshot, id: string): OracleTagSummary | undefined {
  const tag = snapshot.byId.get(id);
  return tag ? { label: tag.label, slug: tag.slug } : undefined;
}

function relatedSummaries(snapshot: CatalogSnapshot, ids: string[]) {
  return ids
    .map((id) => summary(snapshot, id))
    .filter((tag): tag is OracleTagSummary => tag !== undefined)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function descendantOracleIds(snapshot: CatalogSnapshot, root: ScryfallOracleTag) {
  const oracleIds = new Set<string>();
  const visited = new Set<string>();
  const pending = [root.id];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const tag = snapshot.byId.get(id);
    if (!tag) continue;
    for (const tagging of tag.taggings) oracleIds.add(tagging.oracle_id);
    pending.push(...tag.child_ids);
  }
  return oracleIds.size;
}

function matchResult(snapshot: CatalogSnapshot, tag: ScryfallOracleTag): OracleTagMatch {
  return {
    label: tag.label,
    slug: tag.slug,
    ...(tag.description ? { description: tag.description } : {}),
    aliases: [...tag.aliases].sort((left, right) => left.localeCompare(right)),
    parents: relatedSummaries(snapshot, tag.parent_ids),
    children: relatedSummaries(snapshot, tag.child_ids),
    directCardCount: tag.taggings.length,
    cardCount: descendantOracleIds(snapshot, tag),
    searchQuery: `otag:${tag.slug}`,
    taggerUrl: tag.uri,
  };
}

export class ScryfallOracleTagCatalog {
  private readonly dependencies: CatalogDependencies;
  private snapshot?: CatalogSnapshot;
  private expiresAt = 0;
  private pending?: Promise<CatalogSnapshot>;

  constructor(dependencies: Partial<CatalogDependencies> = {}) {
    this.dependencies = {
      fetchMetadata: dependencies.fetchMetadata ?? (() => getScryfallBulkData("oracle_tags")),
      fetchTags: dependencies.fetchTags ?? fetchOracleTags,
      resolveCard: dependencies.resolveCard ?? getScryfallOracleIdentity,
      now: dependencies.now ?? Date.now,
    };
  }

  async search(query: string, limit = 8) {
    const snapshot = await this.load();
    const matches = snapshot.tags
      .map((tag) => ({ tag, score: tagScore(tag, query) }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) => right.score - left.score || left.tag.label.localeCompare(right.tag.label),
      )
      .slice(0, limit)
      .map(({ tag }) => matchResult(snapshot, tag));
    return { updatedAt: snapshot.updatedAt, matches };
  }

  async tagsForCard(name: string, limit = 40) {
    const [snapshot, card] = await Promise.all([this.load(), this.dependencies.resolveCard(name)]);
    const directIds = new Set(snapshot.tagIdsByOracleId.get(card.oracleId) ?? []);
    const allIds = new Set(directIds);
    const pending = [...directIds];
    while (pending.length > 0) {
      const id = pending.pop();
      if (!id) continue;
      const tag = snapshot.byId.get(id);
      if (!tag) continue;
      for (const parentId of tag.parent_ids) {
        if (allIds.has(parentId)) continue;
        allIds.add(parentId);
        pending.push(parentId);
      }
    }

    const tags = [...allIds]
      .map((id) => snapshot.byId.get(id))
      .filter((tag): tag is ScryfallOracleTag => tag !== undefined)
      .map((tag) => ({
        label: tag.label,
        slug: tag.slug,
        ...(tag.description ? { description: tag.description } : {}),
        relationship: directIds.has(tag.id) ? ("direct" as const) : ("inherited" as const),
        searchQuery: `otag:${tag.slug}`,
        taggerUrl: tag.uri,
      }))
      .sort(
        (left, right) =>
          Number(right.relationship === "direct") - Number(left.relationship === "direct") ||
          left.label.localeCompare(right.label),
      )
      .slice(0, limit);

    return { updatedAt: snapshot.updatedAt, cardName: card.name, tags };
  }

  async tagSlugsForOracleIds(oracleIds: string[]) {
    const snapshot = await this.load();
    const tagsByOracleId = new Map<string, ReadonlySet<string>>();
    for (const oracleId of new Set(oracleIds)) {
      const allIds = new Set(snapshot.tagIdsByOracleId.get(oracleId) ?? []);
      const pending = [...allIds];
      while (pending.length > 0) {
        const id = pending.pop();
        if (!id) continue;
        const tag = snapshot.byId.get(id);
        if (!tag) continue;
        for (const parentId of tag.parent_ids) {
          if (allIds.has(parentId)) continue;
          allIds.add(parentId);
          pending.push(parentId);
        }
      }
      tagsByOracleId.set(
        oracleId,
        new Set(
          [...allIds]
            .map((id) => snapshot.byId.get(id)?.slug.toLocaleLowerCase())
            .filter((slug): slug is string => slug !== undefined),
        ),
      );
    }
    return { updatedAt: snapshot.updatedAt, tagsByOracleId };
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

export const scryfallOracleTagCatalog = new ScryfallOracleTagCatalog();
