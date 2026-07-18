import type { DeckEntry, ScryfallCard } from "./deck-analysis";

const SCRYFALL = "https://api.scryfall.com";
export const SCRYFALL_APP_HEADERS = {
  Accept: "application/json;q=0.9,*/*;q=0.8",
  "User-Agent": "Autodekt/0.1 (Commander deck research tool)",
};

const MIN_REQUEST_INTERVAL_MS = 125;
const RATE_LIMIT_FALLBACK_MS = 60_000;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 300;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ScryfallClientOptions = {
  fetcher?: Fetcher;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  minimumIntervalMs?: number;
  rateLimitFallbackMs?: number;
  cacheTtlMs?: number;
};

type CachedValue = {
  expiresAt: number;
  value: unknown;
};

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(response: Response, now: number, fallback: number) {
  const value = response.headers.get("retry-after");
  if (!value) return fallback;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(value);
  return Number.isNaN(date) ? fallback : Math.max(0, date - now);
}

async function errorDetails(response: Response) {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { details?: unknown };
    if (typeof parsed.details === "string") return parsed.details;
  } catch {
    // Non-JSON errors still get a concise response excerpt below.
  }
  return body.slice(0, 240) || response.statusText;
}

export class ScryfallClient {
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly minimumIntervalMs: number;
  private readonly rateLimitFallbackMs: number;
  private readonly cacheTtlMs: number;
  private queue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;
  private cooldownUntil = 0;
  private readonly cache = new Map<string, CachedValue>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(options: ScryfallClientOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.minimumIntervalMs = options.minimumIntervalMs ?? MIN_REQUEST_INTERVAL_MS;
    this.rateLimitFallbackMs = options.rateLimitFallbackMs ?? RATE_LIMIT_FALLBACK_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const key = this.requestKey(path, init);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value as T;
    if (cached) this.cache.delete(key);

    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const pending = this.enqueue(() => this.requestWithRetry<T>(path, init));
    this.inFlight.set(key, pending);
    try {
      const value = await pending;
      this.remember(key, value);
      return value;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async requestWithRetry<T>(path: string, init?: RequestInit): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.waitForTurn();

      let response: Response;
      try {
        response = await this.fetcher(`${SCRYFALL}${path}`, {
          ...init,
          headers: { ...SCRYFALL_APP_HEADERS, ...init?.headers },
        });
      } catch (error) {
        if (attempt < 2) {
          await this.sleep(500 * 2 ** attempt);
          continue;
        }
        throw error;
      }

      if (response.ok) return response.json() as Promise<T>;

      if (response.status === 429 && attempt === 0) {
        const delay = retryAfterMilliseconds(response, this.now(), this.rateLimitFallbackMs);
        this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + delay);
        await response.body?.cancel();
        continue;
      }

      if (response.status >= 500 && attempt < 2) {
        await response.body?.cancel();
        await this.sleep(500 * 2 ** attempt);
        continue;
      }

      const details = await errorDetails(response);
      if (response.status === 429) {
        throw new Error(`Scryfall is still rate-limited after its cooldown: ${details}`);
      }
      throw new Error(`Scryfall request failed (${response.status}): ${details}`);
    }

    throw new Error("Scryfall request failed after bounded retries.");
  }

  private async waitForTurn() {
    const waitUntil = Math.max(this.nextRequestAt, this.cooldownUntil);
    const delay = waitUntil - this.now();
    if (delay > 0) await this.sleep(delay);
    this.nextRequestAt = this.now() + this.minimumIntervalMs;
  }

  private requestKey(path: string, init?: RequestInit) {
    const method = init?.method?.toUpperCase() ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    return `${method}:${path}:${body}`;
  }

  private remember(key: string, value: unknown) {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (typeof oldestKey === "string") this.cache.delete(oldestKey);
    }
    this.cache.set(key, { expiresAt: this.now() + this.cacheTtlMs, value });
  }
}

const scryfallClient = new ScryfallClient();

async function scryfallFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return scryfallClient.request<T>(path, init);
}

export type ScryfallBulkData = {
  object: "bulk_data";
  id: string;
  type: string;
  updated_at: string;
  name: string;
  description: string;
  size: number;
  download_uri: string;
  content_type: string;
  content_encoding: string;
};

export async function getScryfallBulkData(type: "oracle_tags") {
  return scryfallFetch<ScryfallBulkData>(`/bulk-data/${type}`);
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

async function resolveScryfallCard(name: string) {
  return scryfallFetch<
    ScryfallCard & {
      oracle_id: string;
      scryfall_uri: string;
      legalities: Record<string, string>;
    }
  >(`/cards/named?fuzzy=${encodeURIComponent(name)}`);
}

export async function getScryfallCard(name: string) {
  const card = await resolveScryfallCard(name);

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

export async function getScryfallOracleIdentity(name: string) {
  const card = await resolveScryfallCard(name);
  return { name: card.name, oracleId: card.oracle_id };
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
