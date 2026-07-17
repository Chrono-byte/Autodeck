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

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          messages?: UIMessage[];
          forwardedProps?: {
            provider?: unknown;
            model?: unknown;
            reasoningEffort?: unknown;
            speed?: unknown;
          };
        };
        if (!Array.isArray(body.messages)) {
          return Response.json({ error: "A messages array is required." }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        const convexUrl = process.env.VITE_CONVEX_URL;
        if (!authHeader?.startsWith("Bearer ") || !convexUrl) {
          return Response.json({ error: "Authentication is required." }, { status: 401 });
        }

        const convex = new ConvexHttpClient(convexUrl);
        convex.setAuth(authHeader.slice("Bearer ".length));

        let codexCredential: { accessToken: string; accountId: string } | null = null;
        try {
          codexCredential = await convex.action(api.openaiCodex.resolveAccessToken);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unable to resolve Codex credentials.";
          if (/not authenticated/i.test(message)) {
            return Response.json({ error: "Your session has expired." }, { status: 401 });
          }
          return Response.json({ error: message }, { status: 502 });
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

        return toServerSentEventsResponse(stream);
      },
    },
  },
});
