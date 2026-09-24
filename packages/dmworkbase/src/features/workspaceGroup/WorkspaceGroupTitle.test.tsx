import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, I18nProvider } from "../../i18n";
import { WorkspaceGroupTitle } from "./WorkspaceGroupTitle";
import { WorkspaceGroupProvider } from "./WorkspaceGroupProvider";
import type { WorkspaceGroupContext, WorkspaceGroupHost } from "./contract";
import APIClient from "../../Service/APIClient";
import WorkspaceGroupService from "../../Service/WorkspaceGroupService";

vi.mock("../../Service/APIClient", () => ({ default: { shared: { get: vi.fn() } } }));

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

  it("does not reopen a user-closed load error during automatic retries", async () => {
    vi.useFakeTimers();
    const retry = new Promise<WorkspaceGroupContext>(() => {});
    const host: WorkspaceGroupHost = {
      getContext: vi.fn()
        .mockResolvedValueOnce(context)
        .mockRejectedValueOnce(new Error("offline"))
        .mockReturnValueOnce(retry),
      open: vi.fn(), manage: vi.fn(), subscribe: () => () => {},
    };
    render(<I18nProvider><WorkspaceGroupProvider value={host}>
      <WorkspaceGroupTitle channelId="group-a" channelType={2}>Group A</WorkspaceGroupTitle>
      <input aria-label="Message composer" />
    </WorkspaceGroupProvider></I18nProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    fireEvent(window, new Event("focus"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole("dialog", { name: "Workspace relation" })).toBeVisible();
    const disclosure = screen.getByRole("button", { name: "View and manage workspace relation" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(disclosure).toHaveAttribute("aria-expanded", "false");

    const composer = screen.getByRole("textbox", { name: "Message composer" });
    composer.focus();
    expect(composer).toHaveFocus();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(host.getContext).toHaveBeenCalledTimes(3);
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(composer).toHaveFocus();
  });

  it.each(["en-US", "zh-CN"] as const)(
    "keeps a real inaccessible relation visible without automatic retries in %s", async locale => {
      vi.useFakeTimers();
      i18n.setLocale(locale, { persist: false });
      let accessible = false;
      vi.mocked(APIClient.shared.get).mockReset().mockImplementation(async path => {
        if (path === "groups/group-a") return { group_no: "group-a", name: "Group A", role: 1 };
        if (path === "groups/group-a/project") {
          return { group_no: "group-a", name: "Group A", project_id: "project-a", linked_by: null };
        }
        if (path === "projects/project-a") {
          if (!accessible) throw { status: 403 };
          return { project_id: "project-a", name: "Workspace A", my_role: 0 };
        }
        throw new Error(`Unexpected request: ${path}`);
      });
      const host: WorkspaceGroupHost = {
        getContext: vi.fn((target, signal) => WorkspaceGroupService.getContext(
          target, { spaceId: "space-a", signal, assertCurrent: () => {} },
        )),
        open: vi.fn(), manage: vi.fn(), subscribe: () => () => {},
      };
      render(<I18nProvider><WorkspaceGroupProvider value={host}>
        <WorkspaceGroupTitle channelId="group-a" channelType={2}>Group A</WorkspaceGroupTitle>
      </WorkspaceGroupProvider></I18nProvider>);
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      const unavailable = i18n.t("base.workspaceGroup.workspaceUnavailable");
      const jump = screen.getByRole("button", {
        name: i18n.t("base.workspaceGroup.open", { values: { name: unavailable } }),
      });
      expect(jump).toBeDisabled();
      expect(jump).toHaveTextContent(unavailable);
      expect(screen.getByText("Group A")).toBeVisible();
      expect(host.getContext).toHaveBeenCalledOnce();
      fireEvent.click(jump);
      expect(host.open).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: i18n.t("base.workspaceGroup.details") }));
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(screen.getByRole("heading", { name: unavailable })).toBeVisible();
      expect(screen.getByText(i18n.t("base.workspaceGroup.permissionUnavailable"))).toBeVisible();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: i18n.t("base.workspaceGroup.manage") })).toBeNull();

      accessible = true;
      fireEvent(window, new Event("focus"));
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(screen.getByRole("button", {
        name: i18n.t("base.workspaceGroup.open", { values: { name: "Workspace A" } }),
      })).toBeEnabled();
      expect(host.getContext).toHaveBeenCalledTimes(2);
    },
  );
});
