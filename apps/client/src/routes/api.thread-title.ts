import { chat } from "@tanstack/ai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autodekt/backend/api";
import type { Id } from "@autodekt/backend/data-model";
import { authenticateConvexRequest } from "../lib/convex-request-auth.server";
import { isLoopbackRequest } from "../lib/local-request";
import { hasOpenAICodexConnection } from "../lib/openai-codex.server";
import { cleanGeneratedThreadTitle } from "../lib/thread-title";

const CODEX_TITLE_MODELS = new Set(["gpt-5.4-mini", "gpt-5.3-codex-spark"]);

export const Route = createFileRoute("/api/thread-title")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authenticated = await authenticateConvexRequest(request);
        if (!authenticated) {
          return Response.json({ error: "Authentication is required." }, { status: 401 });
        }

        let body: { threadId?: unknown; message?: unknown; force?: unknown };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "The request body must be valid JSON." }, { status: 400 });
        }
        if (typeof body.threadId !== "string") {
          return Response.json({ error: "A thread is required." }, { status: 400 });
        }

        const { convex, ownerId } = authenticated;
        const threadId = body.threadId as Id<"threads">;
        const thread = await convex.query(api.threads.get, { threadId });
        if (!thread) return Response.json({ error: "Thread not found." }, { status: 404 });
        const force = body.force === true;
        if (!force && thread.title !== "New thread" && thread.title !== "Deck study") {
          return Response.json({ title: thread.title, generated: false });
        }
        const sourceMessage =
          (typeof body.message === "string" ? body.message.trim() : "") ||
          thread.firstUserText?.trim() ||
          "";
        if (!sourceMessage) {
          return Response.json(
            { error: "The thread needs a user message before its title can be generated." },
            { status: 400 },
          );
        }

        const preferences = await convex.query(api.chatPreferences.get, {});
        const selected = preferences?.titleModel ?? "gpt-5.4-mini";
        const wantsLocal = selected === "local" || selected.startsWith("local:");
        if (!wantsLocal && !isLoopbackRequest(request)) {
          return Response.json(
            { error: "ChatGPT subscription models are available only on localhost." },
            { status: 403 },
          );
        }
        const requestedLocalModel = selected.startsWith("local:")
          ? selected.slice("local:".length).trim()
          : "";
        const localModel =
          requestedLocalModel ||
          process.env.LM_STUDIO_TEXT_MODEL ||
          process.env.LM_STUDIO_MODEL ||
          "google/gemma-4-12b-qat";

        const connected = wantsLocal ? false : await hasOpenAICodexConnection(ownerId);
        const useCodex = connected && CODEX_TITLE_MODELS.has(selected);
        const baseURL = (process.env.LM_STUDIO_URL ?? "http://127.0.0.1:1234")
          .replace(/\/$/, "")
          .replace(/\/v1$/, "");

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 15_000);
        try {
          const titleInstructions =
            "Write a concise title for a conversation about a Magic: The Gathering Commander deck. Use 3 to 7 words. Return only the title with no quotes, punctuation, label, or explanation.";
          const generated = useCodex
            ? await (
                await import("../ai/codex-app-server.server")
              ).generateCodexText({
                ownerId,
                model: selected,
                prompt: sourceMessage.slice(0, 2_000),
                instructions: titleInstructions,
                abortSignal: abortController.signal,
              })
            : await chat({
                adapter: openaiCompatibleText(localModel, {
                  name: "lm-studio",
                  baseURL: `${baseURL}/v1`,
                  apiKey: "not-needed",
                  api: "chat-completions",
                }),
                stream: false,
                abortController,
                systemPrompts: [titleInstructions],
                messages: [{ role: "user", content: sourceMessage.slice(0, 2_000) }],
              });
          const title = cleanGeneratedThreadTitle(generated);
          if (force) {
            await convex.mutation(api.threads.rename, { threadId, title });
            return Response.json({ title, generated: true });
          }
          const renamed = await convex.mutation(api.threads.renameIfUntitled, { threadId, title });
          return Response.json({ title, generated: renamed });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Title generation failed.";
          return Response.json({ error: message }, { status: 502 });
        } finally {
          clearTimeout(timeout);
        }
      },
    },
  },
});
