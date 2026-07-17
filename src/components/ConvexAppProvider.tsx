import type { ReactNode } from 'react'
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import { ConvexReactClient } from 'convex/react'
import { authClient } from '../lib/auth-client'

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined
const convex = convexUrl ? new ConvexReactClient(convexUrl, { expectAuth: true }) : null

export function ConvexAppProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <div className="brand-mark">A</div>
          <p className="eyebrow">BACKEND SETUP REQUIRED</p>
          <h1>Connect Autodekt to Convex</h1>
          <p>Run <code>npx convex dev</code>, then restart the app after <code>VITE_CONVEX_URL</code> and <code>VITE_CONVEX_SITE_URL</code> appear in <code>.env.local</code>.</p>
        </div>
      </main>
    )
  }

  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  )
}
