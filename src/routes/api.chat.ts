import { chat, maxIterations, toServerSentEventsResponse, type UIMessage } from "@tanstack/ai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import {
  analyzeDeckTool,
  braveSearchTool,
  comprehensiveRulesTool,
  getCardTool,
  searchCardsTool,
} from "../ai/tools.server";
import { SYSTEM_PROMPT } from "../ai/system-prompt";
import { editActiveDeckDefinition, getActiveDeckDefinition } from "../ai/deck-tools";
import { logger } from "../lib/logger.server";

const CODEX_MODELS = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex-spark",
]);
const REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

function requestIdFor(request: Request) {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[A-Za-z0-9_-]{8,80}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function jsonError(error: string, status: number, requestId: string) {
  return Response.json({ error, requestId }, { status, headers: { "x-request-id": requestId } });
}

function observeStream(
  response: Response,
  details: Record<string, unknown>,
  startedAt: number,
  requestId: string,
) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  let bytes = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          logger.info("chat.stream.completed", {
            requestId,
            durationMs: Date.now() - startedAt,
            bytes,
            ...details,
          });
          controller.close();
          return;
        }
        bytes += chunk.value.byteLength;
        controller.enqueue(chunk.value);
      } catch (error) {
        logger.error("chat.stream.failed", {
          requestId,
          durationMs: Date.now() - startedAt,
          bytes,
          error,
          ...details,
        });
        controller.error(error);
      }
    },
    async cancel(reason) {
      logger.warn("chat.stream.cancelled", {
        requestId,
        durationMs: Date.now() - startedAt,
        bytes,
        reason: String(reason ?? ""),
        ...details,
      });
      await reader.cancel(reason);
    },
  });
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId = requestIdFor(request);
        const startedAt = Date.now();
        let body: {
          messages?: UIMessage[];
          forwardedProps?: {
            provider?: unknown;
            model?: unknown;
            reasoningEffort?: unknown;
            speed?: unknown;
          };
        };
        try {
          body = await request.json();
        } catch (error) {
          logger.warn("chat.request.invalid_json", { requestId, error });
          return jsonError("The request body must be valid JSON.", 400, requestId);
        }
        if (!Array.isArray(body.messages)) {
          logger.warn("chat.request.invalid_messages", { requestId });
          return jsonError("A messages array is required.", 400, requestId);
        }
        logger.info("chat.request.started", { requestId, messageCount: body.messages.length });

        const authHeader = request.headers.get("authorization");
        const convexUrl = process.env.VITE_CONVEX_URL;
        if (!authHeader?.startsWith("Bearer ") || !convexUrl) {
          logger.warn("chat.request.unauthorized", {
            requestId,
            reason: !convexUrl ? "convex_not_configured" : "missing_bearer_token",
          });
          return jsonError("Authentication is required.", 401, requestId);
        }

        const convex = new ConvexHttpClient(convexUrl);
        convex.setAuth(authHeader.slice("Bearer ".length));

        let codexCredential: { accessToken: string; accountId: string } | null = null;
        try {
          codexCredential = await convex.action(api.openaiCodex.resolveAccessToken, { requestId });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unable to resolve Codex credentials.";
          if (/not authenticated/i.test(message)) {
            logger.warn("chat.request.session_expired", { requestId });
            return jsonError("Your session has expired.", 401, requestId);
          }
          logger.error("chat.auth.resolve_failed", { requestId, error });
          return jsonError("Unable to prepare the selected model.", 502, requestId);
        }

        const baseURL = (process.env.LM_STUDIO_URL ?? "http://127.0.0.1:1234")
          .replace(/\/$/, "")
          .replace(/\/v1$/, "");

        const requested = body.forwardedProps ?? {};
        const useCodex = Boolean(codexCredential) && requested.provider !== "local";
        const codexModel =
          typeof requested.model === "string" && CODEX_MODELS.has(requested.model)
            ? requested.model
            : "gpt-5.6-sol";
        const reasoningEffort =
          typeof requested.reasoningEffort === "string" &&
          REASONING_EFFORTS.has(requested.reasoningEffort)
            ? requested.reasoningEffort
            : "medium";
        const serviceTier = requested.speed === "fast" ? "priority" : "default";
        const provider = useCodex ? "openai-codex" : "lm-studio";
        const selectedModel = useCodex
          ? codexModel
          : (process.env.LM_STUDIO_MODEL ?? "google/gemma-4-12b-qat");
        const streamDetails = {
          provider,
          model: selectedModel,
          reasoningEffort: useCodex ? reasoningEffort : undefined,
          serviceTier: useCodex ? serviceTier : undefined,
        };
        logger.info("chat.provider.selected", { requestId, ...streamDetails });

        const adapter =
          useCodex && codexCredential
            ? openaiCompatibleText(codexModel, {
                name: "openai-codex",
                baseURL: "https://chatgpt.com/backend-api/codex",
                apiKey: codexCredential.accessToken,
                api: "responses",
                defaultHeaders: {
                  "chatgpt-account-id": codexCredential.accountId,
                  originator: "autodekt",
                  "OpenAI-Beta": "responses=experimental",
                },
              })
            : openaiCompatibleText(process.env.LM_STUDIO_MODEL ?? "google/gemma-4-12b-qat", {
                name: "lm-studio",
                baseURL: `${baseURL}/v1`,
                // The adapter requires a non-empty value; LM Studio does not authenticate it.
                apiKey: "not-needed",
                api: "chat-completions",
              });

        try {
          const stream = chat({
            adapter,
            messages: body.messages,
            systemPrompts: [SYSTEM_PROMPT],
            ...(useCodex && {
              modelOptions: {
                store: false,
                include: ["reasoning.encrypted_content"],
                reasoning: { effort: reasoningEffort, summary: "auto" },
                service_tier: serviceTier,
                text: { verbosity: "low" },
                parallel_tool_calls: true,
              },
            }),
            tools: [
              getCardTool,
              searchCardsTool,
              analyzeDeckTool,
              comprehensiveRulesTool,
              braveSearchTool,
              getActiveDeckDefinition,
              editActiveDeckDefinition,
            ],
            agentLoopStrategy: maxIterations(12),
          });
          return observeStream(toServerSentEventsResponse(stream), streamDetails, startedAt, requestId);
        } catch (error) {
          logger.error("chat.stream.create_failed", {
            requestId,
            durationMs: Date.now() - startedAt,
            error,
            ...streamDetails,
          });
          return jsonError("Unable to start the model response.", 502, requestId);
        }
      },
    },
  },
});
