import { describe, expect, it } from "vitest";
import {
  INLINE_MESSAGE_LENGTH,
  MAX_SERIALIZED_MESSAGE_LENGTH,
  chunkMessagePayload,
  restoreMessagePayload,
} from "./messagePayload";

describe("message payload storage", () => {
  it("round trips a chunked payload", () => {
    const payload = JSON.stringify({ content: "x".repeat(INLINE_MESSAGE_LENGTH + 25) });
    const chunks = chunkMessagePayload(payload);

    expect(chunks).toHaveLength(2);
    expect(
      restoreMessagePayload(
        undefined,
        chunks.map((content, chunkIndex) => ({ chunkIndex, content })),
      ),
    ).toBe(payload);
  });

  it("prefers an inline payload", () => {
    expect(restoreMessagePayload("inline", [{ chunkIndex: 0, content: "stale" }])).toBe("inline");
  });

  it("rejects a single payload beyond the transaction safety bound", () => {
    expect(() => chunkMessagePayload("x".repeat(MAX_SERIALIZED_MESSAGE_LENGTH + 1))).toThrow(
      "too large",
    );
  });
});
