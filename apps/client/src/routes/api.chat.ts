import {
  chat,
  maxIterations,
  toServerSentEventsResponse,
  type ChatMiddleware,
  type UIMessage,
} from "@tanstack/ai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autodekt/backend/api";
import type { Id } from "@autodekt/backend/data-model";
import { DEFAULT_CODEX_MODEL, isCodexModel, normalizeReasoningEffort } from "../ai/codex-models";
import {
  braveSearchTool,
  comprehensiveRulesTool,
  createAnalyzeDeckTool,
  createSearchActiveDeckTool,
  createValidateActiveDeckTool,
  getCardOracleTagsTool,
  getCardTool,
  searchOracleTagsTool,
  searchCardsTool,
} from "../ai/tools.server";
import { SYSTEM_PROMPT } from "../ai/system-prompt";
import { validateAssistantAddition } from "../lib/commander-validation";
import { authenticateConvexRequest } from "../lib/convex-request-auth.server";
import { isManaColor } from "../lib/deck-analysis";
import { editActiveDeckDefinition, getActiveDeckDefinition } from "../ai/deck-tools";
import { logger } from "../lib/logger.server";
import { isLoopbackRequest } from "../lib/local-request";
import { hasOpenAICodexConnection } from "../lib/openai-codex.server";
import { scryfallArtTagCatalog } from "../lib/scryfall-art-tags.server";
import { scryfallOracleTagCatalog } from "../lib/scryfall-tags.server";
import { getScryfallCard } from "../lib/scryfall.server";

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
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (cancelled) return;
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
        if (cancelled) return;
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
      cancelled = true;
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
          threadId?: unknown;
          runId?: unknown;
          parentRunId?: unknown;
          messages?: UIMessage[];
          forwardedProps?: {
            provider?: unknown;
            model?: unknown;
            reasoningEffort?: unknown;
            speed?: unknown;
            deckId?: unknown;
            threadId?: unknown;
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

        const authenticated = await authenticateConvexRequest(request);
        if (!authenticated) {
          logger.warn("chat.request.unauthorized", {
            requestId,
            reason: "missing_or_invalid_session",
          });
          return jsonError("Authentication is required.", 401, requestId);
        }
        const { convex, ownerId } = authenticated;
        const requested = body.forwardedProps ?? {};

        if (requested.provider !== "local" && requested.provider !== "openai-codex") {
          return jsonError("A supported model provider is required.", 400, requestId);
        }
        const wantsCodex = requested.provider === "openai-codex";
        if (wantsCodex && !isLoopbackRequest(request)) {
          return jsonError(
            "ChatGPT subscription models are available only on localhost.",
            403,
            requestId,
          );
        }

        if (wantsCodex) {
          try {
            const connected = await hasOpenAICodexConnection(ownerId);
            if (!connected) {
              return jsonError(
                "Connect ChatGPT in account settings before using this model.",
                409,
                requestId,
              );
            }
          } catch (error) {
            logger.error("chat.auth.resolve_failed", { requestId, error });
            return jsonError("Unable to prepare the selected model.", 502, requestId);
          }
        }

        const baseURL = (process.env.LM_STUDIO_URL ?? "http://127.0.0.1:1234")
          .replace(/\/$/, "")
          .replace(/\/v1$/, "");

        if (typeof requested.deckId !== "string" || typeof requested.threadId !== "string") {
          logger.warn("chat.request.missing_deck_context", { requestId });
          return jsonError("The active deck context is required.", 400, requestId);
        }
        const deckId = requested.deckId as Id<"decks">;
        const threadId = requested.threadId as Id<"threads">;
        const readActiveDeck = async () => {
          const [deck, cards] = await Promise.all([
            convex.query(api.decks.get, { deckId }),
            convex.query(api.deckCards.list, { deckId }),
          ]);
          if (!deck) throw new Error("Deck not found");
          return {
            deck: {
              name: deck.name,
              commanderName: deck.commanderName,
              colorIdentity: deck.colorIdentity,
            },
            cards: cards.map(
              ({
                name,
                quantity,
                zone,
                typeLine,
                oracleText,
                manaValue,
                colorIdentity,
                oracleId,
                oracleTags,
                illustrationIds,
                artTags,
                tags,
              }) => ({
                name,
                quantity,
                zone,
                typeLine,
                oracleText,
                manaValue,
                colorIdentity,
                oracleId,
                oracleTags,
                illustrationIds,
                artTags,
                tags,
              }),
            ),
          };
        };
        try {
          await readActiveDeck();
        } catch (error) {
          logger.warn("chat.request.invalid_deck_context", { requestId, error });
          return jsonError("The active deck could not be loaded.", 404, requestId);
        }

        const getActiveDeckTool = getActiveDeckDefinition.server(readActiveDeck);
        const analyzeDeckTool = createAnalyzeDeckTool(readActiveDeck);
        const searchActiveDeckTool = createSearchActiveDeckTool(readActiveDeck);
        const validateActiveDeckTool = createValidateActiveDeckTool(readActiveDeck);
        const editActiveDeckTool = editActiveDeckDefinition.server(async (edit) => {
          const zone = edit.zone ?? "main";
          const quantity = edit.quantity ?? 1;
          if (edit.action === "remove") {
            const storedCards = await convex.query(api.deckCards.list, { deckId });
            const storedCard = storedCards.find(
              (item) =>
                item.name.toLocaleLowerCase() === edit.cardName.toLocaleLowerCase() &&
                item.zone === zone,
            );
            if (!storedCard)
              return {
                success: false,
                message: `${edit.cardName} is not in the active deck's ${zone}.`,
              };
            await convex.mutation(api.deckCards.remove, {
              cardId: storedCard._id,
              threadId,
              actor: "assistant",
            });
            const playableCardCount = (await readActiveDeck()).cards
              .filter((card) => card.zone !== "maybeboard")
              .reduce((total, card) => total + card.quantity, 0);
            return {
              success: true,
              message: `Removed ${storedCard.name} from ${storedCard.zone}.`,
              playableCardCount,
            };
          }
          const resolved = await getScryfallCard(edit.cardName);
          const [oracleTagIndex, artTagIndex] = await Promise.all([
            scryfallOracleTagCatalog.tagSlugsForOracleIds([resolved.oracleId]),
            scryfallArtTagCatalog.tagSlugsForIllustrationIds(resolved.illustrationIds),
          ]);
          const oracleTags = [...(oracleTagIndex.tagsByOracleId.get(resolved.oracleId) ?? [])];
          const artTags = [
            ...new Set(
              resolved.illustrationIds.flatMap((illustrationId) => [
                ...(artTagIndex.tagsByIllustrationId.get(illustrationId) ?? []),
              ]),
            ),
          ];
          const activeDeck = await readActiveDeck();
          const validationErrors = validateAssistantAddition(
            resolved,
            zone,
            quantity,
            activeDeck.cards,
          );
          if (validationErrors.length > 0) {
            return { success: false, message: validationErrors.join(" ") };
          }
          await convex.mutation(api.deckCards.upsert, {
            deckId,
            threadId,
            actor: "assistant",
            name: resolved.name,
            quantity,
            zone,
            typeLine: resolved.typeLine,
            oracleText: resolved.oracleText,
            manaValue: resolved.manaValue,
            colorIdentity: resolved.colorIdentity.filter(isManaColor),
            oracleId: resolved.oracleId,
            oracleTags,
            illustrationIds: resolved.illustrationIds,
            artTags,
            tags: edit.tags ?? [],
          });
          const playableCardCount = (await readActiveDeck()).cards
            .filter((card) => card.zone !== "maybeboard")
            .reduce((total, card) => total + card.quantity, 0);
          return {
            success: true,
            message: `Saved ${quantity} × ${resolved.name} to ${zone}.`,
            playableCardCount,
          };
        });
        const useCodex = wantsCodex;
        const codexModel = isCodexModel(requested.model) ? requested.model : DEFAULT_CODEX_MODEL;
        const reasoningEffort = normalizeReasoningEffort(requested.reasoningEffort, codexModel);
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
        const observabilityMiddleware: ChatMiddleware = {
          name: "request-observability",
          onIteration: (_ctx, info) => {
            logger.info("chat.agent.iteration", { requestId, iteration: info.iteration + 1 });
          },
          onToolPhaseComplete: (_ctx, info) => {
            logger.info("chat.agent.tools_completed", {
              requestId,
              tools: info.toolCalls.map((call) => call.function.name),
              resultCount: info.results.length,
              clientExecutionCount: info.needsClientExecution.length,
              approvalCount: info.needsApproval.length,
            });
          },
          onFinish: (_ctx, info) => {
            logger.info("chat.agent.finished", {
              requestId,
              finishReason: info.finishReason,
              durationMs: info.duration,
            });
          },
          onError: (_ctx, info) => {
            logger.error("chat.agent.failed", {
              requestId,
              durationMs: info.duration,
              error: info.error,
            });
          },
        };

        const chatTools = [
          getCardTool,
          getCardOracleTagsTool,
          searchOracleTagsTool,
          searchCardsTool,
          analyzeDeckTool,
          searchActiveDeckTool,
          validateActiveDeckTool,
          comprehensiveRulesTool,
          braveSearchTool,
          getActiveDeckTool,
          editActiveDeckTool,
        ];

        try {
          if (useCodex) {
            const response = (await import("../ai/codex-app-server.server")).codexChatResponse({
              ownerId,
              model: codexModel,
              reasoningEffort,
              serviceTier,
              messages: body.messages,
              tools: chatTools,
              ...(typeof body.threadId === "string" && { threadId: body.threadId }),
              ...(typeof body.runId === "string" && { runId: body.runId }),
              abortSignal: request.signal,
            });
            return observeStream(response, streamDetails, startedAt, requestId);
          }

          const adapter = openaiCompatibleText(
            process.env.LM_STUDIO_MODEL ?? "google/gemma-4-12b-qat",
            {
              name: "lm-studio",
              baseURL: `${baseURL}/v1`,
              // The adapter requires a non-empty value; LM Studio does not authenticate it.
              apiKey: "not-needed",
              api: "chat-completions",
            },
          );
          const stream = chat({
            adapter,
            messages: body.messages,
            ...(typeof body.threadId === "string" && { threadId: body.threadId }),
            ...(typeof body.runId === "string" && { runId: body.runId }),
            ...(typeof body.parentRunId === "string" && { parentRunId: body.parentRunId }),
            systemPrompts: [SYSTEM_PROMPT],
            tools: chatTools,
            agentLoopStrategy: maxIterations(12),
            middleware: [observabilityMiddleware],
          });
          return observeStream(
            toServerSentEventsResponse(stream),
            streamDetails,
            startedAt,
            requestId,
          );
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
