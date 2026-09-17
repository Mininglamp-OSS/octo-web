import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WKApp } from "@octo/base";
import * as api from "../../api/summaryApi";
import SummaryListPage from "../SummaryListPage";
import { TaskStatus, type ListSummariesResponse, type SummaryListItem } from "../../types/summary";
import { summaryTestIds } from "../../utils/testIds";

vi.mock("@douyinfe/semi-ui", () => {
    const Dropdown = Object.assign(({ children }: any) => <>{children}</>, {
        Menu: () => null,
        Item: () => null,
    });
    return {
        Dropdown,
        Button: () => null,
        Spin: () => <div data-testid="spinner" />,
        Banner: ({ description }: any) => <div role="alert">{description}</div>,
        Toast: { success: vi.fn(), error: vi.fn() },
    };
});
vi.mock("../../components/SummaryCard", () => ({
    default: ({ task }: { task: SummaryListItem }) => (
        <div data-testid={`task-${task.task_id}`} data-unread={task.is_unread}>
            {task.topic}
        </div>
    ),
}));
vi.mock("../../features/summaryWorkbench/Entry", () => ({
    default: ({ renderNew }: any) => renderNew(),
}));
vi.mock("../../features/summaryWorkbench/SummaryWorkbenchCreateEntry", () => ({ default: () => null }));
vi.mock("../SummaryCreatePage", () => ({ default: () => null }));
vi.mock("../SummaryDetailPage", () => ({ default: () => null }));
vi.mock("../../api/summaryApi");

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function rows(start: number, count = 20, prefix = "old"): SummaryListItem[] {
    return Array.from({ length: count }, (_, index) => ({
        task_id: start + index,
        topic: `${prefix}-${start + index}`,
        status: TaskStatus.COMPLETED,
        is_unread: true,
        needs_attention: true,
    } as SummaryListItem));
}

function response(items: SummaryListItem[], total = 80): ListSummariesResponse {
    return { items, total, attention_count: 0, unread_count: 0, pending_invitation_count: 0 };
}

async function mountList(initial = response(rows(1))) {
    vi.mocked(api.listSummaries).mockResolvedValueOnce(initial);
    const ref = React.createRef<SummaryListPage>();
    const view = render(<SummaryListPage ref={ref} embedded backgroundRefreshKey={0} />);
    await act(async () => {});
    return {
        ref,
        view,
        activate: async (key = 1) => {
            await act(async () => {
                view.rerender(<SummaryListPage ref={ref} embedded backgroundRefreshKey={key} />);
            });
        },
        loadMore: async (items = rows(21)) => {
            vi.mocked(api.listSummaries).mockResolvedValueOnce(response(items, initial.total));
            await act(async () => { await ref.current!.loadMore(); });
        },
    };
}

async function mountDeepList() {
    const list = await mountList(response(rows(1), 240));
    for (let start = 21; start <= 101; start += 20) await list.loadMore(rows(start));
    return list;
}

describe("SummaryListPage retained activation refresh", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        WKApp.shared.currentSpaceId = "space-123";
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it("keeps the scroll container mounted and refreshes the loaded prefix in one request", async () => {
        const { ref, activate, loadMore } = await mountList();
        await loadMore();
        const content = screen.getByTestId(summaryTestIds.listContent);
        content.scrollTop = 450;
        const refresh = deferred<ListSummariesResponse>();
        vi.mocked(api.listSummaries).mockReturnValueOnce(refresh.promise);

        await activate();
        expect(api.listSummaries).toHaveBeenCalledTimes(3);
        expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
        expect(screen.getByTestId(summaryTestIds.listContent)).toBe(content);
        expect(api.listSummaries).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 40 }));
        expect(screen.getByTestId("task-1")).toHaveTextContent("old-1");
        await act(async () => { refresh.resolve(response(rows(1, 40, "fresh"))); });

        expect(screen.getByTestId(summaryTestIds.listContent)).toBe(content);
        expect(content.scrollTop).toBe(450);
        expect(screen.getByTestId("task-1")).toHaveTextContent("fresh-1");
        expect(screen.getByTestId("task-40")).toHaveTextContent("fresh-40");
        expect(ref.current!.state.page).toBe(2);
        await loadMore(rows(41));
        expect(api.listSummaries).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3, page_size: 20 }));
    });

    it("keeps the complete cached range and cursor if the bounded refresh fails", async () => {
        const { ref, activate, loadMore } = await mountDeepList();
        const cached = ref.current!.state.items;
        vi.mocked(api.listSummaries).mockRejectedValueOnce(new Error("offline"));
        await activate();
        expect(api.listSummaries).toHaveBeenCalledTimes(7);
        expect(ref.current!.state.items).toBe(cached);
        expect(ref.current!.state).toMatchObject({ page: 6, loading: false, hasMore: true, error: null });
        await loadMore(rows(121));
        expect(api.listSummaries).toHaveBeenLastCalledWith(expect.objectContaining({ page: 7 }));
    });

    it("shrinks the retained prefix when the server now has fewer pages", async () => {
        const { ref, activate, loadMore } = await mountList();
        await loadMore();
        vi.mocked(api.listSummaries).mockResolvedValueOnce(response(rows(5, 6, "remaining"), 6));
        await activate();
        expect(ref.current!.state).toMatchObject({ page: 1, total: 6, hasMore: false });
        expect(ref.current!.state.items).toHaveLength(6);
        expect(screen.queryByTestId("task-1")).not.toBeInTheDocument();
        expect(api.listSummaries).toHaveBeenCalledTimes(3);
    });

    it("waits for the initial foreground load and preserves it if the queued activation fails", async () => {
        const initial = deferred<ListSummariesResponse>();
        vi.mocked(api.listSummaries)
            .mockReturnValueOnce(initial.promise)
            .mockRejectedValueOnce(new Error("offline"));
        const ref = React.createRef<SummaryListPage>();
        const view = render(<SummaryListPage ref={ref} embedded backgroundRefreshKey={0} />);
        view.rerender(<SummaryListPage ref={ref} embedded backgroundRefreshKey={1} />);
        expect(api.listSummaries).toHaveBeenCalledTimes(1);
        await act(async () => { initial.resolve(response(rows(1))); });
        expect(api.listSummaries).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId("task-1")).toHaveTextContent("old-1");
        expect(ref.current!.state).toMatchObject({ loading: false, error: null });
    });

    it("waits for an in-flight loadMore and refreshes the resulting depth", async () => {
        const { ref, activate } = await mountList();
        const next = deferred<ListSummariesResponse>();
        vi.mocked(api.listSummaries)
            .mockReturnValueOnce(next.promise)
            .mockResolvedValueOnce(response(rows(1, 40, "fresh")));
        act(() => { void ref.current!.loadMore(); });
        await activate();
        expect(api.listSummaries).toHaveBeenCalledTimes(2);
        await act(async () => { next.resolve(response(rows(21))); });
        expect(api.listSummaries).toHaveBeenCalledTimes(3);
        expect(ref.current!.state).toMatchObject({ page: 2, loadingMore: false });
        expect(screen.getByTestId("task-40")).toHaveTextContent("fresh-40");
    });

    it("retains read updates while accepting fresh titles from an older activation snapshot", async () => {
        const { activate } = await mountList();
        const refresh = deferred<ListSummariesResponse>();
        vi.mocked(api.listSummaries).mockReturnValueOnce(refresh.promise);
        await activate();
        expect(api.listSummaries).toHaveBeenCalledTimes(2);
        act(() => {
            window.dispatchEvent(new CustomEvent("summary-read", {
                detail: { taskId: 1, isUnread: false, needsAttention: false },
            }));
        });
        await act(async () => { refresh.resolve(response(rows(1, 20, "fresh"))); });
        expect(screen.getByTestId("task-1")).toHaveAttribute("data-unread", "false");
        expect(screen.getByTestId("task-1")).toHaveTextContent("fresh-1");
        expect(screen.getByTestId("task-2")).toHaveAttribute("data-unread", "true");
    });

    it("keeps explicit workspace refreshes as foreground page-one loads", async () => {
        const { ref, view, loadMore } = await mountList();
        await loadMore();
        const refresh = deferred<ListSummariesResponse>();
        vi.mocked(api.listSummaries).mockReturnValueOnce(refresh.promise);
        view.rerender(<SummaryListPage ref={ref} embedded backgroundRefreshKey={0} refreshKey={1} />);
        expect(screen.getByTestId("spinner")).toBeInTheDocument();
        await act(async () => { refresh.resolve(response(rows(100))); });
        expect(ref.current!.state.page).toBe(1);
        expect(ref.current!.state.items).toHaveLength(20);
    });

    it("does not commit an activation response after a filter change", async () => {
        const { ref, activate } = await mountList();
        const stale = deferred<ListSummariesResponse>();
        vi.mocked(api.listSummaries)
            .mockReturnValueOnce(stale.promise)
            .mockResolvedValueOnce(response(rows(50, 1, "filtered"), 1));
        await activate();
        expect(api.listSummaries).toHaveBeenCalledTimes(2);
        await act(async () => { ref.current!.handleStatusChange(TaskStatus.FAILED); });
        await act(async () => { stale.resolve(response(rows(1, 20, "stale"))); });
        expect(ref.current!.state.items[0].topic).toBe("filtered-50");
        expect(ref.current!.state.loading).toBe(false);
    });

    it("coalesces activations during a request and keeps its successful snapshot if the trailing refresh fails", async () => {
        const { ref, activate } = await mountList();
        const first = deferred<ListSummariesResponse>();
        vi.mocked(api.listSummaries)
            .mockReturnValueOnce(first.promise)
            .mockRejectedValueOnce(new Error("offline"));
        await activate();
        await activate(2);
        await activate(3);
        expect(api.listSummaries).toHaveBeenCalledTimes(2);
        await act(async () => { first.resolve(response(rows(1, 20, "fresh"))); });
        expect(api.listSummaries).toHaveBeenCalledTimes(3);
        expect(screen.getByTestId("task-1")).toHaveTextContent("fresh-1");
        expect(ref.current!.state).toMatchObject({ loading: false, error: null });
    });

    it("does not discard the queued activation when the initial load fails", async () => {
        const initial = deferred<ListSummariesResponse>();
        vi.mocked(api.listSummaries)
            .mockReturnValueOnce(initial.promise)
            .mockResolvedValueOnce(response(rows(1)));
        const ref = React.createRef<SummaryListPage>();
        const view = render(<SummaryListPage ref={ref} embedded backgroundRefreshKey={0} />);
        view.rerender(<SummaryListPage ref={ref} embedded backgroundRefreshKey={1} />);
        await act(async () => { initial.reject(new Error("offline")); });
        expect(api.listSummaries).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId("task-1")).toBeInTheDocument();
        expect(ref.current!.state).toMatchObject({ loading: false, error: null });
    });

    it("does not allow scroll to issue a loadMore request during a retained refresh", async () => {
        const { ref, activate } = await mountList();
        const refresh = deferred<ListSummariesResponse>();
        vi.mocked(api.listSummaries).mockReturnValueOnce(refresh.promise);
        await activate();
        await act(async () => { await ref.current!.loadMore(); });
        expect(api.listSummaries).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
        await act(async () => { refresh.resolve(response(rows(1))); });
    });

    it("retains every row through activation and the final loadMore", async () => {
        const { ref, activate, loadMore } = await mountList();
        await loadMore();
        vi.mocked(api.listSummaries).mockResolvedValueOnce(response(rows(1, 40), 60));
        await activate();
        expect(ref.current!.state.items).toHaveLength(40);
        expect(ref.current!.state).toMatchObject({ page: 2, hasMore: true });
        vi.mocked(api.listSummaries).mockResolvedValueOnce(response(rows(41), 60));
        await act(async () => { await ref.current!.loadMore(); });
        expect(api.listSummaries).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
        expect(ref.current!.state.items.map((item) => item.task_id)).toEqual(rows(1, 60).map((item) => item.task_id));
        expect(screen.getByTestId("task-40")).toBeInTheDocument();
        expect(ref.current!.state.hasMore).toBe(false);
    });

    it("repairs an overlapping next page before advancing and reaches all 60 rows", async () => {
        const { ref } = await mountList(response(rows(1), 60));
        const content = screen.getByTestId(summaryTestIds.listContent);
        content.scrollTop = 250;
        vi.mocked(api.listSummaries)
            .mockResolvedValueOnce(response(rows(20), 60))
            .mockResolvedValueOnce(response(rows(1, 40, "fresh"), 60));
        await act(async () => { await ref.current!.loadMore(); });
        expect(api.listSummaries).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 40 }));
        expect(ref.current!.state).toMatchObject({ page: 2, total: 60, hasMore: true, loadingMore: false });
        expect(ref.current!.state.items.map((item) => item.task_id)).toEqual(rows(1, 40).map((item) => item.task_id));
        expect(screen.getAllByTestId("task-20")).toHaveLength(1);
        expect(screen.getByTestId(summaryTestIds.listContent)).toBe(content);
        expect(content.scrollTop).toBe(250);

        vi.mocked(api.listSummaries).mockResolvedValueOnce(response(rows(41), 60));
        await act(async () => { await ref.current!.loadMore(); });
        expect(ref.current!.state.items.map((item) => item.task_id)).toEqual(rows(1, 60).map((item) => item.task_id));
        expect(ref.current!.state.hasMore).toBe(false);
    });

    it("bounds a deep activation to 100 rows and keeps the remaining rows reachable", async () => {
        const { ref, activate } = await mountDeepList();
        const server = rows(1, 160, "fresh");
        vi.mocked(api.listSummaries)
            .mockImplementation(async ({ page = 1, page_size = 20 }) =>
                response(server.slice((page - 1) * page_size, page * page_size), server.length));
        await activate();
        expect(api.listSummaries).toHaveBeenCalledTimes(7);
        expect(api.listSummaries).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 100 }));
        expect(ref.current!.state.items).toHaveLength(100);
        expect(ref.current!.state).toMatchObject({ page: 5, total: 160, hasMore: true });
        await act(async () => { await ref.current!.loadMore(); });
        await act(async () => { await ref.current!.loadMore(); });
        await act(async () => { await ref.current!.loadMore(); });
        expect(ref.current!.state.items.map((item) => item.task_id)).toEqual(server.map((item) => item.task_id));
        expect(ref.current!.state).toMatchObject({ page: 8, hasMore: false });
        expect(screen.getByTestId("task-101")).toHaveTextContent("fresh-101");
    });

    it("also bounds a channel list activation to one 100-row request", async () => {
        vi.mocked(api.listSummaries).mockImplementation(async ({ page = 1, page_size = 50 }) =>
            response(rows((page - 1) * page_size + 1, page_size), 500));
        const ref = React.createRef<SummaryListPage>();
        const view = render(<SummaryListPage ref={ref} channelId="channel" embedded backgroundRefreshKey={0} />);
        await act(async () => {});
        for (let page = 2; page <= 5; page += 1) {
            await act(async () => { await ref.current!.loadMore(); });
        }
        expect(ref.current!.state.items).toHaveLength(250);
        vi.mocked(api.listSummaries).mockClear();
        await act(async () => {
            view.rerender(<SummaryListPage ref={ref} channelId="channel" embedded backgroundRefreshKey={1} />);
        });
        expect(api.listSummaries).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            page: 1, page_size: 100, origin_channel_id: "channel",
        }));
        expect(ref.current!.state).toMatchObject({ page: 2, hasMore: true });
        await act(async () => { await ref.current!.loadMore(); });
        expect(api.listSummaries).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3, page_size: 50 }));
        expect(ref.current!.state.items).toHaveLength(150);
    });

    it.each(["insert", "delete"] as const)(
        "rebuilds the loaded prefix after a server-side %s without losing boundary rows",
        async (change) => {
            const { ref } = await mountList(response(rows(1), 60));
            const server = change === "insert" ? rows(0, 61) : rows(2, 59);
            vi.mocked(api.listSummaries).mockImplementation(async ({ page = 1, page_size = 20 }) =>
                response(server.slice((page - 1) * page_size, page * page_size), server.length));
            for (let attempt = 0; attempt < 4 && ref.current!.state.hasMore; attempt += 1) {
                await act(async () => { await ref.current!.loadMore(); });
            }
            expect(ref.current!.state.items.map((item) => item.task_id)).toEqual(server.map((item) => item.task_id));
            expect(ref.current!.state).toMatchObject({ total: server.length, hasMore: false, loadingMore: false });
        },
    );

    it("shows a retry hint after persistent drift and throttles repeated scroll retries", async () => {
        const clock = vi.spyOn(Date, "now").mockReturnValue(10000);
        const { ref } = await mountList(response(rows(1), 60));
        const cached = ref.current!.state.items;
        vi.mocked(api.listSummaries)
            .mockResolvedValueOnce(response(rows(20), 60))
            .mockResolvedValue(response([...rows(1, 39), ...rows(20, 1)], 60));
        await act(async () => { await ref.current!.loadMore(); });
        expect(api.listSummaries).toHaveBeenCalledTimes(5);
        expect(ref.current!.state.items).toBe(cached);
        expect(ref.current!.state).toMatchObject({ page: 1, total: 60, hasMore: true, loadingMore: false });
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect((ref.current as any).pendingReadPatches.size).toBe(0);
        await act(async () => { await ref.current!.loadMore(); });
        expect(api.listSummaries).toHaveBeenCalledTimes(5);
        clock.mockReturnValue(13000);
        vi.mocked(api.listSummaries).mockResolvedValueOnce(response(rows(21), 60));
        await act(async () => { await ref.current!.loadMore(); });
        expect(api.listSummaries).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, page_size: 20 }));
        expect(ref.current!.state.items).toHaveLength(40);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("lets an explicit retry bypass the scroll cooldown after a transport failure", async () => {
        vi.spyOn(Date, "now").mockReturnValue(10000);
        const { ref } = await mountList(response(rows(1), 60));
        vi.mocked(api.listSummaries).mockRejectedValueOnce(new Error("offline"));
        await act(async () => { await ref.current!.loadMore(); });
        await act(async () => { await ref.current!.loadMore(); });
        expect(api.listSummaries).toHaveBeenCalledTimes(2);
        vi.mocked(api.listSummaries).mockResolvedValueOnce(response(rows(1, 20, "retry"), 60));
        await act(async () => { await ref.current!.loadData(); });
        vi.mocked(api.listSummaries).mockResolvedValueOnce(response(rows(21), 60));
        await act(async () => { await ref.current!.loadMore(); });
        expect(ref.current!.state).toMatchObject({ page: 2, loadingMore: false });
    });

    it("does not clear a failed filter refresh error when pagination succeeds", async () => {
        const { ref } = await mountList(response(rows(1), 60));
        act(() => { ref.current!.setState({ keyword: "new filter" }); });
        vi.mocked(api.listSummaries).mockRejectedValueOnce(new Error("filter offline"));
        await act(async () => { await ref.current!.loadData(); });
        vi.mocked(api.listSummaries).mockResolvedValueOnce(response(rows(21), 60));
        await act(async () => { await ref.current!.loadMore(); });
        expect(screen.getByRole("alert")).toHaveTextContent("filter offline");
    });

    it("does not commit a short activation prefix or advance past its missing row", async () => {
        const { ref, activate, loadMore } = await mountList();
        await loadMore();
        const cached = ref.current!.state.items;
        vi.mocked(api.listSummaries).mockResolvedValue(response(rows(1, 39), 80));
        await activate();
        expect(api.listSummaries).toHaveBeenCalledTimes(5);
        expect(ref.current!.state.items).toBe(cached);
        expect(ref.current!.state).toMatchObject({ page: 2, total: 80, hasMore: true, loading: false });
        expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("repairs an empty offset response instead of falsely ending a nonempty list", async () => {
        const { ref } = await mountList(response(rows(1), 60));
        vi.mocked(api.listSummaries)
            .mockResolvedValueOnce(response([], 60))
            .mockResolvedValueOnce(response(rows(1, 40), 60));
        await act(async () => { await ref.current!.loadMore(); });
        expect(ref.current!.state.items).toHaveLength(40);
        expect(ref.current!.state).toMatchObject({ page: 2, hasMore: true });
    });

    it("reconciles a now-empty server without leaving hasMore stuck true", async () => {
        const { ref } = await mountList(response(rows(1), 60));
        vi.mocked(api.listSummaries).mockResolvedValue(response([], 0));
        await act(async () => { await ref.current!.loadMore(); });
        expect(ref.current!.state).toMatchObject({ items: [], page: 1, total: 0, hasMore: false });
    });

    it("replays read events onto the replacement prefix during loadMore repair", async () => {
        const { ref } = await mountList(response(rows(1), 60));
        const repair = deferred<ListSummariesResponse>();
        vi.mocked(api.listSummaries)
            .mockResolvedValueOnce(response(rows(20), 60))
            .mockReturnValueOnce(repair.promise);
        let pending!: Promise<void>;
        await act(async () => { pending = ref.current!.loadMore(); });
        act(() => {
            window.dispatchEvent(new CustomEvent("summary-read", {
                detail: { taskId: 1, isUnread: false, needsAttention: false },
            }));
        });
        await act(async () => {
            repair.resolve(response(rows(1, 40, "fresh"), 60));
            await pending;
        });
        expect(screen.getByTestId("task-1")).toHaveAttribute("data-unread", "false");
        expect(screen.getByTestId("task-1")).toHaveTextContent("fresh-1");
        expect(ref.current!.state).toMatchObject({ page: 2, loadingMore: false });
        expect((ref.current as any).pendingReadPatches.size).toBe(0);
    });

    it.each(["space", "channel", "keyword", "unmount"] as const)(
        "abandons loadMore repair when its %s changes",
        async (scope) => {
            const { ref, view } = await mountList(response(rows(1), 60));
            const instance = ref.current!;
            const cached = instance.state.items;
            const repair = deferred<ListSummariesResponse>();
            vi.mocked(api.listSummaries)
                .mockResolvedValueOnce(response(rows(20), 60))
                .mockReturnValueOnce(repair.promise);
            let pending!: Promise<void>;
            await act(async () => { pending = instance.loadMore(); });
            if (scope === "space") {
                WKApp.shared.currentSpaceId = "other-space";
            } else if (scope === "channel") {
                vi.mocked(api.listSummaries).mockResolvedValueOnce(response(rows(80, 1, "channel"), 1));
                await act(async () => {
                    view.rerender(<SummaryListPage ref={ref} embedded channelId="other-channel" />);
                });
            } else if (scope === "keyword") {
                await act(async () => { instance.setState({ keyword: "changed" }); });
            } else {
                view.unmount();
            }
            await act(async () => {
                repair.resolve(response(rows(1, 40, "stale"), 60));
                await pending;
            });
            if (scope === "channel") {
                expect(instance.state.items[0].topic).toBe("channel-80");
            } else {
                expect(instance.state.items).toBe(cached);
            }
            expect((instance as any).pendingReadPatches.size).toBe(0);
            expect((instance as any).isLoadingMore).toBe(false);
        },
    );

    it.each(["space", "channel", "keyword"] as const)(
        "abandons a bounded retained snapshot when its %s changes",
        async (scope) => {
            const { ref, view, activate } = await mountDeepList();
            const refresh = deferred<ListSummariesResponse>();
            vi.mocked(api.listSummaries).mockReturnValueOnce(refresh.promise);
            await activate();
            expect(api.listSummaries).toHaveBeenCalledTimes(7);
            const cached = ref.current!.state.items;
            if (scope === "space") {
                WKApp.shared.currentSpaceId = "space-b";
            } else if (scope === "channel") {
                vi.mocked(api.listSummaries).mockResolvedValueOnce(response(rows(80, 1, "channel"), 1));
                await act(async () => {
                    view.rerender(<SummaryListPage ref={ref} embedded backgroundRefreshKey={1} channelId="channel-b" />);
                });
            } else {
                await act(async () => { ref.current!.setState({ keyword: "new query" }); });
            }
            await act(async () => { refresh.resolve(response(rows(1, 100, "stale"), 240)); });
            if (scope === "channel") {
                expect(ref.current!.state.items[0].topic).toBe("channel-80");
            } else {
                expect(ref.current!.state.items).toBe(cached);
            }
            expect(ref.current!.state.loading).toBe(false);
        },
    );

    it("drops both the current snapshot and queued activations when unmounted", async () => {
        const { view, activate } = await mountList();
        const refresh = deferred<ListSummariesResponse>();
        vi.mocked(api.listSummaries).mockReturnValueOnce(refresh.promise);
        await activate();
        await activate(2);
        view.unmount();
        await act(async () => { refresh.resolve(response(rows(1))); });
        expect(api.listSummaries).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId(summaryTestIds.list)).not.toBeInTheDocument();
    });

    it.each(["handleDelete", "handleLeave", "handleCancel"] as const)(
        "lets %s supersede an activation snapshot",
        async (method) => {
            const { ref, activate } = await mountList();
            const stale = deferred<ListSummariesResponse>();
            vi.mocked(api.listSummaries)
                .mockReturnValueOnce(stale.promise)
                .mockResolvedValueOnce(response(rows(50, 1, "after-action"), 1));
            await activate();
            await act(async () => { await ref.current![method](1); });
            await act(async () => { stale.resolve(response(rows(1))); });
            expect(ref.current!.state.items[0].topic).toBe("after-action-50");
            expect(ref.current!.state.loading).toBe(false);
        },
    );
});
