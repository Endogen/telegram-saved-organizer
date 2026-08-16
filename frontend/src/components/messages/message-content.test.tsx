import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageContent } from "@/components/messages/message-content";

describe("MessageContent", () => {
  it("renders a pure GitHub URL as one provider-aware preview", () => {
    render(
      <MessageContent
        content="https://github.com/openai/codex"
        url="https://github.com/openai/codex"
        compact
      />,
    );

    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("openai/codex")).toBeInTheDocument();
    expect(screen.getByText("Repository")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /GitHub.*openai\/codex.*Repository/ })).toHaveAttribute(
      "href",
      "https://github.com/openai/codex",
    );
  });

  it("loads a YouTube thumbnail immediately", () => {
    render(
      <MessageContent
        content="Worth watching:\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ"
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      />,
    );

    expect(screen.getByText(/Worth watching/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })).toBeInTheDocument();
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
  });

  it("renders a cached Telegram image with or without a caption", () => {
    const { rerender } = render(
      <MessageContent
        content="A useful diagram"
        url={null}
        mediaUrl="/api/messages/42/media"
        mediaType="photo"
        mimeType="image/jpeg"
      />,
    );

    expect(screen.getByRole("img", { name: "Saved Telegram image: A useful diagram" })).toHaveAttribute(
      "src",
      "/api/messages/42/media",
    );
    expect(screen.getByText("A useful diagram")).toBeInTheDocument();

    rerender(
      <MessageContent
        content={null}
        url={null}
        mediaUrl="/api/messages/43/media"
        mediaType="photo"
        mimeType="image/jpeg"
      />,
    );
    expect(screen.getByRole("img", { name: "Saved Telegram image" })).toBeInTheDocument();
    expect(screen.queryByText("No text or link content on this message.")).not.toBeInTheDocument();
  });

  it("shows a useful fallback when an image preview is not cached or fails", () => {
    const { rerender } = render(
      <MessageContent content={null} url={null} mediaType="photo" mimeType="image/jpeg" />,
    );
    expect(screen.getByText("Image preview will be cached during the next scan.")).toBeInTheDocument();

    rerender(
      <MessageContent
        content={null}
        url={null}
        mediaUrl="/api/messages/42/media"
        mediaType="photo"
        mimeType="image/jpeg"
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Saved Telegram image" }));
    expect(screen.getByText("Image preview unavailable.")).toBeInTheDocument();
  });

  it("renders cached audio-only Telegram messages as an inline player", () => {
    render(
      <MessageContent
        content={null}
        url={null}
        mediaUrl="/api/messages/44/media"
        mediaType="voice"
        mimeType="audio/ogg"
      />,
    );

    const player = screen.getByLabelText("Play saved audio");
    expect(player.tagName).toBe("AUDIO");
    expect(player).toHaveAttribute("src", "/api/messages/44/media");
    expect(player).toHaveAttribute("controls");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("does not duplicate the previewed URL in compact cards", () => {
    render(
      <MessageContent
        content={"Read the issue:\nhttps://github.com/openai/codex/issues/42"}
        url="https://github.com/openai/codex/issues/42"
        compact
      />,
    );

    expect(screen.getByText("Read the issue:")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://github.com/openai/codex/issues/42");
  });

  it("renders text-only and empty messages without a broken link surface", () => {
    const { rerender } = render(<MessageContent content="A plain saved note" url={null} />);
    expect(screen.getByText("A plain saved note")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    rerender(<MessageContent content={null} url={null} />);
    expect(screen.getByText("No text or link content on this message.")).toBeInTheDocument();
  });
});
