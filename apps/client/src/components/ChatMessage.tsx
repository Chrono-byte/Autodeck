import { useRef, useState, type ReactNode } from "react";
import type { MessagePart, ToolCallPart, ToolResultPart, UIMessage } from "@tanstack/ai";
import ReactMarkdown, { type Components } from "react-markdown";
import {
  BookOpenCheck,
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Copy,
  CornerDownRight,
  Diamond,
  Globe2,
  List,
  RotateCcw,
  Search,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import remarkGfm from "remark-gfm";
import { remarkManaSymbols } from "../lib/mana-markdown";
import { ManaSymbol } from "./ManaSymbol";

const TOOL_LABELS: Record<string, { active: string; complete: string; icon: LucideIcon }> = {
  get_card: { active: "Looking up card", complete: "Looked up card", icon: Diamond },
  search_cards: { active: "Searching cards", complete: "Searched cards", icon: Search },
  analyze_deck: {
    active: "Analyzing deck",
    complete: "Analyzed deck",
    icon: ChartNoAxesColumn,
  },
  comprehensive_rules: {
    active: "Checking rules",
    complete: "Checked rules",
    icon: BookOpenCheck,
  },
  brave_search: { active: "Researching the web", complete: "Researched the web", icon: Globe2 },
  get_active_deck: { active: "Reading deck", complete: "Read deck", icon: List },
  edit_active_deck: {
    active: "Updating deck",
    complete: "Updated deck",
    icon: WandSparkles,
  },
};

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
        <Sparkles className="reasoning-spark" aria-hidden="true" />
        <span>{streaming ? "Thinking" : "Reasoning"}</span>
        {streaming && <span className="reasoning-live">Live</span>}
        <ChevronDown className="disclosure-arrow" aria-hidden="true" />
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
  const ToolIcon = labels?.icon ?? CornerDownRight;
  const title = labels ? (active ? labels.active : labels.complete) : displayName(part.name);
  const input = safeJson(part.input ?? part.arguments);
  const output = contentOf(result) || safeJson(part.output);
  const error = result?.error;

  return (
    <details className={`tool-call ${active ? "active" : ""} ${failed ? "failed" : ""}`}>
      <summary>
        <ToolIcon className="tool-icon" aria-hidden="true" />
        <span className="tool-title">{failed ? `${title} failed` : title}</span>
        <span className="tool-state">
          {active ? (
            <span className="tool-spinner" />
          ) : failed ? (
            <CircleAlert aria-label="Failed" />
          ) : (
            <CircleCheck aria-label="Complete" />
          )}
        </span>
        <ChevronDown className="disclosure-arrow" aria-hidden="true" />
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
  retryModelLabel,
  retryModels,
  onRetryWith,
}: {
  message: UIMessage;
  streaming: boolean;
  canRetry: boolean;
  retryModelLabel: string;
  retryModels: Array<{ value: string; label: string; disabled?: boolean }>;
  onRetryWith: (model: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const retryMenuRef = useRef<HTMLDetailsElement>(null);
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
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
            {canRetry && (
              <details
                className="retry-model-selector"
                ref={retryMenuRef}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    event.currentTarget.removeAttribute("open");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.currentTarget.removeAttribute("open");
                    retryMenuRef.current?.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary aria-label={`Retry response with ${retryModelLabel}`}>
                  <RotateCcw aria-hidden="true" /> Retry with {retryModelLabel}
                  <ChevronDown className="selector-chevron" aria-hidden="true" />
                </summary>
                <div className="retry-model-menu" role="menu">
                  <p>Retry response with</p>
                  {retryModels.map((model) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={model.value}
                      disabled={model.disabled}
                      title={model.disabled ? "Connect OpenAI Codex to use this model" : undefined}
                      onClick={() => {
                        retryMenuRef.current?.removeAttribute("open");
                        onRetryWith(model.value);
                      }}
                    >
                      <span>{model.label}</span>
                      <span>{model.label === retryModelLabel && <Check aria-hidden="true" />}</span>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
