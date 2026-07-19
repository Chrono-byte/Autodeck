import { SCRYFALL_APP_HEADERS } from "./scryfall.server";
import type { CardImageVersion } from "./card-image";

const IMAGE_TIMEOUT_MS = 4_000;
const MIN_REQUEST_INTERVAL_MS = 125;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const SUCCESS_CACHE_CONTROL =
  "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=2592000, stale-if-error=31536000";
const FAILURE_CACHE_CONTROL = "public, max-age=15, s-maxage=15";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let imageRequestQueue: Promise<void> = Promise.resolve();
let nextImageRequestAt = 0;

function waitForImageRequestTurn() {
  const turn = imageRequestQueue.then(async () => {
    const delay = nextImageRequestAt - Date.now();
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    nextImageRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  });
  imageRequestQueue = turn.catch(() => undefined);
  return turn;
}

const TRANSPARENT_IMAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"/>';

export async function fetchCardImage(
  name: string,
  version: CardImageVersion,
  options: { fetcher?: Fetcher; timeoutMs?: number } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  if (!options.fetcher) await waitForImageRequestTurn();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? IMAGE_TIMEOUT_MS);

  try {
    const parameters = new URLSearchParams({
      exact: name,
      format: "image",
      version,
    });
    const upstream = await fetcher(`https://api.scryfall.com/cards/named?${parameters}`, {
      headers: SCRYFALL_APP_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = upstream.headers.get("content-type");
    if (!upstream.ok || !contentType?.startsWith("image/")) {
      await upstream.body?.cancel();
      throw new Error(`Scryfall image request failed (${upstream.status}).`);
    }
    const declaredSize = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
      await upstream.body?.cancel();
      throw new Error("Scryfall image exceeded the response size limit.");
    }
    const image = await upstream.arrayBuffer();
    if (image.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("Scryfall image exceeded the response size limit.");
    }

    const headers = new Headers({
      "Cache-Control": SUCCESS_CACHE_CONTROL,
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
    const etag = upstream.headers.get("etag");
    const lastModified = upstream.headers.get("last-modified");
    if (etag) headers.set("ETag", etag);
    if (lastModified) headers.set("Last-Modified", lastModified);
    return new Response(image, { headers });
  } catch {
    return new Response(TRANSPARENT_IMAGE, {
      headers: {
        "Cache-Control": FAILURE_CACHE_CONTROL,
        "Content-Type": "image/svg+xml; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}
