import { contextBridge, ipcRenderer } from "electron";

type DesktopClientApi = {
  onToggleSidebar(callback: () => void): () => void;
  setSidebarOpen(isOpen: boolean): void;
};

const toggleSidebarListeners = new Set<() => void>();

ipcRenderer.on("desktop:toggle-sidebar", () => {
  for (const listener of toggleSidebarListeners) listener();
});

const desktopClientApi: DesktopClientApi = {
  onToggleSidebar: (callback) => {
    toggleSidebarListeners.add(callback);
    return () => toggleSidebarListeners.delete(callback);
  },
  setSidebarOpen: (isOpen) => ipcRenderer.send("desktop:sidebar-state", { isOpen }),
};

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktopShell = "true";
});

contextBridge.exposeInMainWorld("autodektDesktop", desktopClientApi);
