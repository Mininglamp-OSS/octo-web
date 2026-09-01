import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SpaceReviewPage from "../SpaceReviewPage";

// ReviewQueue owns the queue's own data reads, sub-tabs and empty/error states.
// This page is a shell, so the test pins the contract between them: the title
// renders and the queue is mounted in `space` mode.
vi.mock("../../components/ReviewQueue", () => ({
  default: ({ mode }: { mode: string }) => (
    <div data-testid="review-queue" data-mode={mode} />
  ),
}));

const pageTitle = /组织审核|skillMarket\.review\.orgTab/;

describe("SpaceReviewPage", () => {
  it("renders the page title and mounts the Space reviewer queue", () => {
    render(<SpaceReviewPage />);

    expect(screen.getByRole("heading", { name: pageTitle })).toBeInTheDocument();
    expect(screen.getByTestId("review-queue")).toHaveAttribute("data-mode", "space");
  });

  it("delegates every empty/error/loading state to the queue", () => {
    const { container } = render(<SpaceReviewPage />);

    // No competing page-level state block — the queue is the only child of the
    // content area besides the header.
    expect(container.querySelectorAll(".skill-market-state")).toHaveLength(0);
  });
});
