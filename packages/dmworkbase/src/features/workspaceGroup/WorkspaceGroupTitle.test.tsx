import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, I18nProvider } from "../../i18n";
import { WorkspaceGroupTitle } from "./WorkspaceGroupTitle";
import { WorkspaceGroupProvider } from "./WorkspaceGroupProvider";
import type { WorkspaceGroupContext, WorkspaceGroupHost } from "./contract";

const context: WorkspaceGroupContext = {
  channelId: "group-a", channelType: 2, projectId: "project-a", projectName: "Workspace A",
  groupName: "Group A", linkedByName: "Evan", source: "linked_existing",
  canOpen: true, canManage: true, isAllMemberGroup: false,
};

describe("WorkspaceGroupTitle", () => {
  beforeEach(() => i18n.setLocale("en-US", { persist: false }));
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("does not flash workspace loading in a fast unlinked group, including focus refresh", async () => {
    vi.useFakeTimers();
    const host: WorkspaceGroupHost = {
      getContext: vi.fn().mockResolvedValue(null),
      open: vi.fn(), manage: vi.fn(), subscribe: () => () => {},
    };
    render(<I18nProvider><WorkspaceGroupProvider value={host}>
      <WorkspaceGroupTitle channelId="group-a" channelType={2}>Group A</WorkspaceGroupTitle>
    </WorkspaceGroupProvider></I18nProvider>);
    expect(screen.queryByRole("button")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent(window, new Event("focus"));
    expect(screen.queryByRole("button")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows recovery for a slow initial read after a short delay", async () => {
    vi.useFakeTimers();
    const host: WorkspaceGroupHost = {
      getContext: vi.fn(() => new Promise(() => {})),
      open: vi.fn(), manage: vi.fn(), subscribe: () => () => {},
    };
    render(<I18nProvider><WorkspaceGroupProvider value={host}>
      <WorkspaceGroupTitle channelId="group-a" channelType={2}>Group A</WorkspaceGroupTitle>
    </WorkspaceGroupProvider></I18nProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(399); });
    expect(screen.queryByRole("button")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows a recoverable initial error instead of silently hiding the workspace entry", async () => {
    let resolve!: (value: WorkspaceGroupContext) => void;
    const pending = new Promise<WorkspaceGroupContext>(done => { resolve = done; });
    const host: WorkspaceGroupHost = {
      getContext: vi.fn().mockRejectedValueOnce(new Error("private server error")).mockReturnValueOnce(pending),
      open: vi.fn(), manage: vi.fn(), subscribe: () => () => {},
    };
    render(<I18nProvider><WorkspaceGroupProvider value={host}>
      <WorkspaceGroupTitle channelId="group-a" channelType={2}>Group A</WorkspaceGroupTitle>
    </WorkspaceGroupProvider></I18nProvider>);
    const retry = await screen.findByRole("button", { name: /Unable to update the relation.*Retry/ });
    expect(screen.getByText("Group A")).toBeVisible();
    expect(screen.queryByText("private server error")).toBeNull();
    fireEvent.click(retry);
    await act(async () => resolve(context));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open workspace: Workspace A" })).toBeEnabled());
  });
});
