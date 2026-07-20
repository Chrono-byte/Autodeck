import { useEffect, useState } from "react";
import { AuthLoading, Authenticated, Unauthenticated, useMutation, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, MonitorCog, Moon, Sun } from "lucide-react";
import { api } from "@autodekt/backend/api";
import { authClient } from "../lib/auth-client";
import {
  connectOpenAICodex,
  disconnectOpenAICodex,
  useOpenAICodexStatus,
} from "../lib/openai-codex-client";
import { clearPersistentChats } from "../lib/persistent-chat-client";
import {
  DEFAULT_APP_PREFERENCES,
  DEFAULT_WORKSPACE_PREFERENCES,
  readAppPreferences,
  readWorkspacePreferences,
  saveAppPreferences,
  saveWorkspacePreferences,
  type AppAccent,
  type AppPreferences,
  type AppTheme,
  type InterfaceDensity,
  type InterfaceScale,
  type WorkspacePreferences,
} from "../lib/app-preferences";
import { AuthScreen } from "./AuthScreen";

const settingsSections = [
  "account",
  "appearance",
  "workspace",
  "generation",
  "connections",
] as const;

export function AccountSettings() {
  return (
    <>
      <AuthLoading>
        <main className="loading-screen">
          <div className="brand-mark">A</div>
          <p>Opening account settings…</p>
        </main>
      </AuthLoading>
      <Unauthenticated>
        <AuthScreen />
      </Unauthenticated>
      <Authenticated>
        <SettingsPage />
      </Authenticated>
    </>
  );
}

function SettingsPage() {
  const user = useQuery(api.auth.getCurrentUser);
  const [activeSection, setActiveSection] = useState<(typeof settingsSections)[number]>("account");

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".settings-page");
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
        if (
          visible?.target.id &&
          settingsSections.includes(visible.target.id as (typeof settingsSections)[number])
        ) {
          setActiveSection(visible.target.id as (typeof settingsSections)[number]);
        }
      },
      { root, rootMargin: "-72px 0px -55%", threshold: [0, 0.2, 0.8] },
    );
    for (const section of settingsSections) {
      const element = document.getElementById(section);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <main className="settings-page">
      <header className="settings-header">
        <Link to="/" className="settings-back">
          <ArrowLeft aria-hidden="true" /> Back to workspace
        </Link>
        <div className="settings-brand">
          <div className="brand-mark">A</div>
          <strong>Autodekt</strong>
        </div>
      </header>
      <div className="settings-shell">
        <aside className="settings-nav">
          <p className="eyebrow">SETTINGS</p>
          {settingsSections.map((section) => (
            <a
              href={`#${section}`}
              className={activeSection === section ? "active" : ""}
              key={section}
              onClick={() => setActiveSection(section)}
            >
              {section[0].toUpperCase() + section.slice(1)}
            </a>
          ))}
        </aside>
        <section className="settings-content">
          <div className="settings-title">
            <p className="eyebrow">YOUR AUTODEKT</p>
            <h1>Account settings</h1>
            <p>Shape the workspace, generation defaults, connections, and account access.</p>
          </div>

          <section className="settings-section" id="account">
            <div className="settings-section-heading">
              <h2>Profile</h2>
              <p>Your identity in this workspace.</p>
            </div>
            <div className="settings-card profile-settings-card">
              <div className="settings-avatar">{user?.name?.slice(0, 1).toUpperCase() ?? "U"}</div>
              <div>
                <strong>{user?.name ?? "Brewer"}</strong>
                <span>{user?.email}</span>
              </div>
              <button
                type="button"
                className="danger-text-button"
                onClick={() => {
                  clearPersistentChats();
                  void authClient.signOut();
                }}
              >
                Sign out
              </button>
            </div>
          </section>

          <section className="settings-section" id="appearance">
            <div className="settings-section-heading">
              <h2>Appearance</h2>
              <p>Choose how Autodekt looks and feels on this device.</p>
            </div>
            <AppearanceSettings />
          </section>

          <section className="settings-section" id="workspace">
            <div className="settings-section-heading">
              <h2>Workspace</h2>
              <p>Set the layout Autodekt restores when you open a deck.</p>
            </div>
            <WorkspaceSettings />
          </section>

          <section className="settings-section" id="generation">
            <div className="settings-section-heading">
              <h2>Text generation</h2>
              <p>Choose the fast model used for automatic conversation titles.</p>
            </div>
            <TitleGenerationSettings />
          </section>

          <section className="settings-section" id="connections">
            <div className="settings-section-heading">
              <h2>Connections</h2>
              <p>Connect external model providers available in the composer.</p>
            </div>
            <CodexConnection />
          </section>
        </section>
      </div>
    </main>
  );
}

const themeChoices: ReadonlyArray<{ value: AppTheme; label: string; detail: string }> = [
  { value: "system", label: "System", detail: "Follow Windows" },
  { value: "light", label: "Light", detail: "Bright canvas" },
  { value: "dark", label: "Dark", detail: "Low-light workspace" },
];

function ThemePreview({ theme }: { theme: AppTheme }) {
  const Icon = theme === "system" ? MonitorCog : theme === "light" ? Sun : Moon;
  return (
    <span className={`theme-preview theme-preview-${theme}`} aria-hidden="true">
      <Icon />
    </span>
  );
}

const accentChoices: ReadonlyArray<{ value: AppAccent; label: string }> = [
  { value: "forest", label: "Forest" },
  { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" },
  { value: "ember", label: "Ember" },
];

function AppearanceSettings() {
  const [preferences, setPreferences] = useState<AppPreferences>(readAppPreferences);

  const update = (change: Partial<AppPreferences>) => {
    setPreferences((current) => saveAppPreferences({ ...current, ...change }));
  };

  return (
    <div className="settings-card preference-settings-card">
      <div className="preference-block">
        <div className="preference-copy">
          <strong>Theme</strong>
          <span>Follow your system or keep this app in one mode.</span>
        </div>
        <div className="theme-choice-grid" role="radiogroup" aria-label="Application theme">
          {themeChoices.map((choice) => (
            <label
              className={preferences.theme === choice.value ? "selected" : ""}
              key={choice.value}
            >
              <input
                type="radio"
                name="app-theme"
                value={choice.value}
                data-testid={`theme-${choice.value}`}
                checked={preferences.theme === choice.value}
                onChange={() => update({ theme: choice.value })}
              />
              <ThemePreview theme={choice.value} />
              <strong>{choice.label}</strong>
              <small>{choice.detail}</small>
            </label>
          ))}
        </div>
      </div>

      <div className="preference-row">
        <div className="preference-copy">
          <strong>Accent color</strong>
          <span>Used for focus, primary actions, and active controls.</span>
        </div>
        <div className="accent-choices" role="radiogroup" aria-label="Accent color">
          {accentChoices.map((choice) => (
            <label
              className={`accent-${choice.value} ${preferences.accent === choice.value ? "selected" : ""}`}
              title={choice.label}
              key={choice.value}
            >
              <input
                type="radio"
                name="app-accent"
                value={choice.value}
                data-testid={`accent-${choice.value}`}
                checked={preferences.accent === choice.value}
                onChange={() => update({ accent: choice.value })}
              />
              <span aria-hidden="true" />
              <span className="sr-only">{choice.label}</span>
            </label>
          ))}
        </div>
      </div>

      <label className="preference-row">
        <span className="preference-copy">
          <strong>Interface density</strong>
          <span>Compact mode fits more decks and messages on screen.</span>
        </span>
        <select
          data-testid="interface-density"
          value={preferences.density}
          onChange={(event) => update({ density: event.target.value as InterfaceDensity })}
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>

      <label className="preference-row">
        <span className="preference-copy">
          <strong>Interface scale</strong>
          <span>Adjust text and controls throughout the application.</span>
        </span>
        <select
          data-testid="interface-scale"
          value={preferences.scale}
          onChange={(event) => update({ scale: event.target.value as InterfaceScale })}
        >
          <option value="small">Small · 90%</option>
          <option value="default">Default · 100%</option>
          <option value="large">Large · 112%</option>
        </select>
      </label>

      <label className="preference-row preference-toggle-row">
        <span className="preference-copy">
          <strong>Reduce motion</strong>
          <span>Minimize transitions and animated status indicators.</span>
        </span>
        <input
          type="checkbox"
          data-testid="reduce-motion"
          checked={preferences.reduceMotion}
          onChange={(event) => update({ reduceMotion: event.target.checked })}
        />
      </label>

      <div className="settings-card-footer">
        <span>Appearance preferences are stored on this device.</span>
        <button
          type="button"
          className="secondary-settings-button"
          onClick={() => setPreferences(saveAppPreferences(DEFAULT_APP_PREFERENCES))}
        >
          Reset appearance
        </button>
      </div>
    </div>
  );
}

function WorkspaceSettings() {
  const [preferences, setPreferences] = useState<WorkspacePreferences>(readWorkspacePreferences);

  const update = (change: Partial<WorkspacePreferences>) => {
    setPreferences((current) => saveWorkspacePreferences({ ...current, ...change }));
  };

  return (
    <div className="settings-card preference-settings-card">
      <label className="preference-row preference-toggle-row">
        <span className="preference-copy">
          <strong>Open the sidebar</strong>
          <span>Show decks and threads when the workspace opens.</span>
        </span>
        <input
          type="checkbox"
          data-testid="workspace-sidebar"
          checked={preferences.sidebarOpen}
          onChange={(event) => update({ sidebarOpen: event.target.checked })}
        />
      </label>

      <label className="preference-row preference-toggle-row">
        <span className="preference-copy">
          <strong>Open the deck editor</strong>
          <span>Restore the deck pane beside chat when a deck opens.</span>
        </span>
        <input
          type="checkbox"
          data-testid="workspace-deck-editor"
          checked={preferences.deckEditorOpen}
          onChange={(event) => update({ deckEditorOpen: event.target.checked })}
        />
      </label>

      <label className="preference-row split-preference-row">
        <span className="preference-copy">
          <strong>Default pane balance</strong>
          <span>Choose how much horizontal space chat receives.</span>
        </span>
        <span className="range-control">
          <input
            type="range"
            data-testid="workspace-chat-split"
            min="25"
            max="75"
            step="1"
            value={preferences.chatSplit}
            onChange={(event) => update({ chatSplit: Number(event.target.value) })}
          />
          <output>{preferences.chatSplit}% chat</output>
        </span>
      </label>

      <div className="settings-card-footer">
        <span>Layout changes apply when you return to the workspace.</span>
        <button
          type="button"
          className="secondary-settings-button"
          onClick={() => setPreferences(saveWorkspacePreferences(DEFAULT_WORKSPACE_PREFERENCES))}
        >
          Reset layout
        </button>
      </div>
    </div>
  );
}

function TitleGenerationSettings() {
  const preferences = useQuery(api.chatPreferences.get);
  const { status: codexStatus } = useOpenAICodexStatus();
  const saveTitleModel = useMutation(api.chatPreferences.saveTitleModel);
  const selected = preferences?.titleModel ?? "gpt-5.4-mini";
  const isLocal = selected === "local" || selected.startsWith("local:");
  const [localModel, setLocalModel] = useState("");

  useEffect(() => {
    if (selected.startsWith("local:")) setLocalModel(selected.slice("local:".length));
  }, [selected]);

  const saveLocalModel = (value: string) => {
    const normalized = value.trim();
    void saveTitleModel({ titleModel: normalized ? `local:${normalized}` : "local" });
  };

  return (
    <div className="settings-card generation-settings-card">
      <label>
        Title model
        <select
          value={isLocal ? "local" : selected}
          disabled={preferences === undefined}
          onChange={(event) => {
            const value = event.target.value;
            void saveTitleModel({
              titleModel:
                value === "local" && localModel.trim() ? `local:${localModel.trim()}` : value,
            });
          }}
        >
          <option value="gpt-5.4-mini">GPT-5.4 Mini</option>
          <option value="gpt-5.3-codex-spark">GPT-5.3 Codex Spark</option>
          <option value="local">LM Studio</option>
        </select>
      </label>
      {isLocal && (
        <label>
          LM Studio model identifier
          <input
            value={localModel}
            onChange={(event) => setLocalModel(event.target.value)}
            onBlur={(event) => saveLocalModel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            placeholder="Uses LM_STUDIO_TEXT_MODEL when blank"
          />
        </label>
      )}
      <p>
        New threads are titled after the first message. If Codex is unavailable, Autodekt falls back
        to LM Studio. {codexStatus?.connected ? "Codex is connected." : "Codex is not connected."}
      </p>
    </div>
  );
}

function CodexConnection() {
  const { status, refresh } = useOpenAICodexStatus();
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      await connectOpenAICodex((event) => {
        if (event.type !== "device_code") return;
        setDeviceCode(event.userCode);
        setVerificationUri(event.verificationUri);
        window.open(event.verificationUri, "_blank", "noopener,noreferrer");
      });
      setDeviceCode(null);
      setVerificationUri(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect OpenAI Codex.");
    } finally {
      setBusy(false);
    }
  };

  const connected = status?.connected === true;

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      await disconnectOpenAICodex();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to disconnect OpenAI Codex.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`settings-card connection-settings-card ${connected ? "connected" : ""}`}>
      <div className="connection-provider-mark" aria-hidden="true">
        AI
      </div>
      <div className="connection-copy">
        <div className="connection-title-row">
          <strong>OpenAI Codex</strong>
          <span className="connection-status">
            <i /> {connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <p>
          Use your ChatGPT Plus or Pro account to access Codex models from the Autodekt composer.
        </p>
        {deviceCode && (
          <div className="settings-device-code">
            <span>Enter this code at OpenAI</span>
            <strong>{deviceCode}</strong>
            {verificationUri && (
              <a href={verificationUri} target="_blank" rel="noreferrer">
                Open OpenAI <ExternalLink aria-hidden="true" />
              </a>
            )}
          </div>
        )}
        {error && (
          <p className="settings-connection-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {connected ? (
        <button
          type="button"
          className="secondary-settings-button"
          disabled={busy}
          onClick={() => void disconnect()}
        >
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          className="primary-settings-button"
          disabled={busy}
          onClick={() => void connect()}
        >
          {busy ? "Waiting for OpenAI…" : "Connect"}
        </button>
      )}
    </div>
  );
}
