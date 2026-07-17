import type { StreamChunk, TextOptions } from "@tanstack/ai";
import {
  OpenAICompatibleResponsesAdapter,
  openaiCompatibleText,
} from "@tanstack/ai-openai/compatible";

type ResponseItem = Record<string, unknown>;
type ResponseInput = ResponseItem[];
type ResponseOutput = ResponseItem[];
type ProcessStreamArgs<TModel extends string> = Parameters<
  OpenAICompatibleResponsesAdapter<TModel>["processStreamChunks"]
>;
type ResponseStreamEvent = ProcessStreamArgs<string>[0] extends AsyncIterable<infer T> ? T : never;

type CodexAdapterConfig = {
  accessToken: string;
  accountId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function protocolType(item: unknown) {
  return isRecord(item) && typeof item.type === "string" ? item.type : undefined;
}

function callIdOf(item: unknown) {
  return isRecord(item) && typeof item.call_id === "string" ? item.call_id : undefined;
}

/**
 * TanStack's cross-provider message history cannot represent opaque Responses
 * reasoning items. Old tool transcripts therefore cannot be replayed safely;
 * their effects are already summarized by the following assistant message.
 */
export function stripHistoricalToolProtocol(input: ResponseInput): ResponseInput {
  return input.filter((item) => {
    const type = protocolType(item);
    return type !== "function_call" && type !== "function_call_output" && type !== "reasoning";
  });
}

/** Rebuild the active tool turn from the provider's untouched output items. */
export function buildCodexReplayInput(
  initialInput: ResponseInput,
  responseBatches: ReadonlyArray<ResponseOutput>,
  currentInput: ResponseInput,
): ResponseInput {
  const toolOutputs = currentInput.filter((item) => protocolType(item) === "function_call_output");
  const replay: ResponseInput = [];

  for (const batch of responseBatches) {
    replay.push(...(batch as ResponseInput));
    const batchCallIds = new Set(
      batch
        .filter((item) => protocolType(item) === "function_call")
        .map(callIdOf)
        .filter((callId): callId is string => Boolean(callId)),
    );
    replay.push(...toolOutputs.filter((item) => batchCallIds.has(callIdOf(item) ?? "")));
  }

  return [...initialInput, ...replay];
}

/**
 * The Responses protocol distinguishes an output item id (`fc_...`) from the
 * function call id (`call_...`). TanStack's generic adapter treats item ids as
 * tool-call ids, so normalize provider events before its ToolCallManager sees
 * them while retaining the original events for replay.
 */
export function normalizeCodexToolEvent(
  chunk: ResponseStreamEvent,
  itemIdToCallId: Map<string, string>,
): ResponseStreamEvent {
  const event = chunk as unknown as Record<string, unknown>;
  const type = event.type;

  if (type === "response.output_item.added" || type === "response.output_item.done") {
    const item = event.item;
    if (isRecord(item) && item.type === "function_call") {
      const itemId = typeof item.id === "string" ? item.id : undefined;
      const callId = callIdOf(item);
      if (itemId && callId) itemIdToCallId.set(itemId, callId);
      if (callId) {
        return { ...event, item: { ...item, id: callId } } as unknown as ResponseStreamEvent;
      }
    }
  }

  if (
    (type === "response.function_call_arguments.delta" ||
      type === "response.function_call_arguments.done") &&
    typeof event.item_id === "string"
  ) {
    const callId = itemIdToCallId.get(event.item_id);
    if (callId) return { ...event, item_id: callId } as unknown as ResponseStreamEvent;
  }

  if (type === "response.completed" && isRecord(event.response)) {
    const output = Array.isArray(event.response.output) ? event.response.output : [];
    return {
      ...event,
      response: {
        ...event.response,
        output: output.map((item) => {
          if (!isRecord(item) || item.type !== "function_call") return item;
          const callId = callIdOf(item);
          return callId ? { ...item, id: callId } : item;
        }),
      },
    } as unknown as ResponseStreamEvent;
  }

  return chunk;
}

class CodexResponsesAdapter<TModel extends string> extends OpenAICompatibleResponsesAdapter<TModel> {
  private initialInput: ResponseInput | undefined;
  private readonly responseBatches: ResponseOutput[] = [];
  private readonly itemIdToCallId = new Map<string, string>();

  constructor(model: TModel, base: OpenAICompatibleResponsesAdapter<TModel>) {
    const client = (base as unknown as { client: ConstructorParameters<typeof OpenAICompatibleResponsesAdapter>[0] })
      .client;
    super(client, model, "openai-codex");
  }

  protected override mapOptionsToRequest(
    options: TextOptions<Record<string, unknown>>,
  ) {
    const request = super.mapOptionsToRequest(options);
    const currentInput = (Array.isArray(request.input) ? request.input : []) as unknown as ResponseInput;
    this.initialInput ??= stripHistoricalToolProtocol(currentInput);

    return {
      ...request,
      input: (
        this.responseBatches.length === 0
          ? this.initialInput
          : buildCodexReplayInput(this.initialInput, this.responseBatches, currentInput)
      ) as unknown as typeof request.input,
      ...(options.threadId ? { prompt_cache_key: options.threadId } : {}),
    };
  }

  protected override async *processStreamChunks(
    stream: AsyncIterable<ResponseStreamEvent>,
    toolCallMetadata: ProcessStreamArgs<TModel>[1],
    options: TextOptions<Record<string, unknown>>,
    aguiState: ProcessStreamArgs<TModel>[3],
  ): AsyncIterable<StreamChunk> {
    const normalizedStream = this.normalizeAndCapture(stream);
    yield* super.processStreamChunks(normalizedStream, toolCallMetadata, options, aguiState);
  }

  private async *normalizeAndCapture(
    stream: AsyncIterable<ResponseStreamEvent>,
  ): AsyncIterable<ResponseStreamEvent> {
    for await (const chunk of stream) {
      if (chunk.type === "response.completed") {
        this.responseBatches.push(chunk.response.output as unknown as ResponseOutput);
      }
      yield normalizeCodexToolEvent(chunk, this.itemIdToCallId);
    }
  }
}

export function createCodexResponsesAdapter<TModel extends string>(
  model: TModel,
  config: CodexAdapterConfig,
) {
  const base = openaiCompatibleText(model, {
    name: "openai-codex",
    baseURL: "https://chatgpt.com/backend-api/codex",
    apiKey: config.accessToken,
    api: "responses",
    defaultHeaders: {
      "chatgpt-account-id": config.accountId,
      originator: "autodekt",
      "OpenAI-Beta": "responses=experimental",
    },
  });
  if (!(base instanceof OpenAICompatibleResponsesAdapter)) {
    throw new Error("Codex requires the OpenAI Responses adapter.");
  }
  return new CodexResponsesAdapter(model, base);
}
