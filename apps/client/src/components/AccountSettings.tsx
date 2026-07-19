import { useEffect, useState } from "react";
import { AuthLoading, Authenticated, Unauthenticated, useMutation, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import { api } from "@autodekt/backend/api";
import { authClient } from "../lib/auth-client";
import {
  connectOpenAICodex,
  disconnectOpenAICodex,
  useOpenAICodexStatus,
} from "../lib/openai-codex-client";
import { clearPersistentChats } from "../lib/persistent-chat-client";
import { AuthScreen } from "./AuthScreen";

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

  return (
    <main className="settings-page">
      <header className="settings-header">
        <Link to="/" className="settings-back">
          ← Back to workspace
        </Link>
        <div className="settings-brand">
          <div className="brand-mark">A</div>
          <strong>Autodekt</strong>
        </div>
      </header>
      <div className="settings-shell">
        <aside className="settings-nav">
          <p className="eyebrow">SETTINGS</p>
          <a href="#account" className="active">
            Account
          </a>
          <a href="#generation">Generation</a>
          <a href="#connections">Connections</a>
        </aside>
        <section className="settings-content">
          <div className="settings-title">
            <p className="eyebrow">YOUR AUTODEKT</p>
            <h1>Account settings</h1>
            <p>Manage your profile, connected models, and account access.</p>
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
                Open OpenAI ↗
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
