import { describe, expect, it } from "vitest";

import { analyzeMessageContent, messageTextParts, trimUrlPunctuation } from "@/lib/message-content";

describe("message content analysis", () => {
  it("recognizes a pure GitHub repository URL without duplicating it as text", () => {
    const result = analyzeMessageContent("https://github.com/openai/codex", "https://github.com/openai/codex");

    expect(result.text).toBeNull();
    expect(result.isPureUrl).toBe(true);
    expect(result.link).toMatchObject({
      provider: "github",
      providerLabel: "GitHub",
      title: "openai/codex",
      description: "Repository",
    });
  });

  it("normalizes scheme-less www links", () => {
    const result = analyzeMessageContent("www.github.com/openai/codex", null);

    expect(result.isPureUrl).toBe(true);
    expect(result.link).toMatchObject({
      provider: "github",
      url: "https://www.github.com/openai/codex",
      title: "openai/codex",
    });
  });

  it("describes GitHub resources", () => {
    expect(analyzeMessageContent(null, "https://github.com/openai/codex/issues/42").link).toMatchObject({
      title: "openai/codex",
      description: "Issue #42",
    });
    expect(analyzeMessageContent(null, "https://github.com/openai/codex/pull/99").link).toMatchObject({
      description: "Pull request #99",
    });
  });

  it("keeps mixed text and identifies YouTube video links", () => {
    const result = analyzeMessageContent(
      "This explains the design:\nhttps://youtu.be/dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
    );

    expect(result.text).toContain("This explains the design");
    expect(result.isPureUrl).toBe(false);
    expect(result.link).toMatchObject({
      provider: "youtube",
      title: "Watch on YouTube",
      youtubeVideoId: "dQw4w9WgXcQ",
    });
  });

  it("recognizes both X and legacy Twitter status links", () => {
    expect(analyzeMessageContent(null, "https://x.com/openai/status/123456").link).toMatchObject({
      provider: "twitter",
      title: "@openai",
      description: "Post on X · 123456",
    });
    expect(analyzeMessageContent(null, "https://twitter.com/openai/status/789").link?.provider).toBe("twitter");
  });

  it("builds a useful generic link summary and preserves invalid values as text", () => {
    expect(analyzeMessageContent(null, "https://docs.example.com/guides/start").link).toMatchObject({
      provider: "generic",
      title: "docs.example.com",
      description: "/guides/start",
    });
    expect(analyzeMessageContent(null, "not-a-url")).toEqual({
      text: "not-a-url",
      isPureUrl: false,
      link: null,
    });
  });

  it("trims sentence punctuation but retains balanced URL parentheses", () => {
    expect(trimUrlPunctuation("https://example.com/read.")) .toBe("https://example.com/read");
    expect(trimUrlPunctuation("https://example.com/guide_(draft)")) .toBe("https://example.com/guide_(draft)");

    const parts = messageTextParts("See https://example.com/read, then continue.");
    expect(parts).toContainEqual({ value: "https://example.com/read", url: "https://example.com/read" });
    expect(parts).toContainEqual({ value: ",", url: null });
  });
});
