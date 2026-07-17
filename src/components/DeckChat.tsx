import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "@tanstack/ai-client";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { usePersistentChat } from "../lib/persistent-chat-client";
import { ChatMessage } from "./ChatMessage";

const CODEX_MODELS = [
  { value: "gpt-5.6-sol", label: "5.6 Sol" },
  { value: "gpt-5.6-terra", label: "5.6 Terra" },
  { value: "gpt-5.6-luna", label: "5.6 Luna" },
  { value: "gpt-5.5", label: "5.5" },
  { value: "gpt-5.4", label: "5.4" },
  { value: "gpt-5.4-mini", label: "5.4 Mini" },
  { value: "gpt-5.3-codex-spark", label: "5.3 Codex Spark" },
] as const;

type CodexModel = (typeof CODEX_MODELS)[number]["value"];
type ModelChoice = CodexModel | "local";
type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
type Speed = "standard" | "fast";
type SelectorPanel = "root" | "model" | "effort" | "speed";

const titleCase = (value: string) =>
  value === "xhigh" ? "XHigh" : `${value[0]?.toUpperCase()}${value.slice(1)}`;

function localPreferences() {
  const defaults: {
    model: ModelChoice;
    reasoningEffort: ReasoningEffort;
    speed: Speed;
  } = { model: "gpt-5.6-sol", reasoningEffort: "medium", speed: "standard" };
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
      saved.effort === "xhigh"
    ) {
      defaults.reasoningEffort = saved.effort;
    }
    if (saved.speed === "standard" || saved.speed === "fast") defaults.speed = saved.speed;
  } catch {
    /* Ignore malformed browser preferences during account migration. */
  }
  return defaults;
}

export function DeckChat({ deck, thread }: { deck: Doc<"decks">; thread: Doc<"threads"> }) {
  const [input, setInput] = useState("");
  const [modelChoice, setModelChoice] = useState<ModelChoice>("gpt-5.6-sol");
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
  const codexStatus = useQuery(api.openaiCodex.status);
  const accountPreferences = useQuery(api.chatPreferences.get);
  const saveMessages = useMutation(api.threads.saveMessages);
  const savePreferences = useMutation(api.chatPreferences.save);

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
    initialMessages: (thread.messageState ?? []) as Array<UIMessage<readonly []>>,
    requestOptions: {
      provider: selectedModel === "local" ? "local" : "openai-codex",
      model: selectedModel === "local" ? undefined : selectedModel,
      reasoningEffort,
      speed,
      deckId: String(deck._id),
      threadId: String(thread._id),
    },
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Convex values are JSON-like; normalize Date instances and omit undefined fields.
      const messages = JSON.parse(JSON.stringify(chat.messages)) as unknown[];
      void saveMessages({ threadId: thread._id, messages });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [chat.messages, saveMessages, thread._id]);

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

  const submit = () => {
    const content = input.trim();
    if (!content) return;
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

  return (
    <section className="chat-pane">
      <header className="pane-header">
        <div>
          <p className="eyebrow">THREAD</p>
          <h2>{thread.title}</h2>
        </div>
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
          {chat.messages.length === 0 && (
            <div className="chat-empty">
              <p className="eyebrow">DECK STUDY</p>
              <h1>How should we shape {deck.name}?</h1>
              <p>
                I can inspect the live deck, verify cards, research its structure, and edit the list
                with you.
              </p>
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
              onRetry={() => {
                followStreamRef.current = true;
                void chat.reload();
              }}
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
            <span className="composer-hint">Deck-aware · card text verified through Scryfall</span>
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
                          (["low", "medium", "high", "xhigh"] as const).map((effort) => (
                            <button
                              type="button"
                              key={effort}
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
