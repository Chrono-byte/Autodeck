import { describe, expect, it } from "vitest";
import {
  buildCodexReplayInput,
  normalizeCodexToolEvent,
  restoreCodexCompletedOutput,
  stripHistoricalToolProtocol,
} from "./codex-adapter.server";

describe("Codex Responses turn replay", () => {
  it("replays encrypted reasoning, the original function call, and its output in order", () => {
    const initial = [{ role: "user", content: "Inspect the deck" }] as never;
    const reasoning = {
      type: "reasoning",
      id: "rs_1",
      summary: [],
      encrypted_content: "opaque",
    };
    const functionCall = {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "get_active_deck",
      arguments: "{}",
    };
    const functionOutput = {
      type: "function_call_output",
      call_id: "call_1",
      output: '{"cards":[]}',
    };

    const replay = buildCodexReplayInput(
      initial,
      [[reasoning, functionCall] as never],
      [
        { role: "user", content: "Inspect the deck" },
        { type: "function_call", call_id: "call_1", name: "get_active_deck", arguments: "{}" },
        functionOutput,
      ] as never,
    );

    expect(replay).toEqual([initial[0], reasoning, functionCall, functionOutput]);
  });

  it("removes historical provider protocol items that no longer have reasoning state", () => {
    const input = [
      { role: "user", content: "First turn" },
      { type: "function_call", call_id: "call_old", name: "lookup", arguments: "{}" },
      { type: "function_call_output", call_id: "call_old", output: "result" },
      { role: "assistant", content: "The result was incorporated." },
      { role: "user", content: "Next turn" },
    ] as never;

    expect(stripHistoricalToolProtocol(input)).toEqual([input[0], input[3], input[4]]);
  });
});

describe("Codex tool-call event normalization", () => {
  it("uses call_id for TanStack while leaving provider item ids available for replay", () => {
    const ids = new Map<string, string>();
    const added = {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "lookup",
        arguments: "",
      },
    } as never;

    const normalizedAdded = normalizeCodexToolEvent(added, ids) as unknown as {
      item: { id: string };
    };
    const normalizedDelta = normalizeCodexToolEvent(
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: "{}" } as never,
      ids,
    ) as unknown as { item_id: string };

    expect(normalizedAdded.item.id).toBe("call_1");
    expect(normalizedDelta.item_id).toBe("call_1");
    expect((added as unknown as { item: { id: string } }).item.id).toBe("fc_1");
  });

  it("restores streamed function calls omitted from response.completed", () => {
    const functionCall = {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "search_web",
      arguments: '{"query":"five-color gate manabases"}',
    };
    const completed = {
      type: "response.completed",
      response: { id: "resp_1", output: [] },
    } as never;

    const restored = restoreCodexCompletedOutput(completed, [functionCall]) as unknown as {
      response: { output: Array<Record<string, unknown>> };
    };

    expect(restored.response.output).toEqual([functionCall]);
  });

  it("does not duplicate output items already present in response.completed", () => {
    const functionCall = {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "search_web",
      arguments: "{}",
    };
    const completed = {
      type: "response.completed",
      response: { id: "resp_1", output: [functionCall] },
    } as never;

    const restored = restoreCodexCompletedOutput(completed, [functionCall]) as unknown as {
      response: { output: Array<Record<string, unknown>> };
    };

    expect(restored.response.output).toEqual([functionCall]);
  });
});
