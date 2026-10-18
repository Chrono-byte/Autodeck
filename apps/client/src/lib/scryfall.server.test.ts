import { describe, expect, it, vi } from "vitest";
import { ScryfallClient, scryfallSearchResult } from "./scryfall.server";

function jsonResponse(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

describe("ScryfallClient", () => {
  it("paces concurrent requests below Scryfall's limit", async () => {
    let now = 0;
    const starts: number[] = [];
    const fetcher = vi.fn(async () => {
      starts.push(now);
      return jsonResponse({ ok: true });
    });
    const client = new ScryfallClient({
      fetcher,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
      minimumIntervalMs: 125,
    });

    await Promise.all([client.request("/one"), client.request("/two"), client.request("/three")]);
    expect(starts).toEqual([0, 125, 250]);
  });

  it("deduplicates in-flight calls and caches successful responses", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ name: "Sol Ring" }));
    const client = new ScryfallClient({ fetcher, minimumIntervalMs: 0 });

    const [first, second] = await Promise.all([
      client.request<{ name: string }>("/card"),
      client.request<{ name: string }>("/card"),
    ]);
    const third = await client.request<{ name: string }>("/card");

    expect(first).toEqual({ name: "Sol Ring" });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After once before retrying a 429", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(
        jsonResponse({ details: "Slow down" }, { status: 429, headers: { "retry-after": "2" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new ScryfallClient({
      fetcher,
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
      minimumIntervalMs: 125,
    });

    await expect(client.request("/limited")).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([2000]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("honors an extended cooldown when Scryfall responds with another 429", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(
        jsonResponse({ details: "Slow down" }, { status: 429, headers: { "retry-after": "2" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { details: "Keep waiting" },
          { status: 429, headers: { "retry-after": "3" } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new ScryfallClient({
      fetcher,
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
      minimumIntervalMs: 125,
    });

    await expect(client.request("/limited")).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([2000, 3000]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("scryfallSearchResult", () => {
  it("normalizes reversible cards whose type and mana value exist only on faces", () => {
    expect(
      scryfallSearchResult({
        name: "Estrid's Invocation // Estrid's Invocation",
        type_line: undefined as unknown as string,
        cmc: undefined as unknown as number,
        color_identity: ["U"],
        scryfall_uri: "https://scryfall.com/card/example",
        card_faces: [
          {
            name: "Estrid's Invocation",
            type_line: "Enchantment",
            oracle_text: "You may have this enchantment enter as a copy.",
            cmc: 3,
          },
          {
            name: "Estrid's Invocation",
            type_line: "Enchantment",
            oracle_text: "You may have this enchantment enter as a copy.",
            cmc: 3,
          },
        ],
      }),
    ).toMatchObject({
      typeLine: "Enchantment",
      manaValue: 3,
      oracleText:
        "You may have this enchantment enter as a copy. // You may have this enchantment enter as a copy.",
    });
  });
});

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
