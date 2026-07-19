export const APP_PREFERENCES_STORAGE_KEY = "autodekt:app-preferences";

export type AppTheme = "system" | "light" | "dark";
export type AppAccent = "forest" | "blue" | "violet" | "ember";
export type InterfaceDensity = "comfortable" | "compact";
export type InterfaceScale = "small" | "default" | "large";

export type AppPreferences = {
  theme: AppTheme;
  accent: AppAccent;
  density: InterfaceDensity;
  scale: InterfaceScale;
  reduceMotion: boolean;
};

export type WorkspacePreferences = {
  sidebarOpen: boolean;
  deckEditorOpen: boolean;
  chatSplit: number;
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: "system",
  accent: "forest",
  density: "comfortable",
  scale: "default",
  reduceMotion: false,
};

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  sidebarOpen: true,
  deckEditorOpen: true,
  chatSplit: 42,
};

const themes: readonly AppTheme[] = ["system", "light", "dark"];
const accents: readonly AppAccent[] = ["forest", "blue", "violet", "ember"];
const densities: readonly InterfaceDensity[] = ["comfortable", "compact"];
const scales: readonly InterfaceScale[] = ["small", "default", "large"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.some((option) => option === value);
}

export function normalizeAppPreferences(value: unknown): AppPreferences {
  if (!isRecord(value)) return { ...DEFAULT_APP_PREFERENCES };
  return {
    theme: isOneOf(value.theme, themes) ? value.theme : DEFAULT_APP_PREFERENCES.theme,
    accent: isOneOf(value.accent, accents) ? value.accent : DEFAULT_APP_PREFERENCES.accent,
    density: isOneOf(value.density, densities) ? value.density : DEFAULT_APP_PREFERENCES.density,
    scale: isOneOf(value.scale, scales) ? value.scale : DEFAULT_APP_PREFERENCES.scale,
    reduceMotion:
      typeof value.reduceMotion === "boolean"
        ? value.reduceMotion
        : DEFAULT_APP_PREFERENCES.reduceMotion,
  };
}

export function normalizeWorkspacePreferences(value: unknown): WorkspacePreferences {
  if (!isRecord(value)) return { ...DEFAULT_WORKSPACE_PREFERENCES };
  const chatSplit = typeof value.chatSplit === "number" ? value.chatSplit : Number.NaN;
  return {
    sidebarOpen:
      typeof value.sidebarOpen === "boolean"
        ? value.sidebarOpen
        : DEFAULT_WORKSPACE_PREFERENCES.sidebarOpen,
    deckEditorOpen:
      typeof value.deckEditorOpen === "boolean"
        ? value.deckEditorOpen
        : DEFAULT_WORKSPACE_PREFERENCES.deckEditorOpen,
    chatSplit:
      Number.isFinite(chatSplit) && chatSplit >= 25 && chatSplit <= 75
        ? Math.round(chatSplit)
        : DEFAULT_WORKSPACE_PREFERENCES.chatSplit,
  };
}

export function readAppPreferences(): AppPreferences {
  try {
    return normalizeAppPreferences(
      JSON.parse(window.localStorage.getItem(APP_PREFERENCES_STORAGE_KEY) ?? "null"),
    );
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

export function readWorkspacePreferences(): WorkspacePreferences {
  return normalizeWorkspacePreferences({
    sidebarOpen: window.localStorage.getItem("autodekt:sidebar-open") !== "false",
    deckEditorOpen: window.localStorage.getItem("autodekt:deck-editor-collapsed") !== "true",
    chatSplit: Number(window.localStorage.getItem("autodekt:workspace-chat-split")),
  });
}

function resolvedTheme(theme: AppTheme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyAppPreferences(preferences: AppPreferences): void {
  const root = document.documentElement;
  const theme = resolvedTheme(preferences.theme);
  root.dataset.theme = theme;
  root.dataset.accent = preferences.accent;
  root.dataset.density = preferences.density;
  root.dataset.textScale = preferences.scale;
  root.dataset.motion =
    preferences.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "reduced"
      : "full";
  root.style.colorScheme = theme;
}

export function saveAppPreferences(value: AppPreferences): AppPreferences {
  const preferences = normalizeAppPreferences(value);
  window.localStorage.setItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  applyAppPreferences(preferences);
  return preferences;
}

export function saveWorkspacePreferences(value: WorkspacePreferences): WorkspacePreferences {
  const preferences = normalizeWorkspacePreferences(value);
  window.localStorage.setItem("autodekt:sidebar-open", String(preferences.sidebarOpen));
  window.localStorage.setItem(
    "autodekt:deck-editor-collapsed",
    String(!preferences.deckEditorOpen),
  );
  window.localStorage.setItem("autodekt:workspace-chat-split", String(preferences.chatSplit));
  return preferences;
}

export function initializeAppPreferences(): () => void {
  const refresh = () => applyAppPreferences(readAppPreferences());
  const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  refresh();
  themeQuery.addEventListener("change", refresh);
  motionQuery.addEventListener("change", refresh);
  window.addEventListener("storage", refresh);
  return () => {
    themeQuery.removeEventListener("change", refresh);
    motionQuery.removeEventListener("change", refresh);
    window.removeEventListener("storage", refresh);
  };
}

export const APP_PREFERENCES_BOOTSTRAP_SCRIPT = `
(() => {
  try {
    const value = JSON.parse(localStorage.getItem("${APP_PREFERENCES_STORAGE_KEY}") || "null") || {};
    const theme = value.theme === "light" || value.theme === "dark"
      ? value.theme
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const accent = ["forest", "blue", "violet", "ember"].includes(value.accent)
      ? value.accent
      : "forest";
    const density = value.density === "compact" ? "compact" : "comfortable";
    const scale = ["small", "large"].includes(value.scale) ? value.scale : "default";
    const motion = value.reduceMotion === true || matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "reduced"
      : "full";
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.accent = accent;
    root.dataset.density = density;
    root.dataset.textScale = scale;
    root.dataset.motion = motion;
    root.style.colorScheme = theme;
  } catch {}
})();`;
