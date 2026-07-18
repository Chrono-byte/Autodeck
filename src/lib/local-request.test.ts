import { describe, expect, it } from "vitest";
import { isLoopbackRequest } from "./local-request";

describe("isLoopbackRequest", () => {
  it.each([
    "http://localhost:3000/api/chat",
    "http://app.localhost/api/chat",
    "http://127.0.0.1/api/chat",
    "http://127.42.1.9/api/chat",
    "http://[::1]/api/chat",
  ])("accepts local URL %s", (url) => {
    expect(isLoopbackRequest(new Request(url))).toBe(true);
  });

  it.each([
    "https://autodekt.example/api/chat",
    "http://192.168.1.20/api/chat",
    "http://128.0.0.1/api/chat",
  ])("rejects non-local URL %s", (url) => {
    expect(isLoopbackRequest(new Request(url))).toBe(false);
  });
});
