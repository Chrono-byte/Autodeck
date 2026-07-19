import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { APP_PREFERENCES_BOOTSTRAP_SCRIPT, initializeAppPreferences } from "../lib/app-preferences";
import stylesheet from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Autodekt — Commander research and MTG rules lookup" },
      {
        name: "description",
        content:
          "Research Commander decks and look up the current Magic: The Gathering Comprehensive Rules.",
      },
    ],
    links: [{ rel: "stylesheet", href: stylesheet }],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function NotFoundComponent() {
  return (
    <main className="route-not-found">
      <p className="eyebrow">404</p>
      <h1>That page is not in this workspace.</h1>
      <a href="/">Return to Autodekt</a>
    </main>
  );
}

function RootComponent() {
  useEffect(() => initializeAppPreferences(), []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APP_PREFERENCES_BOOTSTRAP_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
