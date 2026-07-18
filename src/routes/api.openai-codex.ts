import { createFileRoute } from "@tanstack/react-router";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { authenticateConvexRequest } from "../lib/convex-request-auth.server";
import {
  getOpenAICodexStatus,
  loginOpenAICodex,
  logoutOpenAICodex,
} from "../lib/openai-codex.server";
import { isLoopbackRequest } from "../lib/local-request";

type LoginStreamEvent =
  | { type: "auth"; event: AuthEvent }
  | { type: "connected" }
  | { type: "error"; message: string };

function encodeEvent(event: LoginStreamEvent) {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export const Route = createFileRoute("/api/openai-codex")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isLoopbackRequest(request)) {
          return Response.json(
            { error: "ChatGPT subscription connections are available only on localhost." },
            { status: 403 },
          );
        }
        const authenticated = await authenticateConvexRequest(request);
        if (!authenticated) {
          return Response.json({ error: "Authentication is required." }, { status: 401 });
        }
        return Response.json(await getOpenAICodexStatus(authenticated.ownerId));
      },
      POST: async ({ request }) => {
        if (!isLoopbackRequest(request)) {
          return Response.json(
            { error: "ChatGPT subscription connections are available only on localhost." },
            { status: 403 },
          );
        }
        const authenticated = await authenticateConvexRequest(request);
        if (!authenticated) {
          return Response.json({ error: "Authentication is required." }, { status: 401 });
        }
        const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
        if (body?.action === "logout") {
          await logoutOpenAICodex(authenticated.ownerId);
          return Response.json({ connected: false });
        }
        if (body?.action !== "login") {
          return Response.json({ error: "A supported action is required." }, { status: 400 });
        }

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            void loginOpenAICodex(authenticated.ownerId, {
              signal: request.signal,
              prompt: async (prompt: AuthPrompt) => {
                if (prompt.type === "select") {
                  const deviceOption = prompt.options.find((option) => option.id === "device_code");
                  if (deviceOption) return deviceOption.id;
                }
                throw new Error(`Unsupported Codex login prompt: ${prompt.type}`);
              },
              notify(event) {
                controller.enqueue(encodeEvent({ type: "auth", event }));
              },
            })
              .then(() => {
                controller.enqueue(encodeEvent({ type: "connected" }));
                controller.close();
              })
              .catch((error) => {
                controller.enqueue(
                  encodeEvent({
                    type: "error",
                    message: error instanceof Error ? error.message : "OpenAI Codex login failed.",
                  }),
                );
                controller.close();
              });
          },
        });
        return new Response(stream, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/x-ndjson; charset=utf-8",
          },
        });
      },
    },
  },
});
