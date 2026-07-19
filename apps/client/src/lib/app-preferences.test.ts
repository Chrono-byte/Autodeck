import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_PREFERENCES,
  DEFAULT_WORKSPACE_PREFERENCES,
  normalizeAppPreferences,
  normalizeWorkspacePreferences,
} from "./app-preferences";

describe("app preferences", () => {
  it("accepts supported appearance values", () => {
    expect(
      normalizeAppPreferences({
        theme: "dark",
        accent: "violet",
        density: "compact",
        scale: "large",
        reduceMotion: true,
      }),
    ).toEqual({
      theme: "dark",
      accent: "violet",
      density: "compact",
      scale: "large",
      reduceMotion: true,
    });
  });

  it("falls back field-by-field for malformed values", () => {
    expect(
      normalizeAppPreferences({
        theme: "sepia",
        accent: 12,
        density: "tiny",
        scale: null,
        reduceMotion: "yes",
      }),
    ).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it("bounds workspace layout preferences", () => {
    expect(
      normalizeWorkspacePreferences({
        sidebarOpen: false,
        deckEditorOpen: false,
        chatSplit: 61.6,
      }),
    ).toEqual({ sidebarOpen: false, deckEditorOpen: false, chatSplit: 62 });
    expect(normalizeWorkspacePreferences({ chatSplit: 90 })).toEqual(DEFAULT_WORKSPACE_PREFERENCES);
  });
});
