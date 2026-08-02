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

  it("loads a YouTube thumbnail only after an explicit privacy choice", () => {
    render(
      <MessageContent
        content="Worth watching:\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ"
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      />,
    );

    expect(screen.getByText(/Worth watching/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })).toBeInTheDocument();
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    expect(document.querySelector("img")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load YouTube thumbnail (contacts YouTube)" }));

    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
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
