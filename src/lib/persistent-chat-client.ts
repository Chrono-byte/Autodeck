import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  ChatClient,
  fetchServerSentEvents,
  type ChatClientState,
  type UIMessage,
} from "@tanstack/ai-client";
import { authClient } from "./auth-client";

type ChatMessages = Array<UIMessage<readonly []>>;

export interface PersistentChatRequestOptions {
  provider: "local" | "openai-codex";
  model?: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  speed: "standard" | "fast";
  deckId: string;
  threadId: string;
}

interface ChatSnapshot {
  messages: ChatMessages;
  isLoading: boolean;
  error: Error | undefined;
  status: ChatClientState;
}

class PersistentChatSession {
  private readonly listeners = new Set<() => void>();
  private readonly client: ChatClient<readonly []>;
  private requestOptions: PersistentChatRequestOptions;
  private snapshot: ChatSnapshot;

  constructor(
    private readonly id: string,
    initialMessages: ChatMessages,
    requestOptions: PersistentChatRequestOptions,
  ) {
    this.requestOptions = requestOptions;
    this.snapshot = {
      messages: initialMessages,
      isLoading: false,
      error: undefined,
      status: "ready",
    };
    this.client = new ChatClient<readonly []>({
      id,
      threadId: id,
      initialMessages,
      connection: fetchServerSentEvents("/api/chat", async () => {
        const { data, error } = await authClient.convex.token();
        if (error || !data?.token) {
          throw new Error("Your session has expired. Please sign in again.");
        }
        return {
          headers: {
            Authorization: `Bearer ${data.token}`,
            "x-request-id": crypto.randomUUID(),
          },
          body: this.requestOptions,
        };
      }),
      onMessagesChange: (messages) => {
        this.updateSnapshot({ messages });
      },
      onLoadingChange: (isLoading) => {
        this.updateSnapshot({ isLoading });
      },
      onErrorChange: (error) => {
        this.updateSnapshot({ error });
      },
      onStatusChange: (status) => {
        this.updateSnapshot({ status });
      },
    });
  }

  private updateSnapshot(change: Partial<ChatSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  updateRequestOptions(requestOptions: PersistentChatRequestOptions) {
    this.requestOptions = requestOptions;
  }

  hydrate(messages: ChatMessages) {
    if (this.snapshot.messages.length > 0 || messages.length === 0) return;
    this.client.setMessagesManually(messages);
  }

  sendMessage(content: string) {
    return this.client.sendMessage(content);
  }

  reload() {
    return this.client.reload();
  }

  stop() {
    this.client.stop();
  }

  dispose() {
    this.client.stop();
    this.client.dispose();
    this.listeners.clear();
  }
}

const sessions = new Map<string, PersistentChatSession>();

function getSession(
  id: string,
  initialMessages: ChatMessages,
  requestOptions: PersistentChatRequestOptions,
) {
  const existing = sessions.get(id);
  if (existing) {
    existing.updateRequestOptions(requestOptions);
    return existing;
  }
  const session = new PersistentChatSession(id, initialMessages, requestOptions);
  sessions.set(id, session);
  return session;
}

export function usePersistentChat({
  id,
  initialMessages,
  requestOptions,
}: {
  id: string;
  initialMessages: ChatMessages;
  requestOptions: PersistentChatRequestOptions;
}) {
  const session = useMemo(
    () => getSession(id, initialMessages, requestOptions),
    [id],
  );
  session.updateRequestOptions(requestOptions);

  useEffect(() => {
    session.hydrate(initialMessages);
  }, [initialMessages, session]);

  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );

  return {
    ...snapshot,
    sendMessage: (content: string) => session.sendMessage(content),
    reload: () => session.reload(),
    stop: () => session.stop(),
  };
}

export function clearPersistentChats() {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
}
