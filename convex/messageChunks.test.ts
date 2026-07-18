import { describe, expect, it } from "vitest";
import {
  MESSAGE_CHUNK_LENGTH,
  chunkSerializedMessage,
  restoreSerializedMessages,
} from "./messageChunks";

describe("message chunks", () => {
  it("round trips messages larger than one chunk", () => {
    const message = { role: "assistant", content: "x".repeat(MESSAGE_CHUNK_LENGTH + 25) };
    const serialized = JSON.stringify(message);
    const chunks = chunkSerializedMessage(serialized);

    expect(chunks).toHaveLength(2);
    expect(
      restoreSerializedMessages(
        chunks.map((content, chunkIndex) => ({ messageIndex: 0, chunkIndex, content })),
      ),
    ).toEqual([message]);
  });

  it("restores message and chunk ordering from indexed records", () => {
    const first = JSON.stringify({ role: "user", content: "hello" });
    const second = JSON.stringify({ role: "assistant", content: "world" });

    expect(
      restoreSerializedMessages([
        { messageIndex: 1, chunkIndex: 0, content: second },
        { messageIndex: 0, chunkIndex: 1, content: first.slice(5) },
        { messageIndex: 0, chunkIndex: 0, content: first.slice(0, 5) },
      ]),
    ).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
  });
});
