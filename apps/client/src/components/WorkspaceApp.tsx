import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { AuthLoading, Authenticated, Unauthenticated, useMutation, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Folder,
  Menu,
  MoreHorizontal,
  Pin,
  Plus,
  Settings,
} from "lucide-react";
import { api } from "@autodekt/backend/api";
import type { Doc, Id } from "@autodekt/backend/data-model";
import { authClient } from "../lib/auth-client";
import { readWorkspacePreferences } from "../lib/app-preferences";
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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return <ChevronRight className={expanded ? "expanded" : ""} aria-hidden="true" />;
}

function PinIcon({ filled = false }: { filled?: boolean }) {
  return <Pin className={filled ? "filled" : ""} aria-hidden="true" />;
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
              Math.max(8, Math.min(event.clientY, window.innerHeight - 205)),
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
                Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 205)),
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
              <Archive aria-hidden="true" />
            </button>
            <button
              type="button"
              title="More thread actions"
              aria-label={`More actions for ${thread.title}`}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                onOpenMenu(
                  thread,
                  Math.max(8, Math.min(bounds.right - 200, window.innerWidth - 210)),
                  Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 205)),
                );
              }}
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
      <button className="add-thread" onClick={onStart}>
        <Plus aria-hidden="true" /> New thread
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
  const updateDeck = useMutation(api.decks.update);
  const removeDeck = useMutation(api.decks.remove);
  const createThread = useMutation(api.threads.create);
  const renameThread = useMutation(api.threads.rename);
  const setThreadPinned = useMutation(api.threads.setPinned);
  const archiveThread = useMutation(api.threads.archive);
  const archiveAllThreads = useMutation(api.threads.archiveAllForDeck);
  const [deckId, setDeckId] = useState<Id<"decks"> | null>(null);
  const [threadId, setThreadId] = useState<Id<"threads"> | null>(null);
  const [creatingDeck, setCreatingDeck] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [createIntent, setCreateIntent] = useState<"blank" | "import">("blank");
  const [openImportDeckId, setOpenImportDeckId] = useState<Id<"decks"> | null>(null);
  const [initialWorkspacePreferences] = useState(readWorkspacePreferences);
  const [sidebarOpen, setSidebarOpen] = useState(initialWorkspacePreferences.sidebarOpen);
  const [chatSplit, setChatSplit] = useState(initialWorkspacePreferences.chatSplit);
  const [resizingWorkspace, setResizingWorkspace] = useState(false);
  const [deckPanelOpen, setDeckPanelOpen] = useState(false);
  const [deckEditorCollapsed, setDeckEditorCollapsed] = useState(
    !initialWorkspacePreferences.deckEditorOpen,
  );
  const [expandedDeckIds, setExpandedDeckIds] = useState<Set<string>>(() => new Set());
  const [threadMenu, setThreadMenu] = useState<{
    thread: Doc<"threads">;
    x: number;
    y: number;
  } | null>(null);
  const [deckMenu, setDeckMenu] = useState<{
    deck: Doc<"decks">;
    x: number;
    y: number;
  } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{
    target: { kind: "deck"; item: Doc<"decks"> } | { kind: "thread"; item: Doc<"threads"> };
    name: string;
  } | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [generatingTitleId, setGeneratingTitleId] = useState<Id<"threads"> | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const workspaceColumnsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!threadMenu && !deckMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".thread-context-menu")) return;
      setThreadMenu(null);
      setDeckMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setThreadMenu(null);
      setDeckMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [deckMenu, threadMenu]);

  useEffect(() => {
    if (!deckMenu && !threadMenu) return;
    contextMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [deckMenu, threadMenu]);

  useEffect(() => {
    if (!renameDialog) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingName) setRenameDialog(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [renameDialog, savingName]);

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
    if (createIntent === "import") setOpenImportDeckId(created.deckId);
    setDeckName("");
    setCreatingDeck(false);
  };

  const beginDeckCreation = (intent: "blank" | "import") => {
    setCreateIntent(intent);
    setCreatingDeck(true);
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

  const renameDeck = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameDialog) return;
    const name = renameDialog.name.trim();
    if (!name) return;
    const currentName =
      renameDialog.target.kind === "deck"
        ? renameDialog.target.item.name
        : renameDialog.target.item.title;
    if (name === currentName) {
      setRenameDialog(null);
      return;
    }
    setSavingName(true);
    try {
      if (renameDialog.target.kind === "deck") {
        await updateDeck({ deckId: renameDialog.target.item._id, name });
      } else {
        await renameThread({ threadId: renameDialog.target.item._id, title: name });
      }
      setRenameDialog(null);
    } finally {
      setSavingName(false);
    }
  };

  const archiveDeckThreads = async (targetDeck: Doc<"decks">) => {
    const confirmed = window.confirm(
      `Archive every thread in “${targetDeck.name}”? The project and its cards will be kept.`,
    );
    if (!confirmed) return;
    if (deckId === targetDeck._id) setThreadId(null);
    setDeckMenu(null);
    await archiveAllThreads({ deckId: targetDeck._id });
  };

  const deleteDeck = async (targetDeck: Doc<"decks">) => {
    const confirmed = window.confirm(
      `Delete “${targetDeck.name}” permanently? This removes its threads, messages, and cards and cannot be undone.`,
    );
    if (!confirmed) return;
    setDeckMenu(null);
    if (deckId === targetDeck._id) {
      setDeckId(decks?.find((item) => item._id !== targetDeck._id)?._id ?? null);
      setThreadId(null);
    }
    setExpandedDeckIds((current) => {
      const next = new Set(current);
      next.delete(String(targetDeck._id));
      return next;
    });
    await removeDeck({ deckId: targetDeck._id });
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
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="Hide sidebar"
            title="Hide sidebar"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
        </header>
        <button
          className="new-deck-button"
          onClick={() => (deckId ? void startThread(deckId) : beginDeckCreation("blank"))}
        >
          <Plus aria-hidden="true" /> {deckId ? "New thread" : "New deck"}
        </button>
        {creatingDeck && (
          <div className="inline-create">
            {createIntent === "import" && <p>Create a deck, then paste your decklist.</p>}
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
              onClick={() => beginDeckCreation("blank")}
              title="New deck"
              aria-label="New deck"
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
          {decks?.map((item) => (
            <div className="deck-nav-group" key={item._id}>
              <div
                className={`deck-folder-row ${item._id === deckId ? "active" : ""}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setThreadMenu(null);
                  setDeckMenu({
                    deck: item,
                    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 210)),
                    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 220)),
                  });
                }}
              >
                <button
                  type="button"
                  className="deck-folder-toggle"
                  aria-expanded={expandedDeckIds.has(String(item._id))}
                  onClick={() => toggleDeck(item._id)}
                  onKeyDown={(event) => {
                    if (!(event.shiftKey && event.key === "F10")) return;
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setThreadMenu(null);
                    setDeckMenu({
                      deck: item,
                      x: Math.max(8, Math.min(bounds.left + 24, window.innerWidth - 210)),
                      y: Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 220)),
                    });
                  }}
                  aria-haspopup="menu"
                >
                  <ChevronIcon expanded={expandedDeckIds.has(String(item._id))} />
                  <Folder aria-hidden="true" />
                  <span>{item.name}</span>
                </button>
                <button
                  type="button"
                  className="deck-folder-add"
                  title={`New thread in ${item.name}`}
                  aria-label={`New thread in ${item.name}`}
                  onClick={() => void startThread(item._id)}
                >
                  <Plus aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="deck-folder-add"
                  title={`More actions for ${item.name}`}
                  aria-label={`More actions for ${item.name}`}
                  onClick={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setThreadMenu(null);
                    setDeckMenu({
                      deck: item,
                      x: Math.max(8, Math.min(bounds.right - 200, window.innerWidth - 210)),
                      y: Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 220)),
                    });
                  }}
                >
                  <MoreHorizontal aria-hidden="true" />
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
                  onOpenMenu={(threadItem, x, y) => {
                    setDeckMenu(null);
                    setThreadMenu({ thread: threadItem, x, y });
                  }}
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
            <Settings aria-hidden="true" />
          </Link>
        </footer>
      </aside>
      {deckMenu && (
        <div
          className="thread-context-menu deck-context-menu"
          ref={contextMenuRef}
          role="menu"
          aria-label={`Actions for ${deckMenu.deck.name}`}
          style={{ left: deckMenu.x, top: deckMenu.y }}
        >
          <p>{deckMenu.deck.name}</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void startThread(deckMenu.deck._id);
              setDeckMenu(null);
            }}
          >
            New thread
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenameDialog({
                target: { kind: "deck", item: deckMenu.deck },
                name: deckMenu.deck.name,
              });
              setDeckMenu(null);
            }}
          >
            Rename project…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void archiveDeckThreads(deckMenu.deck)}
          >
            Archive all threads…
          </button>
          <div className="thread-context-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => void deleteDeck(deckMenu.deck)}
          >
            Delete project…
          </button>
        </div>
      )}
      {renameDialog && (
        <div
          className="rename-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingName) setRenameDialog(null);
          }}
        >
          <form
            className="rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-item-title"
            onSubmit={(event) => void renameDeck(event)}
          >
            <h2 id="rename-item-title">
              Rename {renameDialog.target.kind === "deck" ? "project" : "thread"}
            </h2>
            <label htmlFor="rename-item-name">
              {renameDialog.target.kind === "deck" ? "Project" : "Thread"} name
            </label>
            <input
              id="rename-item-name"
              autoFocus
              value={renameDialog.name}
              disabled={savingName}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) =>
                setRenameDialog((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
            />
            <div className="rename-dialog-actions">
              <button type="button" disabled={savingName} onClick={() => setRenameDialog(null)}>
                Cancel
              </button>
              <button type="submit" disabled={savingName || !renameDialog.name.trim()}>
                {savingName ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
      {threadMenu && (
        <div
          className="thread-context-menu"
          ref={contextMenuRef}
          role="menu"
          aria-label={`Actions for ${threadMenu.thread.title}`}
          style={{ left: threadMenu.x, top: threadMenu.y }}
        >
          <p>{threadMenu.thread.title}</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenameDialog({
                target: { kind: "thread", item: threadMenu.thread },
                name: threadMenu.thread.title,
              });
              setThreadMenu(null);
            }}
          >
            Rename thread…
          </button>
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
          <div className="thread-context-separator" role="separator" />
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
        <button
          className="open-sidebar"
          onClick={() => setSidebarOpen(true)}
          aria-label="Show sidebar"
          title="Show sidebar"
        >
          <Menu aria-hidden="true" />
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
            openImport={openImportDeckId === deck._id}
            onImportOpened={() => setOpenImportDeckId(null)}
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
          <p>Bring in a Commander list, validate it, and ask Autodekt to improve it.</p>
          {decks?.length === 0 && (
            <>
              <div className="onboarding-actions">
                <button className="primary-button" onClick={() => beginDeckCreation("import")}>
                  Import a decklist
                </button>
                <button className="onboarding-secondary" onClick={() => beginDeckCreation("blank")}>
                  Start with a blank deck
                </button>
              </div>
              <ol className="onboarding-steps" aria-label="Getting started">
                <li>
                  <b>1</b>
                  <span>
                    <strong>Add your list</strong>Paste an Arena or MTGO-style decklist.
                  </span>
                </li>
                <li>
                  <b>2</b>
                  <span>
                    <strong>Check legality</strong>Review count, color identity, singleton, and
                    Commander rules.
                  </span>
                </li>
                <li>
                  <b>3</b>
                  <span>
                    <strong>Ask for changes</strong>Research upgrades and inspect every edit in
                    History.
                  </span>
                </li>
              </ol>
            </>
          )}
        </section>
      )}
    </main>
  );
}
