import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceGroup } from "./useWorkspaceGroup";
import { WorkspaceGroupProvider } from "../../features/workspaceGroup/WorkspaceGroupProvider";
import { WorkspaceGroupReadUnavailable, type WorkspaceGroupContext, type WorkspaceGroupHost, type WorkspaceGroupTarget } from "../../features/workspaceGroup/contract";

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
    <output data-testid="refreshing">{String(result.refreshing)}</output>
    <button onClick={result.open}>open</button><button onClick={result.manage}>manage</button>
    <button onClick={result.refresh}>refresh</button>
  </div>;
}
function element(host: WorkspaceGroupHost | null, id = "group-a", type = 2) {
  return <WorkspaceGroupProvider value={host}><Probe id={id} type={type} /></WorkspaceGroupProvider>;
}
const ready = () => waitFor(() => expect(screen.getByTestId("context")).toHaveTextContent("Workspace A"));
const flushPromises = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});
const advance = (milliseconds: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(milliseconds);
});

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
    await waitFor(() => expect(screen.getByTestId("refreshing")).toHaveTextContent("false"));
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

  it("passes the resolved actor to native management without forwarding permissions or session data", async () => {
    const { host } = createHost();
    vi.mocked(host.getContext).mockResolvedValue({ ...context, linkedBy: "user-2" });
    render(element(host));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "manage" }));
    expect(host.manage).toHaveBeenCalledExactlyOnceWith({
      channelId: "group-a", channelType: 2, projectId: "project-a",
      presentation: { linkedBy: "user-2", linkedByName: "Evan" },
    });
    await waitFor(() => expect(screen.getByTestId("busy")).toBeEmptyDOMElement());
  });

  it.each([
    { linkedBy: undefined, linkedByName: "Evan" },
    { linkedBy: "user-2", linkedByName: "" },
    { linkedBy: "user-2", linkedByName: "  " },
  ])("omits incomplete actor presentation: %j", async (actor) => {
    const { host } = createHost();
    vi.mocked(host.getContext).mockResolvedValue({ ...context, ...actor });
    render(element(host));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "manage" }));
    expect(host.manage).toHaveBeenCalledExactlyOnceWith({
      channelId: "group-a", channelType: 2, projectId: "project-a",
    });
    await waitFor(() => expect(screen.getByTestId("busy")).toBeEmptyDOMElement());
  });

  it("uses the newly selected group's actor instead of a previous group's name", async () => {
    const { host } = createHost();
    vi.mocked(host.getContext)
      .mockResolvedValueOnce({ ...context, linkedBy: "user-2" })
      .mockResolvedValue({ ...context, channelId: "group-b", linkedBy: "user-3", linkedByName: "Alice" });
    const view = render(element(host));
    await ready();
    view.rerender(element(host, "group-b"));
    await waitFor(() => expect(host.getContext).toHaveBeenCalledWith({ channelId: "group-b", channelType: 2 }, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getByTestId("refreshing")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "manage" }));
    expect(host.manage).toHaveBeenCalledExactlyOnceWith({
      channelId: "group-b", channelType: 2, projectId: "project-a",
      presentation: { linkedBy: "user-3", linkedByName: "Alice" },
    });
    await waitFor(() => expect(screen.getByTestId("busy")).toBeEmptyDOMElement());
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
    await waitFor(() => expect(screen.getByTestId("busy")).toBeEmptyDOMElement());
    fireEvent.click(screen.getByText("refresh"));
    await waitFor(() => expect(screen.getByTestId("failure")).toBeEmptyDOMElement());
    await waitFor(() => expect(screen.getByTestId("refreshing")).toHaveTextContent("false"));
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

describe("workspace group host reliability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("recovers from an initial load failure with bounded backoff", async () => {
    const { host } = createHost();
    vi.mocked(host.getContext)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(context);

    render(element(host));
    await flushPromises();
    expect(host.getContext).toHaveBeenCalledOnce();
    expect(screen.getByTestId("failure")).toHaveTextContent("load");
    expect(screen.getByTestId("context")).toBeEmptyDOMElement();

    await advance(999);
    expect(host.getContext).toHaveBeenCalledOnce();
    await advance(1);
    expect(host.getContext).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("context")).toHaveTextContent("Workspace A");
    expect(screen.getByTestId("failure")).toBeEmptyDOMElement();
  });

  it("stops after three retries", async () => {
    const { host } = createHost();
    vi.mocked(host.getContext).mockRejectedValue(new Error("offline"));

    render(element(host));
    await flushPromises();
    await advance(1_000);
    await advance(2_000);
    await advance(4_000);
    expect(host.getContext).toHaveBeenCalledTimes(4);

    await advance(30_000);
    expect(host.getContext).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId("failure")).toHaveTextContent("load");
  });

  it("does not reset the retry budget when focus arrives during a failing request or backoff", async () => {
    const { host } = createHost();
    const second = deferred<WorkspaceGroupContext | null>();
    vi.mocked(host.getContext)
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => second.promise.then(() => { throw new Error("offline"); }))
      .mockRejectedValue(new Error("offline"));
    render(element(host));
    await flushPromises();
    fireEvent(window, new Event("focus"));
    expect(host.getContext).toHaveBeenCalledOnce();
    await advance(1_000);
    fireEvent(window, new Event("focus"));
    fireEvent.click(screen.getByText("refresh"));
    await act(async () => second.resolve(null));
    await advance(1_000);
    expect(host.getContext).toHaveBeenCalledTimes(2);
    await advance(1_000);
    expect(host.getContext).toHaveBeenCalledTimes(3);
    await advance(4_000);
    expect(host.getContext).toHaveBeenCalledTimes(4);
    fireEvent(window, new Event("focus"));
    await advance(30_000);
    expect(host.getContext).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByText("refresh"));
    await flushPromises();
    expect(host.getContext).toHaveBeenCalledTimes(5);
  });

  it.each(["inactive", "session"] as const)("waits quietly for %s lifecycle readiness without retries", async (reason) => {
    const { host, notify } = createHost();
    vi.mocked(host.getContext).mockRejectedValueOnce(new WorkspaceGroupReadUnavailable(reason)).mockResolvedValue(context);
    render(element(host));
    await flushPromises();
    expect(screen.getByTestId("context")).toBeEmptyDOMElement();
    expect(screen.getByTestId("failure")).toBeEmptyDOMElement();
    expect(screen.getByTestId("refreshing")).toHaveTextContent("false");
    await advance(30_000);
    expect(host.getContext).toHaveBeenCalledOnce();
    notify(null);
    await flushPromises();
    expect(screen.getByTestId("context")).toHaveTextContent("Workspace A");
  });

  it("clears invalidated data and recovers a silent session change without focus", async () => {
    const { host } = createHost();
    vi.mocked(host.getContext)
      .mockResolvedValueOnce(context)
      .mockRejectedValueOnce(new WorkspaceGroupReadUnavailable("scope"))
      .mockResolvedValueOnce({ ...context, projectName: "New session workspace" });
    render(element(host));
    await flushPromises();
    fireEvent.click(screen.getByText("refresh"));
    await flushPromises();
    expect(screen.getByTestId("context")).toBeEmptyDOMElement();
    expect(screen.getByTestId("failure")).toBeEmptyDOMElement();
    fireEvent.click(screen.getByText("manage"));
    expect(host.manage).not.toHaveBeenCalled();
    await advance(1_000);
    expect(screen.getByTestId("context")).toHaveTextContent("New session workspace");
  });

  it("exposes manual recovery when repeated scope changes exhaust the quiet retries", async () => {
    const { host } = createHost();
    vi.mocked(host.getContext).mockRejectedValue(new WorkspaceGroupReadUnavailable("scope"));
    render(element(host));
    await flushPromises();
    await advance(60_000);
    expect(host.getContext).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId("failure")).toHaveTextContent("load");
    fireEvent(window, new Event("focus"));
    await flushPromises();
    expect(host.getContext).toHaveBeenCalledTimes(4);
    vi.mocked(host.getContext).mockResolvedValue(context);
    fireEvent.click(screen.getByText("refresh"));
    await flushPromises();
    expect(screen.getByTestId("context")).toHaveTextContent("Workspace A");
    expect(screen.getByTestId("failure")).toBeEmptyDOMElement();
  });

  it("retains prior same-scope context through a transient error", async () => {
    const { host } = createHost();
    vi.mocked(host.getContext).mockResolvedValueOnce(context).mockRejectedValueOnce(new Error("offline"));

    render(element(host));
    await flushPromises();
    expect(screen.getByTestId("context")).toHaveTextContent("Workspace A");

    fireEvent.click(screen.getByText("refresh"));
    await flushPromises();
    expect(screen.getByTestId("failure")).toHaveTextContent("load");
    expect(screen.getByTestId("context")).toHaveTextContent("Workspace A");
    expect(screen.getByTestId("refreshing")).toHaveTextContent("false");
  });

  it("keeps the load failure sticky while automatic retries are running", async () => {
    const { host } = createHost();
    const retry = deferred<WorkspaceGroupContext | null>();
    vi.mocked(host.getContext)
      .mockResolvedValueOnce(context)
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(retry.promise);

    render(element(host));
    await flushPromises();
    fireEvent(window, new Event("focus"));
    await flushPromises();
    expect(screen.getByTestId("failure")).toHaveTextContent("load");

    await advance(1_000);
    expect(host.getContext).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("refreshing")).toHaveTextContent("true");
    expect(screen.getByTestId("failure")).toHaveTextContent("load");

    await act(async () => retry.resolve(context));
    await flushPromises();
    expect(screen.getByTestId("failure")).toBeEmptyDOMElement();
    expect(screen.getByTestId("refreshing")).toHaveTextContent("false");
  });

  it("does not retry an authoritative null relation", async () => {
    const { host } = createHost();
    vi.mocked(host.getContext).mockResolvedValue(null);

    render(element(host));
    await flushPromises();
    expect(host.getContext).toHaveBeenCalledOnce();
    expect(screen.getByTestId("context")).toBeEmptyDOMElement();
    expect(screen.getByTestId("failure")).toBeEmptyDOMElement();

    await advance(30_000);
    expect(host.getContext).toHaveBeenCalledOnce();
  });

  it("resets retry backoff on an external refresh", async () => {
    const { host } = createHost();
    vi.mocked(host.getContext)
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(context);

    render(element(host));
    await flushPromises();
    await advance(500);
    fireEvent.click(screen.getByText("refresh"));
    await flushPromises();
    expect(host.getContext).toHaveBeenCalledTimes(2);

    await advance(999);
    expect(host.getContext).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(host.getContext).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("context")).toHaveTextContent("Workspace A");
  });

  it("times out a pending request and ignores its late result", async () => {
    const { host } = createHost();
    const late = deferred<WorkspaceGroupContext | null>();
    vi.mocked(host.getContext)
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(context);

    render(element(host));
    await flushPromises();
    const signal = vi.mocked(host.getContext).mock.calls[0][1]!;
    await advance(19_999);
    expect(signal.aborted).toBe(false);
    expect(screen.getByTestId("failure")).toBeEmptyDOMElement();

    await advance(1);
    expect(signal.aborted).toBe(true);
    expect(screen.getByTestId("failure")).toHaveTextContent("load");
    expect(screen.getByTestId("context")).toBeEmptyDOMElement();

    await act(async () => late.resolve({ ...context, projectName: "Late result" }));
    await flushPromises();
    expect(screen.getByTestId("context")).toBeEmptyDOMElement();

    await advance(1_000);
    expect(host.getContext).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("context")).toHaveTextContent("Workspace A");
  });

  it("coalesces refresh bursts and queues one relation follow-up", async () => {
    const { host, notify } = createHost();
    const second = deferred<WorkspaceGroupContext | null>();
    vi.mocked(host.getContext)
      .mockResolvedValueOnce(context)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce(null);

    render(element(host));
    await flushPromises();
    fireEvent.click(screen.getByText("refresh"));
    expect(host.getContext).toHaveBeenCalledTimes(2);

    fireEvent(window, new Event("focus"));
    fireEvent(window, new Event("focus"));
    fireEvent.click(screen.getByText("refresh"));
    notify({ channelId: "group-a", channelType: 2 });
    notify({ channelId: "group-a", channelType: 2 });
    expect(host.getContext).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve(context));
    await flushPromises();
    expect(host.getContext).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("context")).toBeEmptyDOMElement();

    await advance(30_000);
    expect(host.getContext).toHaveBeenCalledTimes(3);
  });

  it("cancels pending timers and ignores results after unmount", async () => {
    const { host, listeners } = createHost();
    const pending = deferred<WorkspaceGroupContext | null>();
    vi.mocked(host.getContext).mockReturnValue(pending.promise);

    const view = render(element(host));
    await flushPromises();
    fireEvent(window, new Event("focus"));
    view.unmount();
    expect(vi.mocked(host.getContext).mock.calls[0][1]?.aborted).toBe(true);
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => pending.resolve(context));
    await flushPromises();
    fireEvent(window, new Event("focus"));
    await advance(30_000);
    expect(host.getContext).toHaveBeenCalledOnce();
  });

  it("cancels the old scope request and ignores its late result", async () => {
    const { host } = createHost();
    const oldScope = deferred<WorkspaceGroupContext | null>();
    vi.mocked(host.getContext)
      .mockReturnValueOnce(oldScope.promise)
      .mockResolvedValueOnce({ ...context, channelId: "group-b", projectName: "Workspace B" });

    const view = render(element(host));
    await flushPromises();
    view.rerender(element(host, "group-b"));
    expect(vi.mocked(host.getContext).mock.calls[0][1]?.aborted).toBe(true);
    await flushPromises();
    expect(screen.getByTestId("context")).toHaveTextContent("Workspace B");

    await act(async () => oldScope.resolve(context));
    await flushPromises();
    await advance(30_000);
    expect(host.getContext).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("context")).toHaveTextContent("Workspace B");
  });
});
