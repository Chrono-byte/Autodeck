import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AuthLoading, Authenticated, Unauthenticated, useMutation, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { authClient } from "../lib/auth-client";
import { AuthScreen } from "./AuthScreen";
import { DeckChat } from "./DeckChat";
import { DeckEditor } from "./DeckEditor";

declare global {
  interface Window {
    autodektDesktop?: {
      onToggleSidebar(callback: () => void): () => void;
      setSidebarOpen(isOpen: boolean): void;
    };
  }
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.75 4.5c0-.97.78-1.75 1.75-1.75h2.2l1.35 1.5h5.45c.97 0 1.75.78 1.75 1.75v5.75c0 .83-.67 1.5-1.5 1.5H3.25c-.83 0-1.5-.67-1.5-1.5V4.5Z" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className={expanded ? "expanded" : ""} viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

function PinIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg className={filled ? "filled" : ""} viewBox="0 0 16 16" aria-hidden="true">
      <path d="m5.1 2.25 5.65 5.65-1.7.35-1.8 1.8.5 2.2-.7.7-4-4 .7-.7 2.2.5 1.8-1.8.35-1.7L5.1 2.25ZM3.9 12.1l-1.65 1.65" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.25 4.5h11.5v8.25c0 .55-.45 1-1 1h-9.5c-.55 0-1-.45-1-1V4.5Zm-.5-2.25h12.5v2.5H1.75v-2.5ZM6 7.25h4" />
    </svg>
  );
}

function SidebarThreadList({
  deckId,
  activeThreadId,
  generatingTitleId,
  onSelect,
  onStart,
  onSetPinned,
  onArchive,
  onOpenMenu,
}: {
  deckId: Id<"decks">;
  activeThreadId: Id<"threads"> | null;
  generatingTitleId: Id<"threads"> | null;
  onSelect: (threadId: Id<"threads">) => void;
  onStart: () => void;
  onSetPinned: (thread: Doc<"threads">) => void;
  onArchive: (threadId: Id<"threads">) => void;
  onOpenMenu: (thread: Doc<"threads">, x: number, y: number) => void;
}) {
  const threads = useQuery(api.threads.listByDeck, { deckId });
  return (
    <div className="thread-nav">
      {threads?.map((thread) => (
        <div
          className={`thread-nav-row ${thread._id === activeThreadId ? "active" : ""}`}
          key={thread._id}
          onContextMenu={(event) => {
            event.preventDefault();
            onOpenMenu(
              thread,
              Math.max(8, Math.min(event.clientX, window.innerWidth - 210)),
              Math.max(8, Math.min(event.clientY, window.innerHeight - 190)),
            );
          }}
        >
          <button
            type="button"
            className="thread-nav-main"
            title={thread.title}
            onClick={() => onSelect(thread._id)}
            onKeyDown={(event) => {
              if (!(event.shiftKey && event.key === "F10")) return;
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              onOpenMenu(
                thread,
                Math.max(8, Math.min(bounds.left + 24, window.innerWidth - 210)),
                Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 190)),
              );
            }}
            aria-haspopup="menu"
          >
            {thread.pinned && <PinIcon filled />}
            <span>{thread.title}</span>
          </button>
          <div className="thread-nav-actions">
            <button
              type="button"
              className={thread.pinned ? "active" : ""}
              title={thread.pinned ? "Unpin thread" : "Pin thread"}
              aria-label={thread.pinned ? "Unpin thread" : "Pin thread"}
              onClick={() => onSetPinned(thread)}
            >
              <PinIcon filled={thread.pinned} />
            </button>
            <button
              type="button"
              title="Archive thread"
              aria-label="Archive thread"
              disabled={generatingTitleId === thread._id}
              onClick={() => onArchive(thread._id)}
            >
              <ArchiveIcon />
            </button>
          </div>
        </div>
      ))}
      <button className="add-thread" onClick={onStart}>
        <PlusIcon /> New thread
      </button>
    </div>
  );
}

export function WorkspaceApp() {
  return (
    <>
      <AuthLoading>
        <main className="loading-screen">
          <div className="brand-mark">A</div>
          <p>Opening your workspace…</p>
        </main>
      </AuthLoading>
      <Unauthenticated>
        <AuthScreen />
      </Unauthenticated>
      <Authenticated>
        <AuthenticatedWorkspace />
      </Authenticated>
    </>
  );
}

function AuthenticatedWorkspace() {
  const decks = useQuery(api.decks.list);
  const user = useQuery(api.auth.getCurrentUser);
  const createDeck = useMutation(api.decks.create);
  const createThread = useMutation(api.threads.create);
  const setThreadPinned = useMutation(api.threads.setPinned);
  const archiveThread = useMutation(api.threads.archive);
  const [deckId, setDeckId] = useState<Id<"decks"> | null>(null);
  const [threadId, setThreadId] = useState<Id<"threads"> | null>(null);
  const [creatingDeck, setCreatingDeck] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatSplit, setChatSplit] = useState(42);
  const [resizingWorkspace, setResizingWorkspace] = useState(false);
  const [deckPanelOpen, setDeckPanelOpen] = useState(false);
  const [deckEditorCollapsed, setDeckEditorCollapsed] = useState(false);
  const [expandedDeckIds, setExpandedDeckIds] = useState<Set<string>>(() => new Set());
  const [threadMenu, setThreadMenu] = useState<{
    thread: Doc<"threads">;
    x: number;
    y: number;
  } | null>(null);
  const [generatingTitleId, setGeneratingTitleId] = useState<Id<"threads"> | null>(null);
  const workspaceColumnsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!threadMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".thread-context-menu")) return;
      setThreadMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setThreadMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [threadMenu]);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("autodekt:workspace-chat-split"));
    if (Number.isFinite(saved) && saved >= 20 && saved <= 80) setChatSplit(saved);
    setSidebarOpen(window.localStorage.getItem("autodekt:sidebar-open") !== "false");
    setDeckEditorCollapsed(
      window.localStorage.getItem("autodekt:deck-editor-collapsed") === "true",
    );
  }, []);

  useEffect(() => {
    const toggleSidebar = () => setSidebarOpen((current) => !current);
    return window.autodektDesktop?.onToggleSidebar(toggleSidebar);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("autodekt:sidebar-open", String(sidebarOpen));
    window.autodektDesktop?.setSidebarOpen(sidebarOpen);
  }, [sidebarOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.localStorage.setItem("autodekt:workspace-chat-split", String(chatSplit));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [chatSplit]);

  useEffect(() => {
    if (!deckId && decks?.length) {
      setDeckId(decks[0]._id);
      setExpandedDeckIds((current) => new Set(current).add(String(decks[0]._id)));
    }
  }, [deckId, decks]);

  const threads = useQuery(api.threads.listByDeck, deckId ? { deckId } : "skip");
  const cards = useQuery(api.deckCards.list, deckId ? { deckId } : "skip");
  const deck = decks?.find((item) => item._id === deckId);

  useEffect(() => {
    if (!threadId && threads?.length) setThreadId(threads[0]._id);
    if (threadId && threads && !threads.some((thread) => thread._id === threadId))
      setThreadId(threads[0]?._id ?? null);
  }, [threadId, threads]);

  const thread = threads?.find((item) => item._id === threadId);

  const addDeck = async () => {
    if (!deckName.trim()) return;
    const created = await createDeck({ name: deckName.trim() });
    setDeckId(created.deckId);
    setThreadId(created.threadId);
    setExpandedDeckIds((current) => new Set(current).add(String(created.deckId)));
    setDeckName("");
    setCreatingDeck(false);
  };

  const toggleDeck = (nextDeckId: Id<"decks">) => {
    const key = String(nextDeckId);
    setExpandedDeckIds((current) => {
      const next = new Set(current);
      if (next.has(key) && deckId === nextDeckId) next.delete(key);
      else next.add(key);
      return next;
    });
    if (deckId !== nextDeckId) {
      setDeckId(nextDeckId);
      setThreadId(null);
    }
  };

  const startThread = async (nextDeckId: Id<"decks">) => {
    const created = await createThread({ deckId: nextDeckId });
    setExpandedDeckIds((current) => new Set(current).add(String(nextDeckId)));
    setDeckId(nextDeckId);
    setThreadId(created);
  };

  const resizeWorkspace = (clientX: number) => {
    const container = workspaceColumnsRef.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const usableWidth = bounds.width - 7;
    if (usableWidth <= 0) return;
    const minimumChat = Math.max(25, (360 / usableWidth) * 100);
    const maximumChat = Math.min(75, 100 - (420 / usableWidth) * 100);
    const rawSplit = ((clientX - bounds.left) / usableWidth) * 100;
    const nextSplit =
      minimumChat <= maximumChat ? Math.min(maximumChat, Math.max(minimumChat, rawSplit)) : 50;
    setChatSplit(Math.round(nextSplit * 10) / 10);
  };

  const regenerateThreadTitle = async (targetThreadId: Id<"threads">) => {
    setGeneratingTitleId(targetThreadId);
    try {
      const { data, error } = await authClient.convex.token();
      if (error || !data?.token) return;
      await fetch("/api/thread-title", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ threadId: targetThreadId, force: true }),
      });
    } catch {
      // Keep the existing title when the configured generation model is unavailable.
    } finally {
      setGeneratingTitleId(null);
      setThreadMenu(null);
    }
  };

  const splitStyle: CSSProperties & Record<`--${string}`, string> = {
    "--chat-share": `${chatSplit}fr`,
    "--deck-share": `${100 - chatSplit}fr`,
  };

  return (
    <main
      className={`workspace-app ${sidebarOpen ? "" : "sidebar-collapsed"} ${deckPanelOpen ? "deck-panel-open" : ""}`}
    >
      <aside className="app-sidebar">
        <header className="sidebar-brand">
          <div className="brand-mark">A</div>
          <strong>Autodekt</strong>
          <button onClick={() => setSidebarOpen(false)}>‹</button>
        </header>
        <button
          className="new-deck-button"
          onClick={() => (deckId ? void startThread(deckId) : setCreatingDeck(true))}
        >
          <PlusIcon /> {deckId ? "New thread" : "New deck"}
        </button>
        {creatingDeck && (
          <div className="inline-create">
            <input
              autoFocus
              value={deckName}
              onChange={(e) => setDeckName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addDeck();
              }}
              placeholder="Deck name"
            />
            <button onClick={() => void addDeck()}>Create</button>
          </div>
        )}
        <nav className="deck-nav">
          <div className="sidebar-section-heading">
            <p className="nav-label">DECKS</p>
            <button
              type="button"
              onClick={() => setCreatingDeck(true)}
              title="New deck"
              aria-label="New deck"
            >
              <PlusIcon />
            </button>
          </div>
          {decks?.map((item) => (
            <div className="deck-nav-group" key={item._id}>
              <div className={`deck-folder-row ${item._id === deckId ? "active" : ""}`}>
                <button
                  type="button"
                  className="deck-folder-toggle"
                  aria-expanded={expandedDeckIds.has(String(item._id))}
                  onClick={() => toggleDeck(item._id)}
                >
                  <ChevronIcon expanded={expandedDeckIds.has(String(item._id))} />
                  <FolderIcon />
                  <span>{item.name}</span>
                </button>
                <button
                  type="button"
                  className="deck-folder-add"
                  title={`New thread in ${item.name}`}
                  aria-label={`New thread in ${item.name}`}
                  onClick={() => void startThread(item._id)}
                >
                  <PlusIcon />
                </button>
              </div>
              {expandedDeckIds.has(String(item._id)) && (
                <SidebarThreadList
                  deckId={item._id}
                  activeThreadId={threadId}
                  generatingTitleId={generatingTitleId}
                  onSelect={(nextThreadId) => {
                    setDeckId(item._id);
                    setThreadId(nextThreadId);
                  }}
                  onStart={() => void startThread(item._id)}
                  onSetPinned={(threadItem) =>
                    void setThreadPinned({
                      threadId: threadItem._id,
                      pinned: !threadItem.pinned,
                    })
                  }
                  onArchive={(nextThreadId) => {
                    if (threadId === nextThreadId) setThreadId(null);
                    void archiveThread({ threadId: nextThreadId });
                  }}
                  onOpenMenu={(threadItem, x, y) => setThreadMenu({ thread: threadItem, x, y })}
                />
              )}
            </div>
          ))}
          {decks?.length === 0 && <p className="sidebar-empty">Create a deck to begin.</p>}
        </nav>
        <footer className="sidebar-user">
          <Link to="/settings" className="sidebar-account-link" title="Account settings">
            <div>{user?.name?.slice(0, 1).toUpperCase() ?? "U"}</div>
            <span>
              <strong>{user?.name ?? "Brewer"}</strong>
              <small>{user?.email}</small>
            </span>
            <b aria-hidden="true">⚙</b>
          </Link>
        </footer>
      </aside>
      {threadMenu && (
        <div
          className="thread-context-menu"
          role="menu"
          aria-label={`Actions for ${threadMenu.thread.title}`}
          style={{ left: threadMenu.x, top: threadMenu.y }}
        >
          <p>{threadMenu.thread.title}</p>
          <button
            type="button"
            role="menuitem"
            disabled={generatingTitleId === threadMenu.thread._id}
            onClick={() => void regenerateThreadTitle(threadMenu.thread._id)}
          >
            {generatingTitleId === threadMenu.thread._id ? "Generating title…" : "Regenerate title"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void setThreadPinned({
                threadId: threadMenu.thread._id,
                pinned: threadMenu.thread.pinned !== true,
              });
              setThreadMenu(null);
            }}
          >
            {threadMenu.thread.pinned ? "Unpin thread" : "Pin thread"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void startThread(threadMenu.thread.deckId);
              setThreadMenu(null);
            }}
          >
            New thread in deck
          </button>
          <div className="thread-context-separator" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              if (threadId === threadMenu.thread._id) setThreadId(null);
              void archiveThread({ threadId: threadMenu.thread._id });
              setThreadMenu(null);
            }}
          >
            Archive thread
          </button>
        </div>
      )}
      {!sidebarOpen && (
        <button className="open-sidebar" onClick={() => setSidebarOpen(true)}>
          ☰
        </button>
      )}
      {deck && thread && cards ? (
        <div
          className={`workspace-columns ${resizingWorkspace ? "resizing" : ""} ${deckEditorCollapsed ? "deck-collapsed" : ""}`}
          ref={workspaceColumnsRef}
          style={splitStyle}
        >
          <DeckChat
            key={thread._id}
            deck={deck}
            thread={thread}
            onOpenDeck={() => {
              setDeckEditorCollapsed(false);
              window.localStorage.setItem("autodekt:deck-editor-collapsed", "false");
              setDeckPanelOpen(true);
            }}
          />
          <div
            className="workspace-resizer"
            role="separator"
            aria-label="Resize chat and deck panes"
            aria-orientation="vertical"
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(chatSplit)}
            tabIndex={0}
            title="Drag to resize · Double-click to reset"
            onDoubleClick={() => setChatSplit(42)}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizingWorkspace(true);
              resizeWorkspace(event.clientX);
            }}
            onPointerMove={(event) => {
              if (resizingWorkspace) resizeWorkspace(event.clientX);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              setResizingWorkspace(false);
            }}
            onPointerCancel={() => setResizingWorkspace(false)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const amount = event.shiftKey ? 5 : 2;
              setChatSplit((current) =>
                Math.min(
                  75,
                  Math.max(25, current + (event.key === "ArrowRight" ? amount : -amount)),
                ),
              );
            }}
          >
            <span aria-hidden="true" />
          </div>
          <DeckEditor
            deck={deck}
            thread={thread}
            cards={cards}
            onClose={() => {
              setDeckEditorCollapsed(true);
              window.localStorage.setItem("autodekt:deck-editor-collapsed", "true");
              setDeckPanelOpen(false);
            }}
          />
        </div>
      ) : (
        <section className="workspace-empty">
          <div className="empty-orbit">A</div>
          <h1>{decks === undefined ? "Loading decks…" : "No decks yet"}</h1>
          <p>Create a deck to start building and discussing a list.</p>
          {decks?.length === 0 && (
            <button className="primary-button" onClick={() => setCreatingDeck(true)}>
              Create your first deck
            </button>
          )}
        </section>
      )}
    </main>
  );
}
