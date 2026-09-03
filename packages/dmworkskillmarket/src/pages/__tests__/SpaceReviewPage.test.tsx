import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpaceReviewPage from "../SpaceReviewPage";

// ReviewQueue owns the queue's own data reads, sub-tabs and empty/error states.
// This page is a shell, so the test pins the contract between them: the title
// renders and the queue is mounted in `space` mode.
vi.mock("../../components/ReviewQueue", () => ({
  default: ({ mode }: { mode: string }) => (
    <div data-testid="review-queue" data-mode={mode} />
  ),
}));

const { updatePolicy } = vi.hoisted(() => ({ updatePolicy: vi.fn() }));
vi.mock("../../api/skillApi", () => ({
  getReviewPolicy: vi.fn(() => Promise.resolve({ isAutoApproveEnabled: true })),
  updateReviewPolicy: (enabled: boolean) => updatePolicy(enabled),
}));
vi.mock("../../hooks/useSpaceRole", () => ({
  useSpaceRole: () => ({ role: 1, isReviewer: true, loading: false }),
}));

const pageTitle = /组织发布管理|skillMarket\.review\.orgTab/;

describe("SpaceReviewPage", () => {
  beforeEach(() => {
    updatePolicy.mockReset();
    updatePolicy.mockResolvedValue({ isAutoApproveEnabled: false });
  });
  it("renders the page title and mounts the Space reviewer queue", () => {
    render(<SpaceReviewPage />);

    expect(screen.getByRole("heading", { name: pageTitle })).toBeInTheDocument();
    expect(screen.getByTestId("review-queue")).toHaveAttribute("data-mode", "space");
  });

  it("shows the default-enabled policy to owners and confirms before disabling", async () => {
    render(<SpaceReviewPage />);

    const toggle = await screen.findByRole("checkbox");
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    expect(updatePolicy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /关闭自动审核|policyDisableTitle/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /确认关闭|policyDisableAction/ }));

    await waitFor(() => expect(updatePolicy).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("delegates every empty/error/loading state to the queue", () => {
    const { container } = render(<SpaceReviewPage />);

    // No competing page-level state block — the queue is the only child of the
    // content area besides the header.
    expect(container.querySelectorAll(".skill-market-state")).toHaveLength(0);
  });
});
