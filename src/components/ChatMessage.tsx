import { useState, type CSSProperties, type ReactNode } from "react";
import type { MessagePart, ToolCallPart, ToolResultPart, UIMessage } from "@tanstack/ai";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { manaAssetKey, remarkManaSymbols } from "../lib/mana-markdown";

const TOOL_LABELS: Record<string, { active: string; complete: string; icon: string }> = {
  get_card: { active: "Looking up card", complete: "Looked up card", icon: "◇" },
  search_cards: { active: "Searching cards", complete: "Searched cards", icon: "⌕" },
  analyze_deck: { active: "Analyzing deck", complete: "Analyzed deck", icon: "◫" },
  comprehensive_rules: { active: "Checking rules", complete: "Checked rules", icon: "§" },
  brave_search: { active: "Researching the web", complete: "Researched the web", icon: "◎" },
  get_active_deck: { active: "Reading deck", complete: "Read deck", icon: "▤" },
  edit_active_deck: { active: "Updating deck", complete: "Updated deck", icon: "✦" },
};

const MANA_COLORS: Record<string, string> = {
  W: "#f4f0d5",
  U: "#84c6e8",
  B: "#8c8490",
  R: "#e47a5f",
  G: "#78b88a",
  C: "#c5c8c6",
  S: "#b9d9e8",
  X: "#aaa7a0",
  Y: "#aaa7a0",
  Z: "#aaa7a0",
  P: "#9b655f",
};

function manaParts(symbol: string) {
  if (/^\d+$/.test(symbol)) return ["C"];
  return symbol.replaceAll("/", "").split("");
}

function manaBackground(symbol: string) {
  const colors = manaParts(symbol).map((part) => MANA_COLORS[part] ?? MANA_COLORS.C);
  if (colors.length === 1) return colors[0];
  if (colors.length === 2) {
    return `linear-gradient(135deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`;
  }
  const stops = colors.flatMap((color, index) => {
    const start = (index / colors.length) * 100;
    const end = ((index + 1) / colors.length) * 100;
    return [`${color} ${start}%`, `${color} ${end}%`];
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function ManaSymbol({ symbol }: { symbol: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const normalized = symbol.toUpperCase();
  const compact = normalized.replaceAll("/", "");
  const label = /^\d+$/.test(normalized) ? normalized : compact;
  const style: CSSProperties = { background: manaBackground(normalized) };
  const accessibleLabel = `${normalized} mana`;

  if (!imageFailed) {
    return (
      <img
        className="mana-symbol mana-symbol-image"
        src={`/mana/${manaAssetKey(normalized)}.svg`}
        alt={accessibleLabel}
        title={accessibleLabel}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className={`mana-symbol mana-symbol-fallback ${label.length > 1 ? "mana-symbol-complex" : ""}`}
      style={style}
      role="img"
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <span aria-hidden="true">{label}</span>
    </span>
  );
}

function displayName(name: string) {
  return name.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeJson(value: unknown) {
  if (value === undefined) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value) as unknown, null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function contentOf(result: ToolResultPart | undefined) {
  if (!result) return "";
  if (typeof result.content === "string") return safeJson(result.content);
  return safeJson(result.content);
}

const markdownComponents: Components = {
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  code: ({ children, className, ...props }) => {
    const isBlock = className?.startsWith("language-");
    if (!isBlock) return <code {...props}>{children}</code>;
    return (
      <code {...props} className={className}>
        {children}
      </code>
    );
  },
  i: ({ children, className, ...props }) => {
    if (className === "mana-symbol-placeholder" && typeof children === "string") {
      return <ManaSymbol symbol={children} />;
    }
    return (
      <i {...props} className={className}>
        {children}
      </i>
    );
  },
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkManaSymbols]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function Reasoning({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <details className={`reasoning-trace ${streaming ? "streaming" : ""}`} open={streaming}>
      <summary>
        <span className="reasoning-spark" aria-hidden="true">
          ✦
        </span>
        <span>{streaming ? "Thinking" : "Reasoning"}</span>
        {streaming && <span className="reasoning-live">Live</span>}
        <span className="disclosure-arrow" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="reasoning-content">
        <Markdown>{content}</Markdown>
        {streaming && <span className="streaming-caret" aria-hidden="true" />}
      </div>
    </details>
  );
}

function ToolCall({
  part,
  result,
  messageStreaming,
}: {
  part: ToolCallPart;
  result: ToolResultPart | undefined;
  messageStreaming: boolean;
}) {
  const failed = part.state === "error" || result?.state === "error";
  const complete = part.state === "complete" || result?.state === "complete";
  const active = messageStreaming && !complete && !failed;
  const labels = TOOL_LABELS[part.name];
  const title = labels ? (active ? labels.active : labels.complete) : displayName(part.name);
  const input = safeJson(part.input ?? part.arguments);
  const output = contentOf(result) || safeJson(part.output);
  const error = result?.error;

  return (
    <details className={`tool-call ${active ? "active" : ""} ${failed ? "failed" : ""}`}>
      <summary>
        <span className="tool-icon" aria-hidden="true">
          {labels?.icon ?? "↳"}
        </span>
        <span className="tool-title">{failed ? `${title} failed` : title}</span>
        <span className="tool-state">
          {active ? <span className="tool-spinner" /> : failed ? "!" : "✓"}
        </span>
        <span className="disclosure-arrow" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="tool-details">
        {input && (
          <section>
            <span>Input</span>
            <pre>
              <code>{input}</code>
            </pre>
          </section>
        )}
        {(output || error) && (
          <section>
            <span>{error ? "Error" : "Result"}</span>
            <pre>
              <code>{error ?? output}</code>
            </pre>
          </section>
        )}
      </div>
    </details>
  );
}

function Part({
  part,
  parts,
  streaming,
}: {
  part: MessagePart;
  parts: MessagePart[];
  streaming: boolean;
}): ReactNode {
  if (part.type === "text") return part.content ? <Markdown>{part.content}</Markdown> : null;
  if (part.type === "thinking") {
    return part.content ? <Reasoning content={part.content} streaming={streaming} /> : null;
  }
  if (part.type === "tool-call") {
    const result = parts.find(
      (candidate): candidate is ToolResultPart =>
        candidate.type === "tool-result" && candidate.toolCallId === part.id,
    );
    return <ToolCall part={part} result={result} messageStreaming={streaming} />;
  }
  if (part.type === "structured-output") {
    const value = part.data ?? part.partial ?? part.raw;
    return value ? (
      <pre className="structured-output">
        <code>{safeJson(value)}</code>
      </pre>
    ) : null;
  }
  return null;
}

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("\n");
}

export function ChatMessage({
  message,
  streaming,
  canRetry,
  onRetry,
}: {
  message: UIMessage;
  streaming: boolean;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const visibleParts = message.parts.filter((part) => part.type !== "tool-result");
  const hasVisibleContent = visibleParts.some((part) => {
    if (part.type === "text" || part.type === "thinking") return Boolean(part.content);
    return part.type === "tool-call" || part.type === "structured-output";
  });
  if (!hasVisibleContent) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(messageText(message));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <article className={`message ${message.role}`} aria-label={`${message.role} message`}>
      {message.role === "assistant" && (
        <div className="avatar" aria-hidden="true">
          A
        </div>
      )}
      <div className="message-content">
        <span className="message-author">{message.role === "user" ? "You" : "Autodekt"}</span>
        <div className="message-parts">
          {visibleParts.map((part, index) => (
            <Part
              key={part.type === "tool-call" ? part.id : `${part.type}-${index}`}
              part={part}
              parts={message.parts}
              streaming={streaming}
            />
          ))}
          {streaming && <span className="streaming-caret message-caret" aria-hidden="true" />}
        </div>
        {!streaming && message.role === "assistant" && (
          <div className="message-actions">
            <button
              type="button"
              onClick={() => void copy()}
              aria-label="Copy response"
              title="Copy response"
            >
              {copied ? "✓ Copied" : "▢ Copy"}
            </button>
            {canRetry && (
              <button
                type="button"
                onClick={onRetry}
                aria-label="Regenerate response"
                title="Regenerate response"
              >
                ↻ Retry
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
