import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

beforeAll(() => {
  if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof window !== "undefined" && typeof window.ResizeObserver === "undefined") {
    class ResizeObserverMock {
      observe(_target: Element, _options?: ResizeObserverOptions): void {}
      unobserve(_target: Element): void {}
      disconnect(): void {}
    }

    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: ResizeObserverMock,
    });
  }

  if (typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.scrollIntoView !== "function") {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      writable: true,
      value: vi.fn(),
    });
  }
});
