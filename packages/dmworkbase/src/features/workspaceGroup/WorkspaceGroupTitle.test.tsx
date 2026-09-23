import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
