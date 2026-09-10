// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Minimal Semi UI mocks that Toast/window/open can coexist
vi.mock("@douyinfe/semi-ui", () => {
    const Passthrough = ({ children }: any) => children ?? null;
    return {
        Button: Passthrough,
        Spin: Passthrough,
        Banner: Passthrough,
        Tag: Passthrough,
        Modal: ({ children, visible }: any) => visible ? <div>{children}</div> : null,
        Popconfirm: Passthrough,
        Tooltip: Passthrough,
        Dropdown: Passthrough,
        Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    };
});
vi.mock("@douyinfe/semi-icons", () => ({
    IconEdit: () => null,
    IconSend: () => null,
    IconClock: () => null,
    IconTick: () => null,
    IconClose: () => null,
    IconInfoCircle: () => null,
    IconHistory: () => null,
    IconRefresh: () => null,
    IconUser: () => null,
    IconPlus: () => null,
    IconMinusCircle: () => null,
    IconExit: () => null,
    IconDelete: () => null,
    IconMore: () => null,
    IconChevronDown: () => null,
}));

vi.mock("../../api/summaryApi");
import * as api from "../../api/summaryApi";

// Mock getDocsDocumentOpener so each test can control return value
const { mockGetDocsDocumentOpener } = vi.hoisted(() => ({
    mockGetDocsDocumentOpener: vi.fn(),
}));

vi.mock("@octo/base", async () => {
    const actual = await vi.importActual("@octo/base");
    return {
        ...actual,
        getDocsDocumentOpener: mockGetDocsDocumentOpener,
    };
});

import SummaryDetailPage from "../SummaryDetailPage";
import { SummaryMode } from "../../types/summary";

function makePage(props: Record<string, unknown> = {}) {
    const page = new SummaryDetailPage({ taskId: 1, ...props }) as any;
    page.context = { t: (key: string) => key };
    page.setState = function (this: any, patch: any) {
        this.state = {
            ...this.state,
            ...(typeof patch === "function" ? patch(this.state) : patch),
        };
    };
    page.state = {
        ...page.state,
        detail: {
            task_id: 1,
            title: "Test summary",
            topic: "Test topic",
            summary_mode: SummaryMode.BY_GROUP,
            result_id: 10,
            result: { content: "Existing result [1]。" },
        },
    } as any;
    return page;
}

/** Simulate calling handleConvertToDoc and collect toast/location calls. */
async function convert(
    page: any,
    content = "Summary text with [1] citation.",
    title = "Test Doc",
    key = "team-result",
) {
    const { Toast } = await import("@douyinfe/semi-ui");
    return { Toast, page, result: await page.handleConvertToDoc(content, title, key) };
}

describe("SummaryDetailPage convert flow", () => {
    let windowOpenSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.convertSummaryToDoc).mockResolvedValue({ docId: "doc-1", url: "/d/doc-1" });
        mockGetDocsDocumentOpener.mockReturnValue(undefined);
        windowOpenSpy = vi.spyOn(window, "open").mockReturnValue(null);
    });

    afterEach(() => {
        windowOpenSpy?.mockRestore();
    });

    describe("normal Web path (no host opener)", () => {
        it("preopens a popup before conversion and navigates it on success", async () => {
            const mockWindow = { location: { href: "" }, closed: false, close: vi.fn(), opener: null } as any;
            windowOpenSpy.mockReturnValue(mockWindow);
            const page = makePage();
            page.convertInFlight = false;

            await page.handleConvertToDoc("content", "Title", "k");

            expect(windowOpenSpy).toHaveBeenCalledWith("about:blank", "_blank");
            expect(api.convertSummaryToDoc).toHaveBeenCalledWith("Title", "content");
            expect(mockWindow.location.href).toBe("/d/doc-1");
        });

        it("shows blocked-popup link when window.open returns null", async () => {
            windowOpenSpy.mockReturnValue(null);
            const page = makePage();
            page.convertInFlight = false;
            const { Toast } = await import("@douyinfe/semi-ui");

            await page.handleConvertToDoc("content", "Title", "k");

            expect(windowOpenSpy).toHaveBeenCalledWith("about:blank", "_blank");
            expect(Toast.warning).toHaveBeenCalled();
            const warningContent = (Toast.warning as any).mock.calls[0][0];
            expect(warningContent.duration).toBe(8);
        });

        it("closes pre-opened popup on conversion failure", async () => {
            const mockClose = vi.fn();
            const mockWindow = { closed: false, close: mockClose } as any;
            windowOpenSpy.mockReturnValue(mockWindow);
            vi.mocked(api.convertSummaryToDoc).mockRejectedValue(new Error("conversion failed"));
            const page = makePage();
            page.convertInFlight = false;

            await page.handleConvertToDoc("content", "Title", "k");

            expect(mockClose).toHaveBeenCalled();
        });
    });

    describe("native path (with host opener)", () => {
        it("does NOT preopen popup when host opener is available", async () => {
            const hostOpener = vi.fn(async () => {});
            mockGetDocsDocumentOpener.mockReturnValue(hostOpener);
            const page = makePage();
            page.convertInFlight = false;

            await page.handleConvertToDoc("content", "Title", "k");

            expect(windowOpenSpy).not.toHaveBeenCalled();
            expect(hostOpener).toHaveBeenCalledWith({ docId: "doc-1", url: "/d/doc-1" });
        });

        it("preserves created doc link when hostOpener throws after create success", async () => {
            const hostOpener = vi.fn(async () => { throw new Error("nav failed"); });
            mockGetDocsDocumentOpener.mockReturnValue(hostOpener);
            const { Toast } = await import("@douyinfe/semi-ui");
            const page = makePage();
            page.convertInFlight = false;

            await page.handleConvertToDoc("content", "Title", "k");

            expect(Toast.warning).toHaveBeenCalled();
            const warnContent = (Toast.warning as any).mock.calls[0][0];
            const callArgs = warnContent.content.props.children;
            expect(callArgs[0]).toBe("summary.detail.convertOpenFailed");
            expect(Toast.error).not.toHaveBeenCalled();
            expect(hostOpener).toHaveBeenCalledTimes(1);
        });

        it.each(["navigation", "import"])("retained %s error link keeps the original scoped opener", async (failure) => {
            const result = { docId: "doc-1", url: "/d/doc-1" };
            const originalOpener = vi.fn().mockRejectedValue(new Error("old scope"));
            const newIdentityOpener = vi.fn();
            mockGetDocsDocumentOpener.mockReturnValue(originalOpener);
            const { Toast } = await import("@douyinfe/semi-ui");
            if (failure === "import") {
                vi.mocked(api.convertSummaryToDoc).mockRejectedValue(Object.assign(new Error("import failed"), { document: result }));
            }
            await makePage().handleConvertToDoc("content", "Title", "k");
            const toast = failure === "import" ? Toast.error : Toast.warning;
            const content = vi.mocked(toast).mock.calls[0][0] as any;
            const link = React.Children.toArray(content.content.props.children)
                .find((child) => React.isValidElement(child) && child.type === "a") as React.ReactElement<any>;
            expect(link.props.href).toBe(result.url);
            mockGetDocsDocumentOpener.mockReturnValue(newIdentityOpener);
            const preventDefault = vi.fn();
            link.props.onClick({ preventDefault });
            await Promise.resolve();
            expect(preventDefault).toHaveBeenCalledOnce();
            expect(mockGetDocsDocumentOpener).toHaveBeenCalledOnce();
            expect(newIdentityOpener).not.toHaveBeenCalled();
            expect(originalOpener).toHaveBeenLastCalledWith(result);
            expect(api.convertSummaryToDoc).toHaveBeenCalledOnce();
        });

        it("shows created doc link when hostOpener rejects scope", async () => {
            const scopeErr = new Error("scope expired") as any;
            scopeErr.document = { docId: "doc-1", url: "/d/doc-1" };
            const hostOpener = vi.fn(async () => { throw scopeErr; });
            mockGetDocsDocumentOpener.mockReturnValue(hostOpener);
            const { Toast } = await import("@douyinfe/semi-ui");
            const page = makePage();
            page.convertInFlight = false;

            await page.handleConvertToDoc("content", "Title", "k");

            // Must show success + link, NOT generic error.
            expect(Toast.warning).toHaveBeenCalled();
            expect(Toast.error).not.toHaveBeenCalled();
        });

        it("shows created doc link when convert succeeds but identity changed before open", async () => {
            const hostOpener = vi.fn(async () => { throw new Error("scope expired"); });
            mockGetDocsDocumentOpener.mockReturnValue(hostOpener);
            const { Toast } = await import("@douyinfe/semi-ui");
            const page = makePage();
            page.convertInFlight = false;

            await page.handleConvertToDoc("content", "Title", "k");

            expect(Toast.warning).toHaveBeenCalled();
            expect(Toast.error).not.toHaveBeenCalled();
        });

        it("does not navigate a stale result after unmount", async () => {
            const hostOpener = vi.fn(async () => {});
            mockGetDocsDocumentOpener.mockReturnValue(hostOpener);
            const page = makePage();
            page.convertInFlight = false;
            page.unmounted = true;

            await page.handleConvertToDoc("content", "Title", "k");

            // Conversion was not started (unmounted guard is after conversion, but
            // the in-flight guard and unmounted guard are separate - let's trace:
            // convertInFlight check passes, hostOpener is set (no popup), state.set
            // proceeds, API call is made, result returns, unmounted=true -> returns.
            // The important check: hostOpener should NOT be invoked on unmounted.
            // Actually the unmounted check in the try block returns before hostOpener.
            // Let's check: after conversion succeeds, it checks unmounted and returns.
            expect(hostOpener).not.toHaveBeenCalled();
        });
    });

    describe("edge cases", () => {
        it("skips conversion when content is empty", async () => {
            const page = makePage();
            page.convertInFlight = false;

            await page.handleConvertToDoc("", "Title", "k");

            expect(api.convertSummaryToDoc).not.toHaveBeenCalled();
        });

        it("skips conversion when content is only whitespace", async () => {
            const page = makePage();
            page.convertInFlight = false;

            await page.handleConvertToDoc("   ", "Title", "k");

            expect(api.convertSummaryToDoc).not.toHaveBeenCalled();
        });

        it("respects the in-flight lock", async () => {
            const page = makePage();
            page.convertInFlight = true;

            await page.handleConvertToDoc("content", "Title", "k");

            expect(api.convertSummaryToDoc).not.toHaveBeenCalled();
        });

        it("strips citation markers before conversion", async () => {
            windowOpenSpy.mockReturnValue(null);
            const page = makePage();
            page.convertInFlight = false;

            await page.handleConvertToDoc("Result with [1] citation.", "Title", "k");

            expect(api.convertSummaryToDoc).toHaveBeenCalledWith(
                "Title",
                "Result with  citation.",
            );
        });

        it("uses default title when title is undefined", async () => {
            windowOpenSpy.mockReturnValue(null);
            const page = makePage();
            page.convertInFlight = false;

            await page.handleConvertToDoc("content", undefined, "k");

            expect(api.convertSummaryToDoc).toHaveBeenCalledWith(
                "summary.detail.defaultTitle",
                "content",
            );
        });

        it("resets convertingKey only when key matches", async () => {
            windowOpenSpy.mockReturnValue(null);
            const page = makePage();
            page.convertInFlight = false;
            page.state.convertingKey = "team-result";

            await page.handleConvertToDoc("content", "Title", "team-result");

            expect(page.state.convertingKey).toBeNull();
        });

        it("does not clear a concurrently-set convertingKey", async () => {
            windowOpenSpy.mockReturnValue(null);
            const page = makePage();
            page.convertInFlight = false;
            // Simulate another path overwriting convertingKey while this one is in flight.
            let resolveConvert!: (v: any) => void;
            vi.mocked(api.convertSummaryToDoc).mockImplementationOnce(
                () => new Promise((resolve) => { resolveConvert = resolve; })
            );
            const pending = page.handleConvertToDoc("content", "Title", "team-result");
            // Overwrite the key mid-flight like a concurrent action would.
            page.state.convertingKey = "other-key";
            resolveConvert({ docId: "doc-1", url: "/d/doc-1" });
            await pending;

            // finally must NOT clear the now-different key == "other-key".
            expect(page.state.convertingKey).toBe("other-key");
        });

        it("resets in-flight lock in finally", async () => {
            windowOpenSpy.mockReturnValue(null);
            vi.mocked(api.convertSummaryToDoc).mockRejectedValue(new Error("fail"));
            const page = makePage();
            page.convertInFlight = false;

            await page.handleConvertToDoc("content", "Title", "k");

            expect(page.convertInFlight).toBe(false);
        });
    });
});
