import { describe, expect, it, vi } from "vitest";
import { cardImageUrl } from "./card-image";
import { fetchCardImage } from "./card-image.server";

describe("card images", () => {
  it("builds a stable same-origin cache key", () => {
    expect(cardImageUrl("Wear // Tear", "art_crop")).toBe(
      "/api/cards/images?name=Wear+%2F%2F+Tear&version=art_crop",
    );
  });

  it("proxies valid images with persistent cache headers", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("image bytes", {
          headers: { "content-type": "image/jpeg", etag: '"card-image"' },
        }),
    );

    const response = await fetchCardImage("Sol Ring", "normal", { fetcher });

    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("stale-if-error=31536000");
    expect(response.headers.get("etag")).toBe('"card-image"');
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("exact=Sol+Ring"),
      expect.objectContaining({ redirect: "follow" }),
    );
  });

  it("returns a transparent image without rendering an error card when Scryfall fails", async () => {
    const response = await fetchCardImage("Missing Card", "normal", {
      fetcher: vi.fn(async () => new Response("nope", { status: 503 })),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("cache-control")).toContain("max-age=15");
    expect(await response.text()).not.toContain("temporarily unavailable");
  });
});
