// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@octo/base", async () => ({
    // Provide a `default` export for SummaryDetailPage.renderHeader's
    // `WKApp.loginInfo.uid` read; @octo/base exports the WKApp singleton
    // as default, so the mock has to as well or the render throws
    // "No 'default' export is defined on the '@octo/base' mock".
    default: { loginInfo: {}, shared: { currentSpaceId: "space-a" } },
    I18nContext: React.createContext({ t: (key: string) => key }),
    t: (key: string) => key,
    ForwardService: {},
    interpretForwardResult: vi.fn(),
    I18nContext: React.createContext({ t: (key: string) => key }),
}));
vi.mock("@octo/base/src/App", () => ({
    default: { loginInfo: {}, shared: { currentSpaceId: "space-a" } },
    I18nContext: React.createContext({ t: (key: string) => key }),
}));
vi.mock("@octo/base/src/Components/VoiceInputButton", () => ({
  default: () => null,
}));
vi.mock("@octo/base/src/Service/Context", () => ({
  default: React.createContext(null),
}));
vi.mock("@octo/base/src/Components/Subscribers/list", () => ({
  SubscriberList: () => null,
}));
vi.mock("@octo/base/src/Components/RoutePage", () => ({ default: () => null }));
vi.mock("../SummaryConfirmPage", () => ({ default: () => null }));
vi.mock("../../components/CitationText", () => ({ default: () => null }));
vi.mock("../../components/SelectedSourcesPanel", () => ({
  default: () => null,
}));
vi.mock("../../components/ScheduleConfigModal", () => ({
  default: () => null,
}));
vi.mock("../../components/SummaryEditor", () => ({ default: () => null }));
vi.mock("../../components/SummaryVersionPanel", () => ({
  default: () => null,
}));
vi.mock("../../components/OverflowTooltip", () => ({ default: () => null }));

vi.mock("wukongimjssdk", () => ({
    Channel: class {},
    MessageText: class {},
    WKSDK: { shared: () => ({ chatManager: { send: vi.fn() } }) },
}));

vi.mock("@douyinfe/semi-ui", () => {
    const Passthrough = ({ children }: any) => children ?? null;
  const Modal = ({ children, visible, onCancel }: any) =>
    visible ? (
      <div data-testid="regenerate-modal" data-has-cancel={Boolean(onCancel)}>
        {children}
      </div>
    ) : null;
    const Dropdown: any = Passthrough;
    Dropdown.Menu = Passthrough;
    Dropdown.Item = Passthrough;
    return {
    Button: Passthrough,
    Spin: Passthrough,
    Banner: Passthrough,
    Tag: Passthrough,
    Modal,
    Popconfirm: Passthrough,
    Tooltip: Passthrough,
    Dropdown,
        Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    };
});

vi.mock("@douyinfe/semi-icons", () => ({
    IconChevronDown: () => null,
    IconHistory: () => null,
    IconClock: () => null,
    IconMore: () => null,
    default: () => null,
}));
vi.mock("../../api/summaryApi");

import * as api from "../../api/summaryApi";
import SummaryDetailPage from "../SummaryDetailPage";
import { SummaryMode, TaskStatus, TriggerType } from "../../types/summary";
import { formalContentFixture } from "../../__tests__/formalContentFixtures";
import type { FormalController } from "../../features/summaryWorkbench/NativeFormalContentBinding";
import { createSummaryDetailAction } from "../../bridge/summaryWorkbench/detailAction";
import { SUMMARY_OPEN_CHAT_WITH_REFERENCE } from "../../bridge/continueRefine";

function makePage(props: Record<string, unknown> = {}) {
  const page = new SummaryDetailPage({ taskId: 1, ...props });
    (page as any).context = { t: (key: string) => key };
    (page as any).setState = function (this: any, patch: any) {
    this.state = {
      ...this.state,
      ...(typeof patch === "function" ? patch(this.state) : patch),
    };
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

    const bindFormal = (page: SummaryDetailPage) => {
        const controller: FormalController = {
            content: formalContentFixture(), configuration: null, versions: [], cursor: null,
            pending: false, errorKey: "", noticeKey: "", accessLost: false,
            reload: vi.fn().mockResolvedValue(true), loadConfiguration: vi.fn().mockResolvedValue(true),
            saveConfiguration: vi.fn().mockResolvedValue(true), refine: vi.fn().mockResolvedValue(true),
            regenerate: vi.fn().mockResolvedValue(true), edit: vi.fn().mockResolvedValue(true),
            restore: vi.fn().mockResolvedValue(true), loadVersions: vi.fn().mockResolvedValue(true),
            cancel: vi.fn().mockResolvedValue(true), apply: vi.fn().mockResolvedValue(true),
        };
        page.state = { ...page.state, formalBinding: { taskId: 1, status: "ready", controller, retry: vi.fn() } };
        return controller;
    };

    it("keeps the original detail DOM entry for managed summaries", () => {
        const page = makePage();
        bindFormal(page);
        const tree = page.render();
        expect(tree.type).toBe("div");
        expect(tree.props.className).toBe("summary-detail-page");
    });

    it("continue-refine routes to a new derived summary instead of mutating the current one", () => {
        const onContinueRefine = vi.fn();
        const page = makePage({ onContinueRefine });
        const controller = bindFormal(page);
        page.handleContinueRefine();
        // 继续优化 = 交给宿主派生一条全新总结（挂 referenced_task_ids），不再就地改写当前总结。
        expect(onContinueRefine).toHaveBeenCalledTimes(1);
        expect(onContinueRefine).toHaveBeenCalledWith(
            expect.objectContaining({ task_id: 1 }),
        );
        expect(page.state.showRegenerateModal).toBe(false);
        expect(controller.refine).not.toHaveBeenCalled();
        expect(api.streamRefineSummary).not.toHaveBeenCalled();
        expect(api.regenerateSummary).not.toHaveBeenCalled();
    });

    // 没有宿主回调的独立详情页入口（legacy 路由、创建后 push 的详情）也必须派生新总结：
    // 派发 summary-open-chat-with-reference，由 legacyNavigation push agent 创建页。
    // 旧的「就地改写」兜底已删除。
    it("continue-refine without a host routes to the agent flow instead of rewriting in place", () => {
        const page = makePage();
        const controller = bindFormal(page);
        const dispatchSpy = vi.spyOn(window, "dispatchEvent");

        page.handleContinueRefine();

        const event = dispatchSpy.mock.calls
            .map(([candidate]) => candidate as CustomEvent)
            .find((candidate) => candidate.type === SUMMARY_OPEN_CHAT_WITH_REFERENCE);
        expect(event).toBeDefined();
        expect(event!.detail).toEqual(expect.objectContaining({ task_id: 1 }));
        expect(page.state.showRegenerateModal).toBe(false);
        expect(controller.refine).not.toHaveBeenCalled();
        expect(api.streamRefineSummary).not.toHaveBeenCalled();
        expect(api.regenerateSummary).not.toHaveBeenCalled();
    });

    it("loads configuration through the original scheduling action without submitting a run", () => {
        const page = makePage();
        const controller = bindFormal(page);
        page.openScheduleModal();
        expect(controller.loadConfiguration).toHaveBeenCalledOnce();
        expect(page.state.showScheduleConfig).toBe(true);
        expect(controller.regenerate).not.toHaveBeenCalled();
    });

    it.each([TriggerType.AGENT, TriggerType.MANUAL])("waits for the original formal target then routes continue-refine exactly once (source %s)", (trigger_type) => {
        const onContinueRefine = vi.fn();
        const page = makePage({
            onContinueRefine,
            requestedAction: createSummaryDetailAction(1, "space-a", "refine", "sc1_personal"),
        });
        page.state = { ...page.state, loading: false, detail: { ...page.state.detail!, trigger_type } };
        const controller = bindFormal(page);
        // 门控：formal target 仍 pending 时不触发。
        controller.pending = true;
        (page as any).consumeRequestedAction();
        expect(onContinueRefine).not.toHaveBeenCalled();
        // target ready → 触发一次，路由到派生 create（继续优化），不开就地 refine 弹窗。
        controller.pending = false;
        (page as any).consumeRequestedAction();
        expect(onContinueRefine).toHaveBeenCalledTimes(1);
        expect(page.state.showRegenerateModal).toBe(false);
        expect(controller.refine).not.toHaveBeenCalled();
        expect(api.streamRefineSummary).not.toHaveBeenCalled();
        expect(api.regenerateSummary).not.toHaveBeenCalled();
        // 一次性 gate：再次 consume 不重复触发。
        (page as any).consumeRequestedAction();
        expect(onContinueRefine).toHaveBeenCalledTimes(1);
    });

    it("rejects a stale target and never falls back to a legacy editor", () => {
        const page = makePage({
            requestedAction: createSummaryDetailAction(1, "space-a", "edit", "different-content"),
        });
        page.state = { ...page.state, loading: false };
        bindFormal(page);
        (page as any).consumeRequestedAction();
        expect(page.state.isEditing).toBe(false);
    });

    it("a list edit intent cannot bypass detail ownership permissions", () => {
        const page = makePage({
            requestedAction: createSummaryDetailAction(1, "space-a", "edit"),
        });
        page.state = {
            ...page.state, loading: false, personalLoading: false, membersLoading: false,
            detail: { ...page.state.detail!, status: TaskStatus.COMPLETED, permissions: { can_edit: true, can_edit_team: false } },
            formalBinding: { taskId: 1, status: "legacy", retry: vi.fn() },
        } as any;
        (page as any).consumeRequestedAction();
        expect(page.state.isEditing).toBe(false);
    });

    it("regenerate intent opens the two-mode modal without executing on navigation", () => {
        const page = makePage({
            requestedAction: createSummaryDetailAction(1, "space-a", "regenerate", "sc1_personal"),
        });
        page.state = { ...page.state, loading: false };
        const controller = bindFormal(page);
        (page as any).consumeRequestedAction();
        // 重新生成 now opens the two-mode modal (按意见调整 / 全部重新生成); scheduling
        // lives behind the separate 定时更新 (configure) intent. Nothing runs on nav.
        expect(page.state.showRegenerateModal).toBe(true);
        expect(page.state.showScheduleConfig).toBe(false);
        expect(controller.regenerate).not.toHaveBeenCalled();
    });

    it("configure intent opens scheduling configuration without executing on navigation", () => {
        const page = makePage({
            requestedAction: createSummaryDetailAction(1, "space-a", "configure", "sc1_personal"),
        });
        page.state = { ...page.state, loading: false };
        const controller = bindFormal(page);
        (page as any).consumeRequestedAction();
        expect(page.state.showScheduleConfig).toBe(true);
        expect(controller.loadConfiguration).toHaveBeenCalledOnce();
        expect(controller.regenerate).not.toHaveBeenCalled();
    });

    it("blocks every legacy mutation entry while managed content is unavailable", async () => {
        const page = makePage();
        page.state = { ...page.state, formalBinding: { taskId: 1, status: "error", retry: vi.fn() } };
        page.handleStartEdit();
        page.handleContinueRefine();
        page.openScheduleModal();
        await page.handleRegenerateConfirm();
        await page.handleCancel();
        expect(page.state.isEditing).toBe(false);
        expect(page.state.showRegenerateModal).toBe(false);
        expect(page.state.showScheduleConfig).toBe(false);
        expect(api.regenerateSummary).not.toHaveBeenCalled();
        expect(api.cancelSummary).not.toHaveBeenCalled();
    });

    it("prefills a full regeneration with the summary topic", () => {
        const page = makePage();

        page.handleRegenerate();

        expect(page.state.regenerateTopic).toBe("Preferred topic");
    });

  it("does not confuse reference permission with optimize permission", () => {
    const onContinueRefine = vi.fn();
    const onViewConfirm = vi.fn();
    const page = makePage({ onContinueRefine, onViewConfirm });
    page.state = {
      ...page.state,
      detail: { ...page.state.detail, referenceable: true },
    } as any;

    page.handleContinueRefine();
    (page as any).handleViewConfirm();

    expect(onContinueRefine).not.toHaveBeenCalled();
    expect(page.state.showRegenerateModal).toBe(false);
    expect(onViewConfirm).toHaveBeenCalledWith(1);
  });

    it("passes the mode-specific action, disabled state, and close handler to the modal", () => {
        const page = makePage();
    const findElement = (
      node: any,
      predicate: (element: any) => boolean
    ): any => {
            if (!node || typeof node !== "object") return null;
            if (predicate(node)) return node;
      return (
        React.Children.toArray(node.props?.children)
          .map((child) => findElement(child, predicate))
          .find(Boolean) ?? null
      );
        };

    page.state = {
      ...page.state,
      showRegenerateModal: true,
      regenerateMode: "refine",
      refineFeedback: "Update risks",
      detail: { ...page.state.detail, result_id: undefined } as any,
    };
    const refineModal = findElement(
      page.renderLegacyDetail(),
      (element) =>
        element.type?.name === "Modal" &&
        element.props.className === "summary-confirm"
    );
    const refineAction = findElement(
      refineModal,
      (element) =>
        element.type === "button" &&
        element.props.children === "summary.detail.refineAction"
    );

        expect(refineModal.props.onCancel).toBe(page.handleRegenerateCancel);
        expect(refineAction.props.disabled).toBe(true);

    page.state = {
      ...page.state,
      regenerateMode: "full",
      regenerateTopic: "New topic",
    };
    const fullModal = findElement(
      page.renderLegacyDetail(),
      (element) =>
        element.type?.name === "Modal" &&
        element.props.className === "summary-confirm"
    );
    const fullAction = findElement(
      fullModal,
      (element) =>
        element.type === "button" &&
        element.props.children === "summary.detail.regenerate"
    );

        expect(fullAction.props.disabled).toBe(false);
    });

    it("does not start refine submission without a base result", async () => {
        const page = makePage();
    page.state = {
      ...page.state,
      regenerateMode: "refine",
      refineFeedback: "Tighten risks",
      detail: { ...page.state.detail, result_id: undefined } as any,
    };

        await page.handleRegenerateConfirm();

        expect(api.streamRefineSummary).not.toHaveBeenCalled();
        expect(page.state.regenerateSubmitting).toBe(false);
    });

    it("submits the full-mode topic to the regeneration API", async () => {
        vi.mocked(api.regenerateSummary).mockResolvedValue({} as any);
        const page = makePage();
    page.state = {
      ...page.state,
      regenerateMode: "full",
      regenerateTopic: "New project summary",
    };
        (page as any).loadDetail = vi.fn();

        await page.handleRegenerateConfirm();

    expect(api.regenerateSummary).toHaveBeenCalledWith(1, {
      topic: "New project summary",
    });
    });

    it("keeps a voice transcription in the mode active when recording began", () => {
        const page = makePage();
    page.state = {
      ...page.state,
      regenerateMode: "refine",
      refineFeedback: "",
      regenerateTopic: "Original topic",
    };

        (page as any).handleRegenerateVoiceRecordingStart();
        page.state = { ...page.state, regenerateMode: "full" };
        (page as any).handleRegenerateInputVoice("Recorded feedback", "all");

        expect(page.state.refineFeedback).toBe("Recorded feedback");
        expect(page.state.regenerateTopic).toBe("Original topic");
    });
});
