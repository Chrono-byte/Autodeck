import { describe, expect, it } from "vitest";
import { codexConversationInput } from "./codex-app-server.server";

describe("Codex app-server conversation input", () => {
  it("replays user and assistant text without UI-only reasoning", () => {
    expect(
      codexConversationInput([
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", content: "Tune my mana base." }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            { type: "thinking", content: "Internal summary" },
            { type: "text", content: "Start with 37 lands." },
          ],
        },
      ]),
    ).toBe("USER:\nTune my mana base.\n\nASSISTANT:\nStart with 37 lands.");
  });

  it("omits messages without text content", () => {
    expect(
      codexConversationInput([
        { id: "assistant-1", role: "assistant", parts: [{ type: "thinking", content: "Done" }] },
      ]),
    ).toBe("");
  });

  it("ignores incomplete message snapshots left by an interrupted stream", () => {
    expect(
      codexConversationInput([
        { id: "user-1", role: "user", parts: [{ type: "text", content: "First request" }] },
        { id: "assistant-interrupted", role: "assistant" },
        { id: "user-2", role: "user", parts: [{ type: "text", content: "Queued follow-up" }] },
      ]),
    ).toBe("USER:\nFirst request\n\nUSER:\nQueued follow-up");
  });
});
