import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkspaceGroup } from "./useWorkspaceGroup";
import { WorkspaceGroupProvider } from "../../features/workspaceGroup/WorkspaceGroupProvider";
import type { WorkspaceGroupContext, WorkspaceGroupHost, WorkspaceGroupTarget } from "../../features/workspaceGroup/contract";

const context: WorkspaceGroupContext = {
  channelId: "group-a", channelType: 2, projectId: "project-a", projectName: "Workspace A",
  groupName: "Group A", linkedByName: "Evan", source: "linked_existing",
  canOpen: true, canManage: true, isAllMemberGroup: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function createHost() {
  const listeners = new Set<(target: WorkspaceGroupTarget | null) => void>();
  const host: WorkspaceGroupHost = {
    getContext: vi.fn(async () => context),
    open: vi.fn(async () => {}),
    manage: vi.fn(async () => {}),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { host, listeners, notify: (target: WorkspaceGroupTarget | null) => act(() => { listeners.forEach((listener) => listener(target)); }) };
}
function Probe({ id = "group-a", type = 2 }: { id?: string; type?: number }) {
  const result = useWorkspaceGroup(id, type);
  return <div>
    <output data-testid="context">{result.context?.projectName || ""}</output>
    <output data-testid="failure">{result.failure || ""}</output>
    <output data-testid="busy">{result.busy || ""}</output>
    <button onClick={result.open}>open</button><button onClick={result.manage}>manage</button>
    <button onClick={result.refresh}>refresh</button>
  </div>;
}
function element(host: WorkspaceGroupHost | null, id = "group-a", type = 2) {
  return <WorkspaceGroupProvider value={host}><Probe id={id} type={type} /></WorkspaceGroupProvider>;
}
const ready = () => waitFor(() => expect(screen.getByTestId("context")).toHaveTextContent("Workspace A"));

describe("workspace group host data", () => {
  it("has no standalone Web behavior or non-group lookup", () => {
    const { host } = createHost();
    const view = render(element(null));
    expect(screen.getByTestId("context")).toBeEmptyDOMElement();
    view.rerender(element(host, "dm", 1));
    view.rerender(element(host, "thread", 5));
    expect(host.getContext).not.toHaveBeenCalled();
  });

  it("hides unlinked groups and malformed/mismatched relations", async () => {
    const { host } = createHost();
    vi.mocked(host.getContext).mockResolvedValueOnce(null).mockResolvedValueOnce({ ...context, channelId: "other" });
    render(element(host));
    await waitFor(() => expect(host.getContext).toHaveBeenCalledOnce());
    expect(screen.getByTestId("context")).toBeEmptyDOMElement();
    fireEvent.click(screen.getByText("refresh"));
    await waitFor(() => expect(screen.getByTestId("failure")).toHaveTextContent("load"));
    expect(screen.getByTestId("context")).toBeEmptyDOMElement();
  });

  it("does not reveal a delayed old group after changing conversations", async () => {
    const { host } = createHost();
    const old = deferred<WorkspaceGroupContext | null>();
    vi.mocked(host.getContext).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...context, channelId: "group-b", projectName: "Workspace B" });
    const view = render(element(host));
    view.rerender(element(host, "group-b"));
    await waitFor(() => expect(screen.getByTestId("context")).toHaveTextContent("Workspace B"));
    await act(async () => old.resolve(context));
    expect(screen.getByTestId("context")).toHaveTextContent("Workspace B");
  });

  it("invalidates displayed data immediately on host scope changes", async () => {
    const { host, notify } = createHost();
    render(element(host));
    await ready();
    const pending = deferred<WorkspaceGroupContext | null>();
    vi.mocked(host.getContext).mockReturnValueOnce(pending.promise);
    notify(null);
    expect(screen.getByTestId("context")).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(host.open).not.toHaveBeenCalled();
    await act(async () => pending.resolve(null));
  });

  it("refreshes only matching relation events and removes an unlinked entry", async () => {
    const { host, notify } = createHost();
    render(element(host));
    await ready();
    notify({ channelId: "other", channelType: 2 });
    expect(host.getContext).toHaveBeenCalledOnce();
    vi.mocked(host.getContext).mockResolvedValueOnce(null);
    notify({ channelId: "group-a", channelType: 2 });
    await waitFor(() => expect(screen.getByTestId("context")).toBeEmptyDOMElement());
  });

  it("prevents duplicate requests and forwards only group/project identifiers", async () => {
    const { host } = createHost();
    const pending = deferred<void>();
    vi.mocked(host.open).mockReturnValue(pending.promise);
    render(element(host));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(host.open).toHaveBeenCalledExactlyOnceWith({ channelId: "group-a", channelType: 2, projectId: "project-a" });
    await act(async () => pending.resolve());
    expect(screen.getByTestId("busy")).toBeEmptyDOMElement();
  });

  it.each([
    { canOpen: false, canManage: false, isAllMemberGroup: false },
    { canOpen: false, canManage: true, isAllMemberGroup: true },
  ])("guards actions even if invoked outside the disabled UI: %j", async (permissions) => {
    const { host } = createHost();
    vi.mocked(host.getContext).mockResolvedValue({ ...context, ...permissions });
    render(element(host));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(screen.getByRole("button", { name: "manage" }));
    expect(host.open).not.toHaveBeenCalled();
    expect(host.manage).not.toHaveBeenCalled();
  });

  it("exposes action failure without leaking host messages and permits a refreshed retry", async () => {
    const { host } = createHost();
    vi.mocked(host.open).mockRejectedValueOnce(new Error("private host detail"));
    render(element(host));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByTestId("failure")).toHaveTextContent("open"));
    fireEvent.click(screen.getByText("refresh"));
    await waitFor(() => expect(screen.getByTestId("failure")).toBeEmptyDOMElement());
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(host.open).toHaveBeenCalledTimes(2));
  });

  it("cleans up listeners and ignores requests after unmount", async () => {
    const { host, listeners } = createHost();
    const pending = deferred<WorkspaceGroupContext | null>();
    vi.mocked(host.getContext).mockReturnValue(pending.promise);
    const view = render(element(host));
    expect(listeners.size).toBe(1);
    view.unmount();
    expect(listeners.size).toBe(0);
    await act(async () => pending.resolve(context));
    fireEvent(window, new Event("focus"));
    expect(host.getContext).toHaveBeenCalledOnce();
  });
});
