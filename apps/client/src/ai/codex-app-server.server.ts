import { randomUUID } from "node:crypto";
import {
  convertSchemaToJsonSchema,
  EventType,
  parseWithStandardSchema,
  toServerSentEventsResponse,
  type SchemaInput,
  type StreamChunk,
  type ToolExecutionContext,
  type UIMessage,
} from "@tanstack/ai";
import {
  codexAppServerFor,
  isRecord,
  type CodexNotification,
  type CodexServerRequest,
} from "../lib/openai-codex.server";
import { SYSTEM_PROMPT } from "./system-prompt";

type DynamicTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
  execute: (input: unknown, context: ToolExecutionContext<unknown>) => unknown;
};

type ThreadItem = Record<string, unknown> & { type: string; id: string };

export interface CodexChatOptions {
  ownerId: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max";
  serviceTier: "default" | "priority";
  messages: UIMessage[];
  tools: ReadonlyArray<unknown>;
  threadId?: string;
  runId?: string;
  abortSignal?: AbortSignal;
  instructions?: string;
}

class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: Error) => void;
  }> = [];
  private ended = false;
  private failure: Error | undefined;

  push(value: T) {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  close() {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  fail(error: Error) {
    this.failure = error;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ value, done: false });
    if (this.failure) return Promise.reject(this.failure);
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolveNext, rejectNext) => {
      this.waiters.push({ resolve: resolveNext, reject: rejectNext });
    });
  }
}

function asDynamicTool(value: unknown): DynamicTool | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    typeof value.execute !== "function"
  ) {
    return undefined;
  }
  return {
    name: value.name,
    description: value.description,
    inputSchema: value.inputSchema,
    execute: value.execute as DynamicTool["execute"],
  };
}

function dynamicToolSpec(tool: DynamicTool) {
  const inputSchema = convertSchemaToJsonSchema(tool.inputSchema as SchemaInput | undefined) ?? {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    inputSchema,
  };
}

function textFromMessage(message: Record<string, unknown>) {
  if (!Array.isArray(message.parts)) return "";
  return message.parts
    .flatMap((part) => {
      if (isRecord(part) && part.type === "text" && typeof part.content === "string") {
        return [part.content];
      }
      return [];
    })
    .join("");
}

export function codexConversationInput(messages: readonly unknown[]) {
  return messages
    .flatMap((message) => {
      if (
        !isRecord(message) ||
        (message.role !== "system" && message.role !== "user" && message.role !== "assistant")
      ) {
        return [];
      }
      const text = textFromMessage(message).trim();
      return text ? [`${message.role.toUpperCase()}:\n${text}`] : [];
    })
    .join("\n\n");
}

function itemFromNotification(notification: CodexNotification): ThreadItem | undefined {
  if (!isRecord(notification.params) || !isRecord(notification.params.item)) return undefined;
  const item = notification.params.item;
  return typeof item.type === "string" && typeof item.id === "string"
    ? (item as ThreadItem)
    : undefined;
}

function paramsForTurn(notification: CodexNotification, threadId: string, turnId?: string) {
  if (!isRecord(notification.params) || notification.params.threadId !== threadId) return undefined;
  if (turnId && notification.params.turnId !== turnId) return undefined;
  return notification.params;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function jsonContent(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function executeDynamicTool(
  request: CodexServerRequest,
  tools: Map<string, DynamicTool>,
  abortSignal?: AbortSignal,
) {
  if (request.method !== "item/tool/call" || !isRecord(request.params)) {
    throw new Error(`Unsupported Codex server request: ${request.method}`);
  }
  const toolName = typeof request.params.tool === "string" ? request.params.tool : "";
  const callId = typeof request.params.callId === "string" ? request.params.callId : "";
  const tool = tools.get(toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  try {
    const input = tool.inputSchema
      ? parseWithStandardSchema(tool.inputSchema, request.params.arguments)
      : request.params.arguments;
    const output = await tool.execute(input, {
      toolCallId: callId,
      abortSignal,
      emitCustomEvent: () => undefined,
    });
    return {
      success: true,
      contentItems: [{ type: "inputText", text: jsonContent(output ?? null) }],
    };
  } catch (error) {
    return {
      success: false,
      contentItems: [{ type: "inputText", text: JSON.stringify({ error: message(error) }) }],
    };
  }
}

function completedToolContent(item: ThreadItem) {
  if (!Array.isArray(item.contentItems)) return item.success === false ? "Tool call failed." : "";
  return item.contentItems
    .flatMap((content) =>
      isRecord(content) && content.type === "inputText" && typeof content.text === "string"
        ? [content.text]
        : [],
    )
    .join("\n");
}

async function* streamCodexChat(options: CodexChatOptions): AsyncGenerator<StreamChunk> {
  const client = codexAppServerFor(options.ownerId);
  const tools = new Map(
    options.tools.flatMap((value) => {
      const tool = asDynamicTool(value);
      return tool ? [[tool.name, tool] as const] : [];
    }),
  );
  const runId = options.runId ?? randomUUID();
  const uiThreadId = options.threadId ?? randomUUID();
  const timestamp = () => Date.now();
  const queue = new AsyncQueue<CodexNotification>();
  let codexThreadId = "";
  let turnId = "";
  let removeToolHandler: () => void = () => undefined;
  const openMessages = new Set<string>();
  const openReasoning = new Set<string>();
  const unsubscribe = client.subscribe((notification) => {
    if (codexThreadId && paramsForTurn(notification, codexThreadId)) queue.push(notification);
  });

  const abort = () => {
    if (codexThreadId && turnId) {
      void client
        .request("turn/interrupt", { threadId: codexThreadId, turnId })
        .catch(() => undefined);
    }
  };
  options.abortSignal?.addEventListener("abort", abort, { once: true });

  yield {
    type: EventType.RUN_STARTED,
    runId,
    threadId: uiThreadId,
    model: options.model,
    timestamp: timestamp(),
  };

  try {
    const started = await client.request("thread/start", {
      model: options.model,
      serviceTier: options.serviceTier,
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      serviceName: "autodekt",
      baseInstructions: options.instructions ?? SYSTEM_PROMPT,
      developerInstructions: options.instructions
        ? "Follow the supplied base instructions exactly. Do not inspect or modify local project files and do not run shell commands."
        : "Answer as the Autodekt deck-building assistant. Use the supplied dynamic tools for external facts and deck changes. Do not inspect or modify local project files and do not run shell commands.",
      dynamicTools: [...tools.values()].map(dynamicToolSpec),
    });
    if (!isRecord(started) || !isRecord(started.thread) || typeof started.thread.id !== "string") {
      throw new Error("Codex app-server did not create a thread.");
    }
    codexThreadId = started.thread.id;
    removeToolHandler = client.handleServerRequests(codexThreadId, (request) =>
      executeDynamicTool(request, tools, options.abortSignal),
    );

    const turn = await client.request("turn/start", {
      threadId: codexThreadId,
      input: [
        {
          type: "text",
          text: codexConversationInput(options.messages),
          text_elements: [],
        },
      ],
      model: options.model,
      serviceTier: options.serviceTier,
      effort: options.reasoningEffort,
      summary: "concise",
    });
    if (!isRecord(turn) || !isRecord(turn.turn) || typeof turn.turn.id !== "string") {
      throw new Error("Codex app-server did not start a turn.");
    }
    turnId = turn.turn.id;

    while (true) {
      const next = await queue.next();
      if (next.done) break;
      const notification = next.value;
      const params = paramsForTurn(notification, codexThreadId, turnId);
      if (!params) continue;

      if (notification.method === "item/agentMessage/delta") {
        const itemId = typeof params.itemId === "string" ? params.itemId : "";
        const delta = typeof params.delta === "string" ? params.delta : "";
        if (!itemId || !delta) continue;
        if (!openMessages.has(itemId)) {
          openMessages.add(itemId);
          yield {
            type: EventType.TEXT_MESSAGE_START,
            messageId: itemId,
            role: "assistant",
            model: options.model,
            timestamp: timestamp(),
          };
        }
        yield {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: itemId,
          delta,
          model: options.model,
          timestamp: timestamp(),
        };
        continue;
      }

      if (notification.method === "item/reasoning/summaryTextDelta") {
        const itemId = typeof params.itemId === "string" ? params.itemId : "";
        const delta = typeof params.delta === "string" ? params.delta : "";
        if (!itemId || !delta) continue;
        if (!openReasoning.has(itemId)) {
          openReasoning.add(itemId);
          yield {
            type: EventType.REASONING_START,
            messageId: itemId,
            model: options.model,
            timestamp: timestamp(),
          };
          yield {
            type: EventType.REASONING_MESSAGE_START,
            messageId: itemId,
            role: "reasoning",
            model: options.model,
            timestamp: timestamp(),
          };
        }
        yield {
          type: EventType.REASONING_MESSAGE_CONTENT,
          messageId: itemId,
          delta,
          model: options.model,
          timestamp: timestamp(),
        };
        continue;
      }

      if (notification.method === "item/started") {
        const item = itemFromNotification(notification);
        if (item?.type !== "dynamicToolCall" || typeof item.tool !== "string") continue;
        yield {
          type: EventType.TOOL_CALL_START,
          toolCallId: item.id,
          toolCallName: item.tool,
          toolName: item.tool,
          model: options.model,
          timestamp: timestamp(),
        };
        yield {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: item.id,
          delta: JSON.stringify(item.arguments ?? {}),
          model: options.model,
          timestamp: timestamp(),
        };
        continue;
      }

      if (notification.method === "item/completed") {
        const item = itemFromNotification(notification);
        if (!item) continue;
        if (item.type === "agentMessage" && openMessages.delete(item.id)) {
          yield {
            type: EventType.TEXT_MESSAGE_END,
            messageId: item.id,
            model: options.model,
            timestamp: timestamp(),
          };
        } else if (item.type === "reasoning" && openReasoning.delete(item.id)) {
          yield {
            type: EventType.REASONING_MESSAGE_END,
            messageId: item.id,
            model: options.model,
            timestamp: timestamp(),
          };
          yield {
            type: EventType.REASONING_END,
            messageId: item.id,
            model: options.model,
            timestamp: timestamp(),
          };
        } else if (item.type === "dynamicToolCall") {
          yield {
            type: EventType.TOOL_CALL_END,
            toolCallId: item.id,
            model: options.model,
            timestamp: timestamp(),
          };
          yield {
            type: EventType.TOOL_CALL_RESULT,
            messageId: `tool-result-${item.id}`,
            toolCallId: item.id,
            content: completedToolContent(item),
            role: "tool",
            model: options.model,
            timestamp: timestamp(),
          };
        }
        continue;
      }

      if (notification.method === "error") {
        const error =
          isRecord(params.error) && typeof params.error.message === "string"
            ? params.error.message
            : "Codex app-server turn failed.";
        if (params.willRetry !== true) throw new Error(error);
        continue;
      }

      if (notification.method === "turn/completed") {
        if (!isRecord(params.turn)) throw new Error("Codex app-server returned an invalid turn.");
        const status = params.turn.status;
        if (status === "failed") {
          const error =
            isRecord(params.turn.error) && typeof params.turn.error.message === "string"
              ? params.turn.error.message
              : "Codex app-server turn failed.";
          throw new Error(error);
        }
        break;
      }
    }

    for (const itemId of openMessages) {
      yield {
        type: EventType.TEXT_MESSAGE_END,
        messageId: itemId,
        model: options.model,
        timestamp: timestamp(),
      };
    }
    for (const itemId of openReasoning) {
      yield {
        type: EventType.REASONING_MESSAGE_END,
        messageId: itemId,
        model: options.model,
        timestamp: timestamp(),
      };
      yield {
        type: EventType.REASONING_END,
        messageId: itemId,
        model: options.model,
        timestamp: timestamp(),
      };
    }
    yield {
      type: EventType.RUN_FINISHED,
      runId,
      threadId: uiThreadId,
      finishReason: "stop",
      model: options.model,
      timestamp: timestamp(),
    };
  } finally {
    options.abortSignal?.removeEventListener("abort", abort);
    removeToolHandler();
    unsubscribe();
    queue.close();
    if (codexThreadId) {
      void client.request("thread/unsubscribe", { threadId: codexThreadId }).catch(() => undefined);
    }
  }
}

export function codexChatResponse(options: CodexChatOptions) {
  return toServerSentEventsResponse(streamCodexChat(options));
}

export async function generateCodexText(options: {
  ownerId: string;
  model: string;
  prompt: string;
  instructions: string;
  abortSignal?: AbortSignal;
}) {
  let text = "";
  for await (const event of streamCodexChat({
    ownerId: options.ownerId,
    model: options.model,
    reasoningEffort: "low",
    serviceTier: "default",
    messages: [
      { id: randomUUID(), role: "user", parts: [{ type: "text", content: options.prompt }] },
    ],
    tools: [],
    abortSignal: options.abortSignal,
    instructions: options.instructions,
  })) {
    if (event.type === EventType.TEXT_MESSAGE_CONTENT) text += event.delta;
  }
  return text;
}
