import type { ReactNode } from "react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import type { AuthClient } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { authClient } from "../lib/auth-client";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convex = convexUrl ? new ConvexReactClient(convexUrl, { expectAuth: true }) : null;

export function ConvexAppProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <div className="brand-mark">A</div>
          <p className="eyebrow">BACKEND SETUP REQUIRED</p>
          <h1>Connect Autodekt to Convex</h1>
          <p>
            Run <code>pnpm dev:backend</code>, then restart the client after Convex writes its local
            connection details.
          </p>
        </div>
      </main>
    );
  }

  // Better Auth's generated session type is structurally compatible at runtime,
  // but its plugin generics are invariant across the two package entry points.
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient as unknown as AuthClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
