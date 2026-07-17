import { useEffect, useState } from "react";
import {
  AuthLoading,
  Authenticated,
  Unauthenticated,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authClient } from "../lib/auth-client";
import { AuthScreen } from "./AuthScreen";
import { DeckChat } from "./DeckChat";
import { DeckEditor } from "./DeckEditor";

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
  const [deckId, setDeckId] = useState<Id<"decks"> | null>(null);
  const [threadId, setThreadId] = useState<Id<"threads"> | null>(null);
  const [creatingDeck, setCreatingDeck] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!deckId && decks?.length) setDeckId(decks[0]._id);
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
    setDeckName("");
    setCreatingDeck(false);
  };

  return (
    <main className={`workspace-app ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <aside className="app-sidebar">
        <header className="sidebar-brand">
          <div className="brand-mark">A</div>
          <strong>Autodekt</strong>
          <button onClick={() => setSidebarOpen(false)}>‹</button>
        </header>
        <button className="new-deck-button" onClick={() => setCreatingDeck(true)}>
          ＋ New deck
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
          <p className="nav-label">DECKS</p>
          {decks?.map((item) => (
            <div className="deck-nav-group" key={item._id}>
              <button
                className={`deck-nav-item ${item._id === deckId ? "active" : ""}`}
                onClick={() => {
                  setDeckId(item._id);
                  setThreadId(null);
                }}
              >
                <span className="deck-glyph">♢</span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.commanderName ?? "Commander deck"}</small>
                </span>
              </button>
              {item._id === deckId && (
                <div className="thread-nav">
                  {threads?.map((threadItem) => (
                    <button
                      className={threadItem._id === threadId ? "active" : ""}
                      key={threadItem._id}
                      onClick={() => setThreadId(threadItem._id)}
                    >
                      ↳ {threadItem.title}
                    </button>
                  ))}
                  <button
                    className="add-thread"
                    onClick={async () => setThreadId(await createThread({ deckId: item._id }))}
                  >
                    ＋ New thread
                  </button>
                </div>
              )}
            </div>
          ))}
          {decks?.length === 0 && <p className="sidebar-empty">Create a deck to begin.</p>}
        </nav>
        <CodexConnection />
        <footer className="sidebar-user">
          <div>{user?.name?.slice(0, 1).toUpperCase() ?? "U"}</div>
          <span>
            <strong>{user?.name ?? "Brewer"}</strong>
            <small>{user?.email}</small>
          </span>
          <button onClick={() => void authClient.signOut()}>↪</button>
        </footer>
      </aside>
      {!sidebarOpen && (
        <button className="open-sidebar" onClick={() => setSidebarOpen(true)}>
          ☰
        </button>
      )}
      {deck && thread && cards ? (
        <div className="workspace-columns">
          <DeckChat key={thread._id} deck={deck} thread={thread} cards={cards} />
          <DeckEditor deck={deck} thread={thread} cards={cards} />
        </div>
      ) : (
        <section className="workspace-empty">
          <div className="empty-orbit">A</div>
          <h1>{decks === undefined ? "Loading your decks…" : "Start a new Commander deck"}</h1>
          <p>Each deck gets its own conversations and one shared, live card list.</p>
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

function CodexConnection() {
  const status = useQuery(api.openaiCodex.status);
  const startDeviceAuth = useAction(api.openaiCodex.startDeviceAuth);
  const pollDeviceAuth = useAction(api.openaiCodex.pollDeviceAuth);
  const disconnect = useMutation(api.openaiCodex.disconnect);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const device = await startDeviceAuth();
      setDeviceCode(device.userCode);
      setVerificationUri(device.verificationUri);
      window.open(device.verificationUri, "_blank", "noopener,noreferrer");
      const deadline = Date.now() + device.expiresInSeconds * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, device.intervalSeconds * 1000));
        const result = await pollDeviceAuth({
          deviceAuthId: device.deviceAuthId,
          userCode: device.userCode,
        });
        if (result.status === "connected") {
          setDeviceCode(null);
          setVerificationUri(null);
          return;
        }
      }
      throw new Error("The OpenAI device code expired. Start the connection again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect OpenAI Codex.");
    } finally {
      setBusy(false);
    }
  };

  if (status?.connected) {
    return (
      <section className="codex-connection connected">
        <div>
          <span className="connection-dot" />
          <span>
            <strong>OpenAI Codex</strong>
            <small>GPT-5.6 Sol connected</small>
          </span>
        </div>
        <button onClick={() => void disconnect()}>Disconnect</button>
      </section>
    );
  }

  return (
    <section className="codex-connection">
      <div>
        <span className="connection-dot" />
        <span>
          <strong>OpenAI Codex</strong>
          <small>Use ChatGPT Plus or Pro</small>
        </span>
      </div>
      {deviceCode && (
        <div className="device-code">
          <small>Enter this code at OpenAI</small>
          <strong>{deviceCode}</strong>
          {verificationUri && (
            <a href={verificationUri} target="_blank" rel="noreferrer">
              Open OpenAI ↗
            </a>
          )}
        </div>
      )}
      {error && <small className="connection-error">{error}</small>}
      <button disabled={busy} onClick={() => void connect()}>
        {busy ? "Waiting for OpenAI…" : "Connect"}
      </button>
    </section>
  );
}
