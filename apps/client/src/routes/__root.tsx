import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
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
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
