import { describe, expect, it } from "vitest";

import { useUiStore } from "@/stores/ui-store";

describe("useUiStore", () => {
  it("has correct initial state", () => {
    const state = useUiStore.getState();
    expect(state.isSidebarOpen).toBe(false);
    expect(state.searchQuery).toBe("");
  });

  it("toggles sidebar", () => {
    const { toggleSidebar } = useUiStore.getState();

    toggleSidebar();
    expect(useUiStore.getState().isSidebarOpen).toBe(true);

    toggleSidebar();
    expect(useUiStore.getState().isSidebarOpen).toBe(false);
  });

  it("sets sidebar open state directly", () => {
    const { setSidebarOpen } = useUiStore.getState();

    setSidebarOpen(true);
    expect(useUiStore.getState().isSidebarOpen).toBe(true);

    setSidebarOpen(false);
    expect(useUiStore.getState().isSidebarOpen).toBe(false);
  });

  it("sets search query", () => {
    const { setSearchQuery } = useUiStore.getState();

    setSearchQuery("hello world");
    expect(useUiStore.getState().searchQuery).toBe("hello world");

    setSearchQuery("");
    expect(useUiStore.getState().searchQuery).toBe("");
  });
});
