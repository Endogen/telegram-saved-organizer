import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageGridSkeleton } from "@/components/messages/message-grid-skeleton";

describe("MessageGridSkeleton", () => {
  it("renders default 8 skeleton cards", () => {
    const { container } = render(<MessageGridSkeleton />);

    const articles = container.querySelectorAll("article");
    expect(articles.length).toBe(8);
  });

  it("renders custom count of skeleton cards", () => {
    const { container } = render(<MessageGridSkeleton count={3} />);

    const articles = container.querySelectorAll("article");
    expect(articles.length).toBe(3);
  });
});
