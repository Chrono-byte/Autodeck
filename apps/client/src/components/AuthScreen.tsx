import { useState } from "react";
import { authClient } from "../lib/auth-client";

export function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <main className="auth-screen">
      <section className="auth-pitch">
        <div className="brand-lockup">
          <div className="brand-mark">A</div>
          <span>Autodekt</span>
        </div>
        <p className="eyebrow">Commander deck builder</p>
        <h1>Build the list. Keep the context.</h1>
        <p>Manage deck lists and deck-specific conversations in the same workspace.</p>
        <div className="auth-features">
          <span>Deck editor</span>
          <span>Saved conversations</span>
          <span>Scryfall card data</span>
        </div>
      </section>
      <form
        className="auth-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const result =
            mode === "signup"
              ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
              : await authClient.signIn.email({ email: email.trim(), password });
          if (result.error) setError(result.error.message ?? "Authentication failed.");
          setBusy(false);
        }}
      >
        <p className="eyebrow">{mode === "signin" ? "Welcome back" : "Create account"}</p>
        <h2>{mode === "signin" ? "Sign in" : "Get started"}</h2>
        {mode === "signup" && (
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <button className="primary-button" disabled={busy}>
          {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}
