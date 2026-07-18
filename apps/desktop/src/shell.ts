import type { DesktopShellApi, NavigationState, SidebarState } from "./preload.cjs";

declare global {
  interface Window {
    desktopShell: DesktopShellApi;
  }
}

function getButton(id: string): HTMLButtonElement {
  const element = document.querySelector(`#${id}`);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing shell button: ${id}`);
  return element;
}

const backButton = getButton("back");
const forwardButton = getButton("forward");
const reloadButton = getButton("reload");
const sidebarButton = getButton("sidebar");

backButton.addEventListener("click", () => window.desktopShell.goBack());
forwardButton.addEventListener("click", () => window.desktopShell.goForward());
reloadButton.addEventListener("click", () => window.desktopShell.reload());
sidebarButton.addEventListener("click", () => window.desktopShell.toggleSidebar());

function applyNavigationState(state: NavigationState): void {
  backButton.disabled = !state.canGoBack;
  forwardButton.disabled = !state.canGoForward;
}

applyNavigationState({ canGoBack: false, canGoForward: false });
window.desktopShell.onNavigationStateChanged(applyNavigationState);

function applySidebarState(state: SidebarState): void {
  sidebarButton.dataset.open = String(state.isOpen);
  sidebarButton.setAttribute("aria-pressed", String(!state.isOpen));
  sidebarButton.title = state.isOpen ? "Hide sidebar" : "Show sidebar";
  sidebarButton.setAttribute("aria-label", sidebarButton.title);
}

applySidebarState({ isOpen: true });
window.desktopShell.onSidebarStateChanged(applySidebarState);
