import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  ChatClient,
  fetchServerSentEvents,
  type ChatClientState,
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

class PersistentChatSession {
  private readonly listeners = new Set<() => void>();
  private readonly client: ChatClient<readonly []>;
  private requestOptions: PersistentChatRequestOptions;
  private snapshot: ChatSnapshot;
  private activeSend = false;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;
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
      onMessagesChange: (messages) => {
        this.updateSnapshot({ messages });
      },
      onLoadingChange: (isLoading) => {
        this.updateSnapshot({ isLoading });
        if (!isLoading) this.scheduleDrain();
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
    if (
      this.activeSend ||
      this.snapshot.isLoading ||
      this.snapshot.error ||
      this.snapshot.queuedMessages.length > 0
    ) {
      this.updateSnapshot({
        queuedMessages: [
          ...this.snapshot.queuedMessages,
          { id: crypto.randomUUID(), content: normalized, queuedAt: Date.now() },
        ],
      });
      return;
    }
    void this.dispatchMessage(normalized);
  }

  reload() {
    if (this.activeSend || this.snapshot.isLoading) return;
    void this.runClientAction(() => this.client.reload());
  }

  reloadWith(requestOptions: Partial<PersistentChatRequestOptions>) {
    if (this.activeSend || this.snapshot.isLoading) return;
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
    this.updateSnapshot({
      queuedMessages: this.snapshot.queuedMessages.filter((message) => message.id !== id),
    });
  }

  steerQueuedMessage(id: string) {
    const selected = this.snapshot.queuedMessages.find((message) => message.id === id);
    if (!selected) return;
    this.updateSnapshot({
      queuedMessages: [
        selected,
        ...this.snapshot.queuedMessages.filter((message) => message.id !== id),
      ],
    });
    if (this.activeSend || this.snapshot.isLoading) this.client.stop();
    this.scheduleDrain();
  }

  clearQueuedMessages() {
    if (this.snapshot.queuedMessages.length === 0) return;
    this.updateSnapshot({ queuedMessages: [] });
  }

  private async dispatchMessage(content: string) {
    await this.runClientAction(() => this.client.sendMessage(content));
  }

  private async runClientAction(action: () => void | Promise<void>) {
    this.activeSend = true;
    try {
      await action();
    } catch {
      // ChatClient reports request failures through onErrorChange.
    } finally {
      this.activeSend = false;
      this.scheduleDrain();
    }
  }

  private scheduleDrain() {
    if (this.drainTimer !== undefined) clearTimeout(this.drainTimer);
    this.drainTimer = setTimeout(() => {
      this.drainTimer = undefined;
      this.drainNextMessage();
    }, 0);
  }

  private drainNextMessage() {
    if (
      this.activeSend ||
      this.snapshot.isLoading ||
      this.snapshot.error ||
      this.snapshot.queuedMessages.length === 0
    ) {
      return;
    }
    const [next, ...remaining] = this.snapshot.queuedMessages;
    if (!next) return;
    this.updateSnapshot({ queuedMessages: remaining });
    void this.dispatchMessage(next.content);
  }

  dispose() {
    if (this.drainTimer !== undefined) clearTimeout(this.drainTimer);
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
