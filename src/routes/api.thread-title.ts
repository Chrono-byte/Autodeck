import { chat } from "@tanstack/ai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cleanGeneratedThreadTitle } from "../lib/thread-title";

const CODEX_TITLE_MODELS = new Set(["gpt-5.4-mini", "gpt-5.3-codex-spark"]);

function firstUserMessage(messageState: unknown) {
  if (!Array.isArray(messageState)) return "";
  for (const message of messageState) {
    if (
      !message ||
      typeof message !== "object" ||
      !("role" in message) ||
      message.role !== "user"
    ) {
      continue;
    }
    if (!("parts" in message) || !Array.isArray(message.parts)) continue;
    const parts = message.parts as unknown[];
    const content = parts
      .filter((part): part is { type: "text"; content: string } =>
        Boolean(
          part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "text" &&
          "content" in part &&
          typeof part.content === "string",
        ),
      )
      .map((part) => part.content)
      .join("\n")
      .trim();
    if (content) return content;
  }
  return "";
}

export const Route = createFileRoute("/api/thread-title")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const convexUrl = process.env.VITE_CONVEX_URL;
        if (!authHeader?.startsWith("Bearer ") || !convexUrl) {
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

        const convex = new ConvexHttpClient(convexUrl);
        convex.setAuth(authHeader.slice("Bearer ".length));
        const threadId = body.threadId as Id<"threads">;
        const thread = await convex.query(api.threads.get, { threadId });
        if (!thread) return Response.json({ error: "Thread not found." }, { status: 404 });
        const force = body.force === true;
        if (!force && thread.title !== "New thread" && thread.title !== "Deck study") {
          return Response.json({ title: thread.title, generated: false });
        }
        const sourceMessage =
          (typeof body.message === "string" ? body.message.trim() : "") ||
          firstUserMessage(thread.messageState);
        if (!sourceMessage) {
          return Response.json(
            { error: "The thread needs a user message before its title can be generated." },
            { status: 400 },
          );
        }

        const preferences = await convex.query(api.chatPreferences.get, {});
        const selected = preferences?.titleModel ?? "gpt-5.4-mini";
        const wantsLocal = selected === "local" || selected.startsWith("local:");
        const requestedLocalModel = selected.startsWith("local:")
          ? selected.slice("local:".length).trim()
          : "";
        const localModel =
          requestedLocalModel ||
          process.env.LM_STUDIO_TEXT_MODEL ||
          process.env.LM_STUDIO_MODEL ||
          "google/gemma-4-12b-qat";

        const credential = wantsLocal
          ? null
          : await convex.action(api.openaiCodex.resolveAccessToken, {
              requestId: crypto.randomUUID(),
            });
        const useCodex = Boolean(credential) && CODEX_TITLE_MODELS.has(selected);
        const baseURL = (process.env.LM_STUDIO_URL ?? "http://127.0.0.1:1234")
          .replace(/\/$/, "")
          .replace(/\/v1$/, "");
        const adapter =
          useCodex && credential
            ? (await import("../ai/codex-adapter.server")).createCodexResponsesAdapter(selected, {
                accessToken: credential.accessToken,
                accountId: credential.accountId,
              })
            : openaiCompatibleText(localModel, {
                name: "lm-studio",
                baseURL: `${baseURL}/v1`,
                apiKey: "not-needed",
                api: "chat-completions",
              });

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 15_000);
        try {
          const generated = await chat({
            adapter,
            stream: false,
            abortController,
            systemPrompts: [
              "Write a concise title for a conversation about a Magic: The Gathering Commander deck. Use 3 to 7 words. Return only the title with no quotes, punctuation, label, or explanation.",
            ],
            messages: [{ role: "user", content: sourceMessage.slice(0, 2_000) }],
            ...(useCodex && {
              modelOptions: {
                store: false,
                reasoning: { effort: "low", summary: "auto" },
                text: { verbosity: "low" },
              },
            }),
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
