import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WKApp } from "@octo/base";
import SpaceReviewPage from "../SpaceReviewPage";

// ReviewQueue owns the queue's own data reads, sub-tabs and empty/error states.
// This page is a shell, so the test pins the contract between them: the title
// renders and the queue is mounted in `space` mode.
vi.mock("../../components/ReviewQueue", () => ({
  default: ({ mode }: { mode: string }) => (
    <div data-testid="review-queue" data-mode={mode} />
  ),
}));

const { getPolicy, updatePolicy, roleState } = vi.hoisted(() => ({
  getPolicy: vi.fn(),
  updatePolicy: vi.fn(),
  roleState: { current: 2 },
}));
vi.mock("../../api/skillApi", () => ({
  getReviewPolicy: () => getPolicy(),
  updateReviewPolicy: (enabled: boolean) => updatePolicy(enabled),
}));
vi.mock("../../hooks/useSpaceRole", () => ({
  useSpaceRole: () => ({
    role: roleState.current,
    isReviewer: roleState.current >= 1,
    loading: false,
  }),
}));

const pageTitle = /组织发布管理|skillMarket\.review\.orgTab/;

describe("SpaceReviewPage", () => {
  beforeEach(() => {
    roleState.current = 2;
    getPolicy.mockReset();
    getPolicy.mockResolvedValue({ isAutoApproveEnabled: true });
    updatePolicy.mockReset();
    updatePolicy.mockResolvedValue({ isAutoApproveEnabled: false });
  });
  it("renders the page title and mounts the Space reviewer queue", async () => {
    render(<SpaceReviewPage />);

    expect(screen.getByRole("heading", { name: pageTitle })).toBeInTheDocument();
    expect(screen.getByTestId("review-queue")).toHaveAttribute("data-mode", "space");
    await waitFor(() => expect(getPolicy).toHaveBeenCalledTimes(1));
  });

  it("shows the shared policy to reviewers and confirms before disabling", async () => {
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

  it("ignores a stale policy response after switching Space", async () => {
    let resolveOld: ((value: { isAutoApproveEnabled: boolean }) => void) | undefined;
    const oldRequest = new Promise<{ isAutoApproveEnabled: boolean }>((resolve) => {
      resolveOld = resolve;
    });
    getPolicy
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValueOnce({ isAutoApproveEnabled: false });

    render(<SpaceReviewPage />);
    act(() => {
      WKApp.mittBus.emit("space-changed", { space_id: "space-b", role: 2 });
    });

    const toggle = await screen.findByRole("checkbox");
    await waitFor(() => expect(toggle).not.toBeChecked());
    await act(async () => {
      resolveOld?.({ isAutoApproveEnabled: true });
      await oldRequest;
    });

    expect(toggle).not.toBeChecked();
  });

  it("ignores an in-flight save response after switching Space", async () => {
    let resolveSave: ((value: { isAutoApproveEnabled: boolean }) => void) | undefined;
    const saveRequest = new Promise<{ isAutoApproveEnabled: boolean }>((resolve) => {
      resolveSave = resolve;
    });
    updatePolicy.mockReturnValueOnce(saveRequest);
    getPolicy
      .mockResolvedValueOnce({ isAutoApproveEnabled: false })
      .mockResolvedValueOnce({ isAutoApproveEnabled: false });

    render(<SpaceReviewPage />);
    const toggle = await screen.findByRole("checkbox");
    await waitFor(() => expect(toggle).not.toBeChecked());
    fireEvent.click(toggle);
    act(() => {
      WKApp.mittBus.emit("space-changed", { space_id: "space-b", role: 2 });
    });
    await waitFor(() => expect(getPolicy).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveSave?.({ isAutoApproveEnabled: true });
      await saveRequest;
    });
    expect(toggle).not.toBeChecked();
  });

  it("shows the shared policy control to admins", async () => {
    roleState.current = 1;
    render(<SpaceReviewPage />);

    expect(await screen.findByRole("checkbox")).toBeInTheDocument();
    expect(screen.getByTestId("review-queue")).toBeInTheDocument();
  });

  it("keeps the policy control hidden and avoids policy reads for ordinary members", async () => {
    roleState.current = 0;
    render(<SpaceReviewPage />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await waitFor(() => expect(getPolicy).not.toHaveBeenCalled());
  });

  it("does not render an unfetched policy value when loading fails", async () => {
    getPolicy.mockRejectedValueOnce(new Error("policy unavailable"));
    render(<SpaceReviewPage />);

    expect(await screen.findByText("policy unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("delegates every empty/error/loading state to the queue", async () => {
    const { container } = render(<SpaceReviewPage />);

    // No competing page-level state block — the queue is the only child of the
    // content area besides the header.
    expect(container.querySelectorAll(".skill-market-state")).toHaveLength(0);
    await waitFor(() => expect(getPolicy).toHaveBeenCalledTimes(1));
  });
});
