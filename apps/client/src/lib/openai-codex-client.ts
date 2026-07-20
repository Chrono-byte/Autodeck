import { useCallback, useEffect, useState } from "react";
import { authClient } from "./auth-client";

export type OpenAICodexAuthEvent = {
  type: "device_code";
  userCode: string;
  verificationUri: string;
};

export interface OpenAICodexStatus {
  connected: boolean;
  models: Array<{ id: string; name: string }>;
}

type LoginStreamEvent =
  | { type: "auth"; event: OpenAICodexAuthEvent }
  | { type: "connected" }
  | { type: "error"; message: string };

async function authorizationHeaders() {
  const { data, error } = await authClient.convex.token();
  if (error || !data?.token) throw new Error("Your session has expired. Please sign in again.");
  return { Authorization: `Bearer ${data.token}` };
}

export async function readOpenAICodexStatus(): Promise<OpenAICodexStatus> {
  const response = await fetch("/api/openai-codex", { headers: await authorizationHeaders() });
  if (!response.ok) throw new Error("Unable to read the OpenAI Codex connection.");
  return (await response.json()) as OpenAICodexStatus;
}

export async function connectOpenAICodex(onAuthEvent: (event: OpenAICodexAuthEvent) => void) {
  const response = await fetch("/api/openai-codex", {
    method: "POST",
    headers: { ...(await authorizationHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login" }),
  });
  if (!response.ok || !response.body) throw new Error("Unable to start OpenAI Codex login.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const lines = buffer.split("\n");
    buffer = chunk.done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as LoginStreamEvent;
      if (event.type === "auth") onAuthEvent(event.event);
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "connected") return;
    }
    if (chunk.done) break;
  }
  throw new Error("OpenAI Codex login ended before it connected.");
}

export async function disconnectOpenAICodex() {
  const response = await fetch("/api/openai-codex", {
    method: "POST",
    headers: { ...(await authorizationHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ action: "logout" }),
  });
  if (!response.ok) throw new Error("Unable to disconnect OpenAI Codex.");
}

export function useOpenAICodexStatus() {
  const [status, setStatus] = useState<OpenAICodexStatus | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const refresh = useCallback(async () => {
    try {
      setStatus(await readOpenAICodexStatus());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Unable to read Codex status."));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, error, refresh };
}
