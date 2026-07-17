import { useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "@tanstack/ai";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { authClient } from "../lib/auth-client";
import {
  editActiveDeckClientTool,
  getActiveDeckClientTool,
  type DeckToolContext,
} from "../ai/deck-tools";

type ResolvedCard = {
  name: string;
  typeLine: string;
  oracleText?: string;
  manaValue: number;
  colorIdentity: string[];
};

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

function textOf(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("");
}

export function DeckChat({
  deck,
  thread,
  cards,
}: {
  deck: Doc<"decks">;
  thread: Doc<"threads">;
  cards: Doc<"deckCards">[];
}) {
  const [input, setInput] = useState("");
  const [modelChoice, setModelChoice] = useState<ModelChoice>("gpt-5.6-sol");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [speed, setSpeed] = useState<Speed>("standard");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorPanel, setSelectorPanel] = useState<SelectorPanel>("root");
  const selectorRef = useRef<HTMLDivElement>(null);
  const codexStatus = useQuery(api.openaiCodex.status);
  const saveMessages = useMutation(api.threads.saveMessages);
  const upsertCard = useMutation(api.deckCards.upsert);
  const removeCard = useMutation(api.deckCards.remove);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("autodekt:model-selection") ?? "{}") as {
        model?: string;
        effort?: string;
        speed?: string;
      };
      if (saved.model === "local" || CODEX_MODELS.some((model) => model.value === saved.model))
        setModelChoice(saved.model as ModelChoice);
      if (["low", "medium", "high", "xhigh"].includes(saved.effort ?? ""))
        setReasoningEffort(saved.effort as ReasoningEffort);
      if (saved.speed === "standard" || saved.speed === "fast") setSpeed(saved.speed);
    } catch {
      /* Ignore malformed local preferences. */
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "autodekt:model-selection",
      JSON.stringify({ model: modelChoice, effort: reasoningEffort, speed }),
    );
  }, [modelChoice, reasoningEffort, speed]);

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

  const context = useMemo<DeckToolContext>(
    () => ({
      readDeck: () => ({
        deck: {
          name: deck.name,
          commanderName: deck.commanderName,
          colorIdentity: deck.colorIdentity,
        },
        cards: cards.map(({ name, quantity, zone, typeLine, oracleText, manaValue, tags }) => ({
          name,
          quantity,
          zone,
          typeLine,
          oracleText,
          manaValue,
          tags,
        })),
      }),
      editDeck: async (edit) => {
        if (edit.action === "remove") {
          const card = cards.find(
            (item) => item.name.toLocaleLowerCase() === edit.cardName.toLocaleLowerCase(),
          );
          if (!card)
            return { success: false, message: `${edit.cardName} is not in the active deck.` };
          await removeCard({ cardId: card._id, threadId: thread._id, actor: "assistant" });
          return { success: true, message: `Removed ${card.name}.` };
        }
        const response = await fetch(
          `/api/cards/resolve?name=${encodeURIComponent(edit.cardName)}`,
        );
        const resolved = (await response.json()) as ResolvedCard & { error?: string };
        if (!response.ok)
          return { success: false, message: resolved.error ?? "Card lookup failed." };
        await upsertCard({
          deckId: deck._id,
          threadId: thread._id,
          actor: "assistant",
          name: resolved.name,
          quantity: edit.quantity,
          zone: edit.zone,
          typeLine: resolved.typeLine,
          oracleText: resolved.oracleText,
          manaValue: resolved.manaValue,
          colorIdentity: resolved.colorIdentity,
          tags: edit.tags,
        });
        return {
          success: true,
          message: `Saved ${edit.quantity} × ${resolved.name} to ${edit.zone}.`,
        };
      },
    }),
    [cards, deck, removeCard, thread._id, upsertCard],
  );

  const chat = useChat({
    id: String(thread._id),
    connection: fetchServerSentEvents("/api/chat", async () => {
      const { data, error } = await authClient.convex.token();
      if (error || !data?.token) throw new Error("Your session has expired. Please sign in again.");
      return {
        headers: { Authorization: `Bearer ${data.token}` },
        body: {
          provider: modelChoice === "local" ? "local" : "openai-codex",
          model: modelChoice === "local" ? undefined : modelChoice,
          reasoningEffort,
          speed,
        },
      };
    }),
    initialMessages: (thread.messageState ?? []) as never[],
    tools: [getActiveDeckClientTool, editActiveDeckClientTool],
    context,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Convex values are JSON-like; normalize Date instances and omit undefined fields.
      const messages = JSON.parse(JSON.stringify(chat.messages)) as unknown[];
      void saveMessages({ threadId: thread._id, messages });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [chat.messages, saveMessages, thread._id]);

  const submit = () => {
    const content = input.trim();
    if (!content || chat.isLoading) return;
    chat.sendMessage({ content });
    setInput("");
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
        <span className="local-model-badge">● {activeModelLabel}</span>
      </header>
      <div className="chat-messages">
        {chat.messages.length === 0 && (
          <div className="chat-empty">
            <p className="eyebrow">DECK STUDY</p>
            <h1>How should we shape {deck.name}?</h1>
            <p>
              I can inspect the live deck, verify cards, research its structure, and edit the list
              with you.
            </p>
          </div>
        )}
        {chat.messages.map((message) => {
          const text = textOf(message);
          const toolCalls = message.parts.filter((part) => part.type === "tool-call");
          if (!text && !toolCalls.length) return null;
          return (
            <article key={message.id} className={`message ${message.role}`}>
              <div className="avatar">{message.role === "user" ? "Y" : "A"}</div>
              <div className="message-content">
                <strong>{message.role === "user" ? "You" : "Autodekt"}</strong>
                {text && <div className="message-body">{text}</div>}
                {toolCalls.map((part) => (
                  <div className="tool-chip" key={part.id}>
                    ↳ {part.name.replaceAll("_", " ")}
                  </div>
                ))}
              </div>
            </article>
          );
        })}
        {chat.isLoading && (
          <div className="thinking">
            <i />
            <i />
            <i /> Working through the deck
          </div>
        )}
      </div>
      {chat.error && <div className="error-banner">{chat.error.message}</div>}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
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
        />
        <div className="composer-footer">
          <span>Deck-aware · card text verified through Scryfall</span>
          <div className="composer-actions">
            <div className="model-selector" ref={selectorRef}>
              <button
                type="button"
                className="model-selector-trigger"
                disabled={!codexStatus?.connected}
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
                      {selectorPanel === "model" &&
                        CODEX_MODELS.map((model) => (
                          <button
                            type="button"
                            key={model.value}
                            onClick={() => {
                              setModelChoice(model.value);
                              setSelectorOpen(false);
                              setSelectorPanel("root");
                            }}
                          >
                            <span>{model.label}</span>
                            <span>{modelChoice === model.value ? "✓" : ""}</span>
                          </button>
                        ))}
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
            <button disabled={!input.trim() || chat.isLoading} aria-label="Send message">
              ↑
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
