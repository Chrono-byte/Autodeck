import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  ChatClient,
  fetchServerSentEvents,
  type ChatClientState,
  type QueuedMessage,
  type UIMessage,
} from "@tanstack/ai-client";
import { authClient } from "./auth-client";

type ChatMessages = Array<UIMessage<readonly []>>;

export interface QueuedChatMessage {
  id: string;
  content: string;
  queuedAt: number;
}

export interface PersistentChatRequestOptions {
  provider: "local" | "openai-codex";
  model?: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max";
  speed: "standard" | "fast";
  deckId: string;
  threadId: string;
}

interface ChatSnapshot {
  messages: ChatMessages;
  queuedMessages: QueuedChatMessage[];
  isLoading: boolean;
  error: Error | undefined;
  status: ChatClientState;
}

function toQueuedChatMessages(messages: QueuedMessage[]): QueuedChatMessage[] {
  return messages.flatMap((message) =>
    typeof message.content === "string"
      ? [
          {
            id: message.id,
            content: message.content,
            queuedAt: message.createdAt,
          },
        ]
      : [],
  );
}

class PersistentChatSession {
  private readonly listeners = new Set<() => void>();
  private readonly client: ChatClient<readonly []>;
  private requestOptions: PersistentChatRequestOptions;
  private snapshot: ChatSnapshot;
  private nextRequestOptions: PersistentChatRequestOptions | undefined;

  constructor(
    private readonly id: string,
    initialMessages: ChatMessages,
    requestOptions: PersistentChatRequestOptions,
  ) {
    this.requestOptions = requestOptions;
    this.snapshot = {
      messages: initialMessages,
      queuedMessages: [],
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
        const body = this.nextRequestOptions ?? this.requestOptions;
        this.nextRequestOptions = undefined;
        return {
          headers: {
            Authorization: `Bearer ${data.token}`,
            "x-request-id": crypto.randomUUID(),
          },
          body,
        };
      }),
      queue: { whenBusy: "queue", drain: "fifo" },
      onQueueChange: (messages) => {
        this.updateSnapshot({ queuedMessages: toQueuedChatMessages(messages) });
      },
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
    if (messages.length === 0) return;
    const currentById = new Map(this.snapshot.messages.map((message) => [message.id, message]));
    const persistedIds = new Set(messages.map((message) => message.id));
    const merged = [
      ...messages.map((message) => currentById.get(message.id) ?? message),
      ...this.snapshot.messages.filter((message) => !persistedIds.has(message.id)),
    ];
    if (
      merged.length === this.snapshot.messages.length &&
      merged.every((message, index) => message === this.snapshot.messages[index])
    ) {
      return;
    }
    this.client.setMessagesManually(merged);
  }

  sendMessage(content: string) {
    const normalized = content.trim();
    if (!normalized) return;
    void this.runClientAction(() => this.client.sendMessage(normalized));
  }

  reload() {
    if (this.snapshot.isLoading) return;
    void this.runClientAction(() => this.client.reload());
  }

  reloadWith(requestOptions: Partial<PersistentChatRequestOptions>) {
    if (this.snapshot.isLoading) return;
    this.nextRequestOptions = { ...this.requestOptions, ...requestOptions };
    void this.runClientAction(async () => {
      try {
        await this.client.reload();
      } finally {
        this.nextRequestOptions = undefined;
      }
    });
  }

  stop() {
    this.client.stop();
  }

  removeQueuedMessage(id: string) {
    this.client.cancelQueued(id);
  }

  steerQueuedMessage(id: string) {
    const selected = this.snapshot.queuedMessages.find((message) => message.id === id);
    if (!selected) return;
    this.client.cancelQueued(id);
    void this.runClientAction(() =>
      this.client.sendMessage(selected.content, undefined, { whenBusy: "interrupt" }),
    );
  }

  clearQueuedMessages() {
    for (const message of this.snapshot.queuedMessages) this.client.cancelQueued(message.id);
  }

  private async runClientAction(action: () => void | Promise<void>) {
    try {
      await action();
    } catch {
      // ChatClient reports request failures through onErrorChange.
    }
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
  const session = useMemo(() => getSession(id, initialMessages, requestOptions), [id]);
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
    reloadWith: (requestOptions: Partial<PersistentChatRequestOptions>) =>
      session.reloadWith(requestOptions),
    stop: () => session.stop(),
    steerQueuedMessage: (id: string) => session.steerQueuedMessage(id),
    removeQueuedMessage: (id: string) => session.removeQueuedMessage(id),
    clearQueuedMessages: () => session.clearQueuedMessages(),
  };
}

export function clearPersistentChats() {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
}
