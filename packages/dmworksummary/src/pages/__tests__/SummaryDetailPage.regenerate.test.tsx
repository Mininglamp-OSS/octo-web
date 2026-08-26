// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@octo/base", async () => ({
    // Provide a `default` export for SummaryDetailPage.renderHeader's
    // `WKApp.loginInfo.uid` read; @octo/base exports the WKApp singleton
    // as default, so the mock has to as well or the render throws
    // "No 'default' export is defined on the '@octo/base' mock".
    default: { loginInfo: {} },
    I18nContext: React.createContext({ t: (key: string) => key }),
    t: (key: string) => key,
    ForwardService: {},
    interpretForwardResult: vi.fn(),
    I18nContext: React.createContext({ t: (key: string) => key }),
}));
vi.mock("@octo/base/src/App", () => ({
    default: { loginInfo: {} },
    I18nContext: React.createContext({ t: (key: string) => key }),
}));
vi.mock("@octo/base/src/Components/VoiceInputButton", () => ({ default: () => null }));
vi.mock("@octo/base/src/Service/Context", () => ({ default: React.createContext(null) }));
vi.mock("@octo/base/src/Components/Subscribers/list", () => ({ SubscriberList: () => null }));
vi.mock("@octo/base/src/Components/RoutePage", () => ({ default: () => null }));
vi.mock("../SummaryConfirmPage", () => ({ default: () => null }));
vi.mock("../../components/CitationText", () => ({ default: () => null }));
vi.mock("../../components/SelectedSourcesPanel", () => ({ default: () => null }));
vi.mock("../../components/ScheduleConfigModal", () => ({ default: () => null }));
vi.mock("../../components/SummaryEditor", () => ({ default: () => null }));
vi.mock("../../components/SummaryVersionPanel", () => ({ default: () => null }));
vi.mock("../../components/OverflowTooltip", () => ({ default: () => null }));

vi.mock("wukongimjssdk", () => ({
    Channel: class {},
    MessageText: class {},
    WKSDK: { shared: () => ({ chatManager: { send: vi.fn() } }) },
}));

vi.mock("@douyinfe/semi-ui", () => {
    const Passthrough = ({ children }: any) => children ?? null;
    const Modal = ({ children, visible, onCancel }: any) => visible ? <div data-testid="regenerate-modal" data-has-cancel={Boolean(onCancel)}>{children}</div> : null;
    const Dropdown: any = Passthrough;
    Dropdown.Menu = Passthrough;
    Dropdown.Item = Passthrough;
    return {
        Button: Passthrough, Spin: Passthrough, Banner: Passthrough, Tag: Passthrough,
        Modal, Popconfirm: Passthrough, Tooltip: Passthrough, Dropdown,
        Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    };
});

vi.mock("@douyinfe/semi-icons", () => ({
    IconChevronDown: () => null,
    default: () => null,
}));
vi.mock("../../api/summaryApi");

import * as api from "../../api/summaryApi";
import SummaryDetailPage from "../SummaryDetailPage";
import { SummaryMode } from "../../types/summary";

function makePage() {
    const page = new SummaryDetailPage({ taskId: 1 });
    (page as any).context = { t: (key: string) => key };
    (page as any).setState = function (this: any, patch: any) {
        this.state = { ...this.state, ...(typeof patch === "function" ? patch(this.state) : patch) };
    };
    page.state = {
        ...page.state,
        detail: {
            task_id: 1,
            title: "Legacy title",
            topic: "Preferred topic",
            summary_mode: SummaryMode.BY_GROUP,
            result_id: 10,
            result: { content: "Existing result" },
        },
    } as any;
    return page;
}

describe("SummaryDetailPage regenerate dialog", () => {
    beforeEach(() => vi.clearAllMocks());

    it("prefills a full regeneration with the summary topic", () => {
        const page = makePage();

        page.handleRegenerate();

        expect(page.state.regenerateTopic).toBe("Preferred topic");
    });

    it("passes the mode-specific action, disabled state, and close handler to the modal", () => {
        const page = makePage();
        const findElement = (node: any, predicate: (element: any) => boolean): any => {
            if (!node || typeof node !== "object") return null;
            if (predicate(node)) return node;
            return React.Children.toArray(node.props?.children).map((child) => findElement(child, predicate)).find(Boolean) ?? null;
        };

        page.state = { ...page.state, showRegenerateModal: true, regenerateMode: "refine", refineFeedback: "Update risks", detail: { ...page.state.detail, result_id: undefined } as any };
        const refineModal = findElement(page.render(), (element) => element.type?.name === "Modal" && element.props.className === "summary-confirm");
        const refineAction = findElement(refineModal, (element) => element.type === "button" && element.props.children === "summary.detail.refineAction");

        expect(refineModal.props.onCancel).toBe(page.handleRegenerateCancel);
        expect(refineAction.props.disabled).toBe(true);

        page.state = { ...page.state, regenerateMode: "full", regenerateTopic: "New topic" };
        const fullModal = findElement(page.render(), (element) => element.type?.name === "Modal" && element.props.className === "summary-confirm");
        const fullAction = findElement(fullModal, (element) => element.type === "button" && element.props.children === "summary.detail.regenerate");

        expect(fullAction.props.disabled).toBe(false);
    });

    it("does not start refine submission without a base result", async () => {
        const page = makePage();
        page.state = { ...page.state, regenerateMode: "refine", refineFeedback: "Tighten risks", detail: { ...page.state.detail, result_id: undefined } as any };

        await page.handleRegenerateConfirm();

        expect(api.streamRefineSummary).not.toHaveBeenCalled();
        expect(page.state.regenerateSubmitting).toBe(false);
    });

    it("submits the full-mode topic to the regeneration API", async () => {
        vi.mocked(api.regenerateSummary).mockResolvedValue({} as any);
        const page = makePage();
        page.state = { ...page.state, regenerateMode: "full", regenerateTopic: "New project summary" };
        (page as any).loadDetail = vi.fn();

        await page.handleRegenerateConfirm();

        expect(api.regenerateSummary).toHaveBeenCalledWith(1, { topic: "New project summary" });
    });

    it("keeps a voice transcription in the mode active when recording began", () => {
        const page = makePage();
        page.state = { ...page.state, regenerateMode: "refine", refineFeedback: "", regenerateTopic: "Original topic" };

        (page as any).handleRegenerateVoiceRecordingStart();
        page.state = { ...page.state, regenerateMode: "full" };
        (page as any).handleRegenerateInputVoice("Recorded feedback", "all");

        expect(page.state.refineFeedback).toBe("Recorded feedback");
        expect(page.state.regenerateTopic).toBe("Original topic");
    });
});
