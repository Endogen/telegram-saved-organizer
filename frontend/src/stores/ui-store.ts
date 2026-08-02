import { create } from "zustand";

type UiState = {
  isSidebarOpen: boolean;
  searchQuery: string;
  setSidebarOpen: (isOpen: boolean) => void;
  toggleSidebar: () => void;
  setSearchQuery: (query: string) => void;
  reset: () => void;
};

export const useUiStore = create<UiState>()((set) => ({
  isSidebarOpen: false,
  searchQuery: "",
  setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSearchQuery: (query) => set({ searchQuery: query }),
  reset: () => set({ isSidebarOpen: false, searchQuery: "" }),
}));
