import { createFileRoute } from "@tanstack/react-router";
import { AccountSettings } from "../components/AccountSettings";
import { ConvexAppProvider } from "../components/ConvexAppProvider";

export const Route = createFileRoute("/settings")({
  ssr: false,
  component: Settings,
});

function Settings() {
  return (
    <ConvexAppProvider>
      <AccountSettings />
    </ConvexAppProvider>
  );
}
