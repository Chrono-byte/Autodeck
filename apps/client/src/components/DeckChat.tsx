import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "@tanstack/ai-client";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@autodekt/backend/api";
import type { Doc } from "@autodekt/backend/data-model";
import {
  CODEX_MODELS,
  DEFAULT_CODEX_MODEL,
  isCodexModel,
  supportsMaxReasoning,
  type CodexModel,
  type ReasoningEffort,
} from "../ai/codex-models";
import { authClient } from "../lib/auth-client";
import { useOpenAICodexStatus } from "../lib/openai-codex-client";
import { usePersistentChat } from "../lib/persistent-chat-client";
import { ChatMessage } from "./ChatMessage";

type ModelChoice = CodexModel | "local";
type Speed = "standard" | "fast";
type SelectorPanel = "root" | "model" | "effort" | "speed";
type ChatMessage = UIMessage<readonly []>;

type MessageSyncItem = {
  messageId: string;
  order: number;
  role: "system" | "user" | "assistant";
  status: "streaming" | "complete" | "error";
  serializedPayload: string;
  searchText?: string;
};

type PendingMessageSync = {
  messages: MessageSyncItem[];
  truncateFromOrder?: number;
  turnCompleted: boolean;
};

function messageText(message: ChatMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("\n")
    .trim();
}

function isModelChoice(value: string): value is ModelChoice {
  return value === "local" || isCodexModel(value);
}

const titleCase = (value: string) =>
  value === "xhigh" ? "XHigh" : `${value[0]?.toUpperCase()}${value.slice(1)}`;

function localPreferences() {
  const defaults: {
    model: ModelChoice;
    reasoningEffort: ReasoningEffort;
    speed: Speed;
  } = { model: DEFAULT_CODEX_MODEL, reasoningEffort: "medium", speed: "standard" };
  try {
    const saved = JSON.parse(window.localStorage.getItem("autodekt:model-selection") ?? "{}") as {
      model?: string;
      effort?: string;
      speed?: string;
    };
    if (saved.model === "local" || CODEX_MODELS.some((item) => item.value === saved.model)) {
      defaults.model = saved.model as ModelChoice;
    }
    if (
      saved.effort === "low" ||
      saved.effort === "medium" ||
      saved.effort === "high" ||
      saved.effort === "xhigh" ||
      saved.effort === "max"
    ) {
      defaults.reasoningEffort = saved.effort;
    }
    if (saved.speed === "standard" || saved.speed === "fast") defaults.speed = saved.speed;
  } catch {
    /* Ignore malformed browser preferences during account migration. */
  }
  return defaults;
}

export function DeckChat({
  deck,
  thread,
  onOpenDeck,
}: {
  deck: Doc<"decks">;
  thread: Doc<"threads">;
  onOpenDeck: () => void;
}) {
  const [input, setInput] = useState("");
  const [modelChoice, setModelChoice] = useState<ModelChoice>(DEFAULT_CODEX_MODEL);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [speed, setSpeed] = useState<Speed>("standard");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorPanel, setSelectorPanel] = useState<SelectorPanel>("root");
  const [showJumpToTurn, setShowJumpToTurn] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const followStreamRef = useRef(true);
  const preferencesHydratedRef = useRef(false);
  const titleRequestedRef = useRef(false);
  const savedMessagesRef = useRef(new Map<string, { order: number; payload: string }>());
  const pendingSyncRef = useRef<PendingMessageSync | null>(null);
  const syncRunningRef = useRef(false);
  const wasLoadingRef = useRef(false);
  const { status: codexStatus } = useOpenAICodexStatus();
  const accountPreferences = useQuery(api.chatPreferences.get);
  const persistedMessages = usePaginatedQuery(
    api.threads.listMessages,
    { threadId: thread._id },
    { initialNumItems: 40 },
  );
  const syncMessages = useMutation(api.threads.syncMessages);
  const savePreferences = useMutation(api.chatPreferences.save);

  const hydratedMessages = useMemo(() => {
    return [...persistedMessages.results]
      .reverse()
      .map((message) => JSON.parse(message.serializedPayload) as ChatMessage);
  }, [persistedMessages.results]);

  useEffect(() => {
    for (const message of persistedMessages.results) {
      if (!savedMessagesRef.current.has(message.messageId)) {
        savedMessagesRef.current.set(message.messageId, {
          order: message.order,
          payload: message.serializedPayload,
        });
      }
    }
  }, [persistedMessages.results]);

  useEffect(() => {
    if (accountPreferences === undefined || preferencesHydratedRef.current) return;
    const preferences = accountPreferences ?? localPreferences();
    setModelChoice(preferences.model);
    setReasoningEffort(preferences.reasoningEffort);
    setSpeed(preferences.speed);
    preferencesHydratedRef.current = true;
    if (!accountPreferences) void savePreferences(preferences);
  }, [accountPreferences, savePreferences]);

  useEffect(() => {
    if (!preferencesHydratedRef.current) return;
    if (
      reasoningEffort === "max" &&
      modelChoice !== "local" &&
      !supportsMaxReasoning(modelChoice)
    ) {
      setReasoningEffort("xhigh");
      return;
    }
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(
        "autodekt:model-selection",
        JSON.stringify({ model: modelChoice, effort: reasoningEffort, speed }),
      );
      void savePreferences({ model: modelChoice, reasoningEffort, speed });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [modelChoice, reasoningEffort, savePreferences, speed]);

  useEffect(() => {
    if (!selectorOpen) return;
    const close = (event: PointerEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) {
        setSelectorOpen(false);
        setSelectorPanel("root");
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [selectorOpen]);

  const selectedModel = codexStatus?.connected ? modelChoice : "local";
  const chat = usePersistentChat({
    id: String(thread._id),
    initialMessages: hydratedMessages,
    requestOptions: {
      provider: selectedModel === "local" ? "local" : "openai-codex",
      model: selectedModel === "local" ? undefined : selectedModel,
      reasoningEffort,
      speed,
      deckId: String(deck._id),
      threadId: String(thread._id),
    },
  });

  const drainMessageSync = useCallback(async () => {
    if (syncRunningRef.current) return;
    syncRunningRef.current = true;
    try {
      while (pendingSyncRef.current) {
        const pending = pendingSyncRef.current;
        pendingSyncRef.current = null;
        const messages = pending.messages.filter(
          (message) =>
            savedMessagesRef.current.get(message.messageId)?.payload !== message.serializedPayload,
        );
        let truncateFromOrder = pending.truncateFromOrder;
        let firstRequest = true;
        do {
          const result = await syncMessages({
            threadId: thread._id,
            messages: firstRequest ? messages : [],
            truncateFromOrder,
            turnCompleted: firstRequest && pending.turnCompleted,
          });
          if (truncateFromOrder !== undefined) {
            for (const [messageId, saved] of savedMessagesRef.current) {
              if (saved.order >= truncateFromOrder) savedMessagesRef.current.delete(messageId);
            }
          }
          truncateFromOrder = result.truncationComplete ? undefined : pending.truncateFromOrder;
          firstRequest = false;
        } while (truncateFromOrder !== undefined);
        for (const message of messages) {
          savedMessagesRef.current.set(message.messageId, {
            order: message.order,
            payload: message.serializedPayload,
          });
        }
      }
    } catch (error: unknown) {
      console.error("Unable to save thread messages", error);
    } finally {
      syncRunningRef.current = false;
      if (pendingSyncRef.current) void drainMessageSync();
    }
  }, [syncMessages, thread._id]);

  useEffect(() => {
    if (persistedMessages.status === "LoadingFirstPage") return;
    const turnCompleted = wasLoadingRef.current && !chat.isLoading;
    wasLoadingRef.current = chat.isLoading;
    const timer = window.setTimeout(() => {
      const currentIds = new Set(chat.messages.map((message) => message.id));
      const missingOrders = [...savedMessagesRef.current.entries()]
        .filter(([messageId]) => !currentIds.has(messageId))
        .map(([, saved]) => saved.order);
      const truncateFromOrder = missingOrders.length > 0 ? Math.min(...missingOrders) : undefined;
      const messages = chat.messages.map((message, order): MessageSyncItem => {
        const serializedPayload = JSON.stringify(message);
        const isLast = order === chat.messages.length - 1;
        return {
          messageId: message.id,
          order,
          role: message.role,
          status:
            isLast && chat.isLoading ? "streaming" : isLast && chat.error ? "error" : "complete",
          serializedPayload,
          searchText: messageText(message) || undefined,
        };
      });
      pendingSyncRef.current = { messages, truncateFromOrder, turnCompleted };
      void drainMessageSync();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [chat.error, chat.isLoading, chat.messages, drainMessageSync, persistedMessages.status]);

  useEffect(() => {
    if (!followStreamRef.current) return;
    const container = messagesRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
      setShowJumpToTurn(false);
    }
  }, [chat.messages, chat.isLoading]);

  useEffect(() => {
    const content = messagesContentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (!followStreamRef.current) return;
      const container = messagesRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [input]);

  const requestThreadTitle = async (message: string) => {
    try {
      const { data, error } = await authClient.convex.token();
      if (error || !data?.token) return;
      await fetch("/api/thread-title", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ threadId: thread._id, message }),
      });
    } catch {
      // A title is optional; leave the placeholder when the fast model is unavailable.
    }
  };

  const submit = () => {
    const content = input.trim();
    if (!content) return;
    if (
      !titleRequestedRef.current &&
      chat.messages.length === 0 &&
      (thread.title === "New thread" || thread.title === "Deck study")
    ) {
      titleRequestedRef.current = true;
      void requestThreadTitle(content);
    }
    followStreamRef.current = true;
    setShowJumpToTurn(false);
    chat.sendMessage(content);
    setInput("");
  };

  const usePrompt = (prompt: string) => {
    setInput(prompt);
    textareaRef.current?.focus();
  };

  const pauseFollowing = () => {
    followStreamRef.current = false;
    setShowJumpToTurn(chat.messages.length > 0);
  };

  const jumpToCurrentTurn = () => {
    followStreamRef.current = true;
    setShowJumpToTurn(false);
    const container = messagesRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  };

  const activeChoice = codexStatus?.connected ? modelChoice : "local";
  const modelLabel =
    activeChoice === "local"
      ? "Local Gemma"
      : (CODEX_MODELS.find((model) => model.value === activeChoice)?.label ?? "5.6 Sol");
  const activeModelLabel =
    activeChoice === "local" ? modelLabel : `${modelLabel} ${titleCase(reasoningEffort)}`;
  const retryModels = [
    { value: "local", label: "Local Gemma" },
    ...CODEX_MODELS.map((model) => ({
      value: model.value,
      label: model.label,
      disabled: !codexStatus?.connected,
    })),
  ];

  const retryWithModel = (value: string) => {
    if (!isModelChoice(value)) return;
    followStreamRef.current = true;
    setShowJumpToTurn(false);
    setModelChoice(value);
    chat.reloadWith({
      provider: value === "local" ? "local" : "openai-codex",
      model: value === "local" ? undefined : value,
    });
  };

  return (
    <section className="chat-pane">
      <header className="pane-header">
        <div>
          <h2>{thread.title}</h2>
        </div>
        <button className="deck-pane-open" type="button" onClick={onOpenDeck}>
          Show deck
        </button>
      </header>
      <div
        className="chat-messages"
        ref={messagesRef}
        tabIndex={0}
        aria-label="Conversation transcript"
        onWheel={(event) => {
          if (event.deltaY < 0) pauseFollowing();
        }}
        onTouchMove={pauseFollowing}
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX >= bounds.right - 18) pauseFollowing();
        }}
        onKeyDown={(event) => {
          if (["ArrowUp", "PageUp", "Home"].includes(event.key)) pauseFollowing();
        }}
        onScroll={(event) => {
          const element = event.currentTarget;
          const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
          if (atBottom) {
            followStreamRef.current = true;
            setShowJumpToTurn(false);
          } else if (!followStreamRef.current) {
            setShowJumpToTurn(chat.messages.length > 0);
          }
        }}
      >
        <div className="chat-message-list" ref={messagesContentRef}>
          {persistedMessages.status === "CanLoadMore" && (
            <button type="button" onClick={() => persistedMessages.loadMore(40)}>
              Load older messages
            </button>
          )}
          {chat.messages.length === 0 && (
            <div className="chat-empty">
              <p className="eyebrow">{deck.commanderName ?? deck.name}</p>
              <h1>What do you want to work on?</h1>
              <p>Ask about the list, compare cards, or request a specific deck change.</p>
              <div className="suggestion-grid">
                <button
                  type="button"
                  onClick={() =>
                    usePrompt("Analyze my deck's game plan, strengths, and biggest weaknesses.")
                  }
                >
                  <span>Analyze the deck</span>
                  <small>Find structural gaps and pressure points</small>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    usePrompt("Recommend five high-impact cuts and replacements, with reasons.")
                  }
                >
                  <span>Suggest five swaps</span>
                  <small>Make focused, evidence-backed upgrades</small>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    usePrompt("Check my mana base and curve, then recommend improvements.")
                  }
                >
                  <span>Review mana & curve</span>
                  <small>Balance lands, ramp, and color needs</small>
                </button>
              </div>
            </div>
          )}
          {chat.messages.map((message, index) => (
            <ChatMessage
              key={message.id}
              message={message}
              streaming={
                chat.isLoading && index === chat.messages.length - 1 && message.role === "assistant"
              }
              canRetry={index === chat.messages.length - 1}
              retryModelLabel={modelLabel}
              retryModels={retryModels}
              onRetryWith={retryWithModel}
            />
          ))}
          {chat.isLoading && chat.messages.at(-1)?.role !== "assistant" && (
            <div className="thinking">
              <i />
              <i />
              <i /> Preparing the workspace
            </div>
          )}
          <div className="chat-scroll-anchor" aria-hidden="true" />
        </div>
      </div>
      {chat.error && (
        <div className="chat-error" role="alert">
          <span>
            <strong>Response interrupted.</strong> {chat.error.message}
          </span>
          <button type="button" onClick={() => void chat.reload()}>
            Try again
          </button>
        </div>
      )}
      <div className="chat-composer-zone">
        {chat.queuedMessages.length > 0 && (
          <div className="message-queue" aria-label="Queued messages">
            <div className="message-queue-header">
              <span>
                {chat.queuedMessages.length} queued
                {chat.error ? " · paused until retry" : " · sends automatically"}
              </span>
              <button type="button" onClick={chat.clearQueuedMessages}>
                Clear
              </button>
            </div>
            <ol>
              {chat.queuedMessages.map((message) => (
                <li key={message.id}>
                  <span>{message.content}</span>
                  <div className="message-queue-actions">
                    <button
                      type="button"
                      className="message-queue-steer"
                      onClick={() => chat.steerQueuedMessage(message.id)}
                      aria-label={`Steer with queued message: ${message.content}`}
                      title="Stop the current response and send this next"
                    >
                      Steer
                    </button>
                    <button
                      type="button"
                      onClick={() => chat.removeQueuedMessage(message.id)}
                      aria-label={`Remove queued message: ${message.content}`}
                      title="Remove from queue"
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        {showJumpToTurn && (
          <button type="button" className="jump-to-turn" onClick={jumpToCurrentTurn}>
            <span aria-hidden="true">↓</span> Jump to current turn
          </button>
        )}
        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`Ask about ${deck.commanderName ?? deck.name}, request cuts, or tell me to edit the list…`}
            rows={3}
            aria-label="Message Autodekt"
          />
          <div className="composer-footer">
            <div className="composer-actions">
              <div className="model-selector" ref={selectorRef}>
                <button
                  type="button"
                  className="model-selector-trigger"
                  onClick={() => {
                    setSelectorOpen((open) => !open);
                    setSelectorPanel("root");
                  }}
                  aria-expanded={selectorOpen}
                >
                  <span>{activeModelLabel}</span>
                  <span className="selector-chevron">⌄</span>
                </button>
                {selectorOpen && (
                  <div className="model-selector-menu" role="menu">
                    <button
                      type="button"
                      className={selectorPanel === "model" ? "active" : ""}
                      onClick={() => setSelectorPanel("model")}
                    >
                      <span>Model</span>
                      <span>{modelLabel}　›</span>
                    </button>
                    <button
                      type="button"
                      className={selectorPanel === "effort" ? "active" : ""}
                      onClick={() => setSelectorPanel("effort")}
                    >
                      <span>Effort</span>
                      <span>{titleCase(reasoningEffort)}　›</span>
                    </button>
                    <button
                      type="button"
                      className={selectorPanel === "speed" ? "active" : ""}
                      onClick={() => setSelectorPanel("speed")}
                    >
                      <span>Speed</span>
                      <span>{titleCase(speed)}　›</span>
                    </button>
                    {selectorPanel !== "root" && (
                      <div className="model-selector-submenu">
                        <p>
                          {selectorPanel === "model"
                            ? "Model"
                            : selectorPanel === "effort"
                              ? "Effort"
                              : "Speed"}
                        </p>
                        {selectorPanel === "model" && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setModelChoice("local");
                                setSelectorOpen(false);
                                setSelectorPanel("root");
                              }}
                            >
                              <span>Local Gemma</span>
                              <span>{modelChoice === "local" ? "✓" : ""}</span>
                            </button>
                            <div className="model-selector-divider" />
                            {CODEX_MODELS.map((model) => (
                              <button
                                type="button"
                                key={model.value}
                                disabled={!codexStatus?.connected}
                                title={
                                  codexStatus?.connected
                                    ? undefined
                                    : "Connect OpenAI Codex to use this model"
                                }
                                onClick={() => {
                                  setModelChoice(model.value);
                                  setSelectorOpen(false);
                                  setSelectorPanel("root");
                                }}
                              >
                                <span>{model.label}</span>
                                <span>{activeChoice === model.value ? "✓" : ""}</span>
                              </button>
                            ))}
                          </>
                        )}
                        {selectorPanel === "effort" &&
                          (["low", "medium", "high", "xhigh", "max"] as const).map((effort) => (
                            <button
                              type="button"
                              key={effort}
                              disabled={
                                effort === "max" &&
                                modelChoice !== "local" &&
                                !supportsMaxReasoning(modelChoice)
                              }
                              onClick={() => {
                                setReasoningEffort(effort);
                                setSelectorOpen(false);
                                setSelectorPanel("root");
                              }}
                            >
                              <span>{titleCase(effort)}</span>
                              <span>{reasoningEffort === effort ? "✓" : ""}</span>
                            </button>
                          ))}
                        {selectorPanel === "speed" &&
                          (["standard", "fast"] as const).map((option) => (
                            <button
                              type="button"
                              key={option}
                              onClick={() => {
                                setSpeed(option);
                                setSelectorOpen(false);
                                setSelectorPanel("root");
                              }}
                            >
                              <span>{titleCase(option)}</span>
                              <span>{speed === option ? "✓" : ""}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="stream-stop"
                hidden={!chat.isLoading}
                aria-label="Stop response"
                title="Stop response"
                onClick={() => chat.stop()}
              >
                <span className="stop-icon" aria-hidden="true" />
              </button>
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label={chat.isLoading ? "Queue message" : "Send message"}
                title={chat.isLoading ? "Queue message" : "Send message"}
              >
                ↑
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
