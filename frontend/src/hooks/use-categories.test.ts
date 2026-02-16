import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import { useCategories } from "@/hooks/use-categories";
import type { CategoryWithCount } from "@/types/category";

function routerWrapper({ children }: { children: ReactNode }) {
  return createElement(MemoryRouter, null, children);
}

const apiCategories: CategoryWithCount[] = [
  {
    id: 1,
    name: "Videos",
    slug: "videos",
    icon: "video",
    color: "#E11D48",
    position: 1,
    is_default: true,
    message_count: 5,
  },
  {
    id: 2,
    name: "Audio",
    slug: "audio",
    icon: "music",
    color: "#2563EB",
    position: 2,
    is_default: true,
    message_count: 3,
  },
];

describe("useCategories", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches categories successfully from API", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(apiCategories),
    });

    const { result } = renderHook(() => useCategories(), { wrapper: routerWrapper });

    // Initially loading with fallback
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isFallback).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.categories).toEqual(apiCategories);
    expect(result.current.isFallback).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("falls back to defaults on network error", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useCategories(), { wrapper: routerWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isFallback).toBe(true);
    expect(result.current.error).toBe("Network error");
    expect(result.current.categories.length).toBeGreaterThan(0);
  });

  it("falls back on non-ok response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { result } = renderHook(() => useCategories(), { wrapper: routerWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isFallback).toBe(true);
    expect(result.current.error).toBe("Failed to fetch categories.");
  });

  it("falls back on unexpected payload shape", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ not: "categories" }),
    });

    const { result } = renderHook(() => useCategories(), { wrapper: routerWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isFallback).toBe(true);
    expect(result.current.error).toBe("Unexpected category payload.");
  });

  it("falls back on invalid category items in array", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ id: 1, name: "Test" }]), // missing fields
    });

    const { result } = renderHook(() => useCategories(), { wrapper: routerWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isFallback).toBe(true);
    expect(result.current.error).toBe("Unexpected category payload.");
  });

  it("sorts categories by position then id", async () => {
    const unordered: CategoryWithCount[] = [
      { ...apiCategories[1], position: 1 },
      { ...apiCategories[0], position: 1 },
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(unordered),
    });

    const { result } = renderHook(() => useCategories(), { wrapper: routerWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Same position -> sorted by id
    expect(result.current.categories[0].id).toBe(1);
    expect(result.current.categories[1].id).toBe(2);
  });

  it("handles error without message", async () => {
    fetchMock.mockRejectedValue("string error");

    const { result } = renderHook(() => useCategories(), { wrapper: routerWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to fetch categories.");
  });
});
