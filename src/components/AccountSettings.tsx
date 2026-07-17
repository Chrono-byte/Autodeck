import { useState } from "react";
import {
  AuthLoading,
  Authenticated,
  Unauthenticated,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { Link } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import { authClient } from "../lib/auth-client";
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
        <Link to="/" className="settings-back">← Back to workspace</Link>
        <div className="settings-brand">
          <div className="brand-mark">A</div>
          <strong>Autodekt</strong>
        </div>
      </header>
      <div className="settings-shell">
        <aside className="settings-nav">
          <p className="eyebrow">SETTINGS</p>
          <a href="#account" className="active">Account</a>
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
              <div className="settings-avatar">
                {user?.name?.slice(0, 1).toUpperCase() ?? "U"}
              </div>
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

  const connected = status?.connected === true;

  return (
    <div className={`settings-card connection-settings-card ${connected ? "connected" : ""}`}>
      <div className="connection-provider-mark" aria-hidden="true">AI</div>
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
              <a href={verificationUri} target="_blank" rel="noreferrer">Open OpenAI ↗</a>
            )}
          </div>
        )}
        {error && <p className="settings-connection-error" role="alert">{error}</p>}
      </div>
      {connected ? (
        <button type="button" className="secondary-settings-button" onClick={() => void disconnect()}>
          Disconnect
        </button>
      ) : (
        <button type="button" className="primary-settings-button" disabled={busy} onClick={() => void connect()}>
          {busy ? "Waiting for OpenAI…" : "Connect"}
        </button>
      )}
    </div>
  );
}
