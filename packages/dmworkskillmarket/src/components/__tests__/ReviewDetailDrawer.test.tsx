import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WKApp } from "@octo/base";
import ReviewDetailDrawer from "../ReviewDetailDrawer";
import * as api from "../../api/skillApi";
import type { ReviewRequest } from "../../types/skill";

vi.mock("../../api/skillApi");

function detail(id = "review-1", pluginName = "Planning Team"): ReviewRequest {
  return {
    id,
    pluginId: `team-${id}`,
    pluginName,
    pluginType: "expert_team",
    spaceId: "space-1",
    targetScope: "space",
    status: "pending",
    kind: "first",
    version: "1.0.0",
    applicantId: "applicant-1",
    applicantName: "Alice",
    submittedAt: "2026-09-04T00:00:00Z",
    frozenRelations: [{
      relationId: "relation-1",
      targetPluginId: "expert-child-1",
      targetPluginType: "expert",
      relationType: "team_member",
      sortOrder: 1,
      data: { is_leader: true, role: "planner", member_key: "lead" },
    }],
  };
}

describe("ReviewDetailDrawer frozen relations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    WKApp.shared.currentSpaceId = "space-1";
    vi.mocked(api.getReviewRequest).mockResolvedValue(detail());
  });

  it("shows the frozen relation graph and approval-critical wiring", async () => {
    render(
      <ReviewDetailDrawer
        reviewId="review-1"
        canReview
        onClose={vi.fn()}
        onDecided={vi.fn()}
      />
    );

    expect(await screen.findByText("expert-child-1")).toBeInTheDocument();
    expect(screen.getByText("team_member")).toBeInTheDocument();
    expect(screen.getByText(/"is_leader": true/)).toBeInTheDocument();
    expect(screen.getByText(/"role": "planner"/)).toBeInTheDocument();
    expect(screen.getByText(/"member_key": "lead"/)).toBeInTheDocument();
  });

  it("does not reopen a reject dialog when the drawer switches reviews", async () => {
    vi.mocked(api.getReviewRequest)
      .mockResolvedValueOnce(detail("review-a", "Skill A"))
      .mockResolvedValueOnce(detail("review-b", "Skill B"));
    const props = { canReview: true, onClose: vi.fn(), onDecided: vi.fn() };
    const { rerender } = render(<ReviewDetailDrawer {...props} reviewId="review-a" />);

    await screen.findByText("Skill A", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: /拒绝|review\.reject/ }));
    expect(screen.getAllByRole("dialog")).toHaveLength(2);

    rerender(<ReviewDetailDrawer {...props} reviewId={null} />);
    rerender(<ReviewDetailDrawer {...props} reviewId="review-b" />);
    await screen.findByText("Skill B");

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("refreshes the queue after a same-Space decision without closing another review", async () => {
    let resolveApprove!: () => void;
    vi.mocked(api.approveReview).mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveApprove = resolve;
    }));
    vi.mocked(api.getReviewRequest)
      .mockResolvedValueOnce(detail("review-a", "Skill A"))
      .mockResolvedValueOnce(detail("review-b", "Skill B"));
    const onClose = vi.fn();
    const onDecided = vi.fn();
    const { rerender } = render(
      <ReviewDetailDrawer reviewId="review-a" canReview onClose={onClose} onDecided={onDecided} />,
    );

    await screen.findByText("Skill A", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: /通过并上架|approveAndPublish/ }));
    rerender(<ReviewDetailDrawer reviewId="review-b" canReview onClose={onClose} onDecided={onDecided} />);
    await screen.findByText("Skill B");
    await act(async () => resolveApprove());

    await waitFor(() => expect(api.approveReview).toHaveBeenCalledWith("review-a"));
    expect(onDecided).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Skill B")).toBeInTheDocument();
  });

  it("keeps the rejection reason and error visible after a 409 and allows retry", async () => {
    vi.mocked(api.rejectReview)
      .mockRejectedValueOnce(new Error("Review already decided (409)"))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const onDecided = vi.fn();
    render(<ReviewDetailDrawer reviewId="review-1" canReview onClose={onClose} onDecided={onDecided} />);
    await screen.findByText("Planning Team", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "拒绝", exact: true }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Needs clarification" } });
    fireEvent.click(screen.getByRole("button", { name: "确认拒绝" }));

    const rejectDialog = screen.getByRole("dialog", { name: "拒绝审核" });
    expect(await within(rejectDialog).findByText("Review already decided (409)")).toBeInTheDocument();
    expect(within(rejectDialog).getByRole("textbox")).toHaveValue("Needs clarification");
    expect(api.getReviewRequest).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(onDecided).not.toHaveBeenCalled();

    fireEvent.click(within(rejectDialog).getByRole("button", { name: "确认拒绝" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
    expect(api.rejectReview).toHaveBeenLastCalledWith("review-1", "Needs clarification");
  });

  it.each(["approve", "reject"] as const)("blocks every drawer close while %s is pending", async (action) => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    vi.mocked(action === "approve" ? api.approveReview : api.rejectReview).mockReturnValueOnce(pending);
    const onClose = vi.fn();
    const onDecided = vi.fn();
    render(<ReviewDetailDrawer reviewId="review-1" canReview onClose={onClose} onDecided={onDecided} />);
    await screen.findByText("Planning Team", { exact: true });
    const drawer = screen.getByRole("dialog");
    if (action === "reject") {
      fireEvent.click(screen.getByRole("button", { name: "拒绝", exact: true }));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Reason" } });
      fireEvent.click(screen.getByRole("button", { name: "确认拒绝" }));
    } else {
      fireEvent.click(screen.getByRole("button", { name: "通过并上架" }));
    }
    expect(within(drawer).getByRole("button", { name: "取消" })).toBeDisabled();
    for (const close of screen.getAllByRole("button", { name: "关闭" })) fireEvent.click(close);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(onDecided).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(["success", "failure"] as const)("ignores an old action %s after closing and reopening the same review", async (outcome) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    let resolveNew!: () => void;
    vi.mocked(api.approveReview)
      .mockReturnValueOnce(new Promise<void>((done, fail) => { resolve = done; reject = fail; }))
      .mockReturnValueOnce(new Promise<void>((done) => { resolveNew = done; }));
    const props = { canReview: true, onClose: vi.fn(), onDecided: vi.fn() };
    const { rerender } = render(<ReviewDetailDrawer {...props} reviewId="review-1" />);
    await screen.findByText("Planning Team", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "通过并上架" }));
    rerender(<ReviewDetailDrawer {...props} reviewId={null} />);
    rerender(<ReviewDetailDrawer {...props} reviewId="review-1" />);
    await screen.findByText("Planning Team", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "通过并上架" }));
    await act(async () => outcome === "success" ? resolve() : reject(new Error("Old failure")));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onDecided).toHaveBeenCalledTimes(outcome === "success" ? 1 : 0);
    expect(screen.queryByText("Old failure")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /通过并上架/ })).toBeDisabled();
    await act(async () => resolveNew());
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it.each(["space", "unmount"] as const)("abandons an in-flight decision on %s", async (change) => {
    let resolve!: () => void;
    vi.mocked(api.approveReview).mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    const props = { canReview: true, onClose: vi.fn(), onDecided: vi.fn() };
    const { unmount } = render(<ReviewDetailDrawer {...props} reviewId="review-1" />);
    await screen.findByText("Planning Team", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "通过并上架" }));
    if (change === "space") {
      act(() => {
        WKApp.shared.currentSpaceId = "space-2";
        WKApp.mittBus.emit("space-changed");
      });
    } else unmount();
    props.onClose.mockClear();
    await act(async () => resolve());
    expect(props.onDecided).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it.each(["approve", "reject"] as const)("unlocks %s after an emit-less Space change without applying its result", async (action) => {
    let resolve!: () => void;
    vi.mocked(action === "approve" ? api.approveReview : api.rejectReview)
      .mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    const props = { canReview: true, onClose: vi.fn(), onDecided: vi.fn() };
    render(<ReviewDetailDrawer {...props} reviewId="review-1" />);
    await screen.findByText("Planning Team", { exact: true });
    const drawer = screen.getByRole("dialog");
    if (action === "reject") {
      fireEvent.click(screen.getByRole("button", { name: "拒绝", exact: true }));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep my reason" } });
      fireEvent.click(screen.getByRole("button", { name: "确认拒绝" }));
    } else fireEvent.click(screen.getByRole("button", { name: "通过并上架" }));
    // No mitt event: production post-join selection can change the ID before
    // the background Space lookup fails. A pending action must still unlock.
    await act(async () => {
      WKApp.shared.currentSpaceId = "space-2";
      resolve();
    });
    expect(props.onDecided).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    if (action === "reject") {
      const reasonDialog = screen.getByRole("dialog", { name: "拒绝审核" });
      expect(within(reasonDialog).getByRole("textbox")).toHaveValue("Keep my reason");
      expect(within(reasonDialog).getByText(/组织已切换/)).toBeInTheDocument();
      fireEvent.click(within(reasonDialog).getByRole("button", { name: "确认拒绝" }));
      await waitFor(() => expect(within(reasonDialog).getByRole("button", { name: "确认拒绝" })).toBeEnabled());
      expect(api.rejectReview).toHaveBeenCalledTimes(1);
      fireEvent.click(within(reasonDialog).getByRole("button", { name: "取消" }));
    }
    expect(within(drawer).getByText(/组织已切换/)).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "通过并上架" })).not.toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("keeps a failed rejection reason after an emit-less Space change", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(api.rejectReview).mockReturnValueOnce(new Promise<void>((_, fail) => { reject = fail; }));
    const props = { canReview: true, onClose: vi.fn(), onDecided: vi.fn() };
    render(<ReviewDetailDrawer {...props} reviewId="review-1" />);
    await screen.findByText("Planning Team", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "拒绝", exact: true }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Retain on failure" } });
    fireEvent.click(screen.getByRole("button", { name: "确认拒绝" }));
    await act(async () => { WKApp.shared.currentSpaceId = "space-2"; reject(new Error("Old Space failure")); });
    const reasonDialog = screen.getByRole("dialog", { name: "拒绝审核" });
    expect(within(reasonDialog).getByRole("textbox")).toHaveValue("Retain on failure");
    expect(within(reasonDialog).getByText(/组织已切换/)).toBeInTheDocument();
    expect(within(reasonDialog).getByRole("button", { name: "取消" })).toBeEnabled();
    expect(props.onDecided).not.toHaveBeenCalled();
  });

  it("does not submit a loaded review after the current Space silently changes", async () => {
    render(<ReviewDetailDrawer reviewId="review-1" canReview onClose={vi.fn()} onDecided={vi.fn()} />);
    await screen.findByText("Planning Team", { exact: true });
    WKApp.shared.currentSpaceId = "space-2";
    fireEvent.click(screen.getByRole("button", { name: "通过并上架" }));
    expect(api.approveReview).not.toHaveBeenCalled();
    expect(screen.getByText(/组织已切换/)).toBeInTheDocument();
  });

  it("pins the modal options layer while a decision is pending", async () => {
    let resolve!: () => void;
    vi.mocked(api.approveReview).mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    const props = { canReview: true, onClose: vi.fn(), onDecided: vi.fn() };
    render(<ReviewDetailDrawer {...props} reviewId="review-1" />);
    await screen.findByText("Planning Team", { exact: true });
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getAllByRole("button", { name: "关闭" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "通过并上架" }));
    // Built-in X disappears via options; the custom header X stays disabled.
    expect(within(drawer).getAllByRole("button", { name: "关闭" })).toHaveLength(1);
    expect(within(drawer).getByRole("button", { name: "关闭" })).toBeDisabled();
    fireEvent.keyDown(drawer, { key: "Escape" });
    fireEvent.mouseDown(drawer.parentElement!);
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it.each(["success", "failure"] as const)("drops a detail read %s if the Space silently changes before it settles", async (outcome) => {
    let resolve!: (review: ReviewRequest) => void;
    let reject!: (error: Error) => void;
    vi.mocked(api.getReviewRequest).mockReturnValueOnce(new Promise<ReviewRequest>((done, fail) => {
      resolve = done;
      reject = fail;
    }));
    const props = { canReview: true, onClose: vi.fn(), onDecided: vi.fn() };
    render(<ReviewDetailDrawer {...props} reviewId="review-1" />);
    await act(async () => {
      WKApp.shared.currentSpaceId = "space-2";
      if (outcome === "success") resolve(detail());
      else reject(new Error("Old Space load failed"));
    });
    expect(screen.queryByText("Planning Team")).not.toBeInTheDocument();
    expect(screen.getByText(/组织已切换/)).toBeInTheDocument();
    expect(screen.queryByText("Old Space load failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it.each(["success", "failure"] as const)("does not let an old rejection %s disturb a reopened reason dialog", async (outcome) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    let resolveNew!: () => void;
    vi.mocked(api.rejectReview)
      .mockReturnValueOnce(new Promise<void>((done, fail) => { resolve = done; reject = fail; }))
      .mockReturnValueOnce(new Promise<void>((done) => { resolveNew = done; }));
    const props = { canReview: true, onClose: vi.fn(), onDecided: vi.fn() };
    const { rerender } = render(<ReviewDetailDrawer {...props} reviewId="review-1" />);
    const submitReason = async (reason: string) => {
      await screen.findByText("Planning Team", { exact: true });
      fireEvent.click(screen.getByRole("button", { name: "拒绝", exact: true }));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: reason } });
      fireEvent.click(screen.getByRole("button", { name: "确认拒绝" }));
    };
    await submitReason("Old reason");
    rerender(<ReviewDetailDrawer {...props} reviewId={null} />);
    rerender(<ReviewDetailDrawer {...props} reviewId="review-1" />);
    await submitReason("New reason");
    await act(async () => outcome === "success" ? resolve() : reject(new Error("Old failure")));
    const dialog = screen.getByRole("dialog", { name: "拒绝审核" });
    expect(within(dialog).getByRole("textbox")).toHaveValue("New reason");
    expect(within(dialog).getByRole("textbox")).toBeDisabled();
    expect(within(dialog).queryByText("Old failure")).not.toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => resolveNew());
    expect(props.onClose).toHaveBeenCalledOnce();
  });

});
