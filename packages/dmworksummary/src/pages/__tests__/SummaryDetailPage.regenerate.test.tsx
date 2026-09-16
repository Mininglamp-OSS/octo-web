// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../components/ChatSelectorModal", () => ({ default: () => null }));
vi.mock("../../components/TimeRangePicker", () => ({ default: () => null }));

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
    default: () => null,
}));
vi.mock("../../api/summaryApi");

import * as api from "../../api/summaryApi";
import SummaryDetailPage from "../SummaryDetailPage";
import ChatSelectorModal from "../../components/ChatSelectorModal";
import { SummaryMode, TriggerType } from "../../types/summary";
import { startOfLocalDay, endOfLocalDay } from "../../components/TimeRangeSelector";

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

    it.each([false, true])("keeps unknown source types safe with picker visible=%s", visible => {
        const page = makePage();
        const sources = [
            { source_type: 0, source_id: "legacy" },
            { source_type: 4, source_id: "future" },
            { source_type: 1, source_id: "group-1", source_name: "Group" },
            { source_type: 2, source_id: "thread-1" },
            { source_type: 3, source_id: "direct-1" },
        ];
        page.state.detail = { ...page.state.detail!, sources };
        page.handleRegenerate();
        page.state.showRegenerateSources = visible;
        const nodes = (node: any): any[] => {
            if (Array.isArray(node)) return node.flatMap(nodes);
            if (!node || typeof node !== "object") return [];
            return [node, ...nodes(node.props?.children)];
        };
        let tree: any;
        expect(() => { tree = page.render(); }).not.toThrow();
        const picker = nodes(tree).find(node => node.type === ChatSelectorModal);
        expect(picker.props.selected).toEqual(visible ? [
            { chat_id: "group-1", name: "Group", chat_type: "group", member_count: null },
            { chat_id: "thread-1", name: "thread-1", chat_type: "thread", member_count: null },
            { chat_id: "direct-1", name: "direct-1", chat_type: "direct", member_count: null },
        ] : []);
        expect(page.state.detail.sources).toEqual(sources);
        expect(page.state.regenerateSources).toEqual(sources);
    });

    it("prefills a full regeneration with the summary topic", () => {
        const page = makePage();

        page.handleRegenerate();

        expect(page.state.regenerateTopic).toBe("Preferred topic");
    });

    it("prefills an Agent's actual saved requirement without using its display title", () => {
        const page = makePage();
        page.state.detail = { ...page.state.detail!, trigger_type: TriggerType.AGENT,
            generation_requirement: "Original Agent request", sources: [] };
        page.handleRegenerate();
        expect(page.state.regenerateTopic).toBe("Original Agent request");
        page.state.detail.generation_requirement = undefined;
        page.handleRegenerate();
        expect(page.state.regenerateTopic).toBe("");
    });

    it("preserves a saved Agent requirement longer than the Workflow input limit", () => {
        const page = makePage();
        const requirement = "需🙂".repeat(4096);
        page.state.detail = { ...page.state.detail!, trigger_type: TriggerType.AGENT, generation_requirement: requirement, sources: [] };
        page.handleRegenerate();
        page.state.regenerateMode = "full";
        expect(page.state.regenerateTopic).toBe(requirement);
        expect((page as any).regenerateInputLimit()).toBe(8192);
        (page as any).handleRegenerateInputVoice(requirement, "all");
        expect(page.state.regenerateTopic).toBe(requirement);
    });

    it.each([
        ["refine", TriggerType.AGENT, 2000, false],
        ["full", TriggerType.MANUAL, 2000, false],
        ["full", TriggerType.AGENT, 8192, true],
    ] as const)("keeps textarea, counter and voice units aligned for %s/%s", (mode, trigger, limit, runes) => {
        const page = makePage();
        page.state = { ...page.state, showRegenerateModal: true, regenerateMode: mode,
            detail: { ...page.state.detail!, trigger_type: trigger, generation_requirement: "prompt", sources: [] },
            refineFeedback: "🙂", regenerateTopic: "🙂" };
        const elements: any[] = [];
        const walk = (node: any) => {
            if (!node || typeof node !== "object") return;
            elements.push(node);
            React.Children.toArray(node.props?.children).forEach(walk);
        };
        walk(page.render());
        const input = elements.find(node => node.props?.id === "summary-regenerate-input");
        const counter = elements.find(node => node.props?.className === "summary-regenerate-char-count");
        expect(input.props.maxLength).toBe(runes ? undefined : limit);
        expect(counter.props.children.join("")).toBe(`${runes ? 1 : 2}/${limit}`);
        const oversized = "🙂".repeat(limit);
        input.props.onChange({ target: { value: oversized } });
        const value = mode === "refine" ? page.state.refineFeedback : page.state.regenerateTopic;
        expect(runes ? Array.from(value).length : value.length).toBe(limit);
        (page as any).handleRegenerateInputVoice(oversized, "all");
        expect(mode === "refine" ? page.state.refineFeedback : page.state.regenerateTopic).toBe(value);
    });

    it.each([false, true])("does not collect or require shared scope on collaboration branch (team=%s)", async (team) => {
        const page = makePage();
        page.state = { ...page.state, showRegenerateModal: true, regenerateMode: "full", regenerateTopic: "instruction",
            detail: { ...page.state.detail!, trigger_type: TriggerType.AGENT, generation_requirement: "",
                summary_mode: SummaryMode.BY_PERSON, sources: [], participants: [{ user_id: "a" }, { user_id: "b" }] } as any };
        (page as any).shouldOperateOnTeamSummary = () => team;
        (page as any).loadDetail = vi.fn();
        (page as any).loadPersonalResult = vi.fn();
        (page as any).loadMembers = vi.fn();
        (page as any).resetSummaryStreamForNewRun = vi.fn();
        (page as any).resetTeamSummaryStreamForNewRun = vi.fn();
        const elements: any[] = [];
        const walk = (node: any) => {
            if (!node || typeof node !== "object") return;
            elements.push(node);
            React.Children.toArray(node.props?.children).forEach(walk);
        };
        walk(page.render());
        expect(elements.some(node => node.props?.className === "summary-regenerate-config")).toBe(false);
        const submit = elements.find(node => node.type === "button" && node.props.children === "summary.detail.regenerate");
        expect(submit?.props.disabled).toBe(false);
        await page.handleRegenerateConfirm();
        expect(team ? api.regenerateSummary : api.regeneratePersonalSummary).toHaveBeenCalledWith(1, { topic: "instruction" });
        expect(api.saveGenerationConfig).not.toHaveBeenCalled();
        expect(page.state.detail?.title).toBe("Legacy title");
        if (!team) expect(page.state.detail?.topic).toBe("Preferred topic");
    });

    it("saves missing Agent scope through the existing full Workflow endpoint and restarts streaming", async () => {
        vi.mocked(api.regenerateSummary).mockResolvedValue({ task_id: 1 });
        const page = makePage();
        page.state.detail = { ...page.state.detail!, trigger_type: TriggerType.AGENT,
            summary_mode: SummaryMode.BY_PERSON, generation_requirement: "", sources: [], participants: [] };
        page.state.regenerateMode = "full";
        page.state.regenerateTopic = "Original Agent request";
        page.state.regenerateSources = [{ source_type: 1, source_id: "chat-1", source_name: "Team chat" }];
        // Drive from local-midnight Dates exactly as TimeRangePicker's date-only
        // onChange would, so the local→UTC day-boundary normalization production
        // performs is actually exercised (PR#1674 review). An ISO-UTC input would
        // hide it.
        const rangeStart = new Date(2026, 8, 1);
        const rangeEnd = new Date(2026, 8, 7);
        page.state.regenerateRange = { start: rangeStart, end: rangeEnd };
        const stream = vi.fn();
        (page as any).resetSummaryStreamForNewRun = stream;
        (page as any).loadDetail = vi.fn();
        await page.handleRegenerateConfirm();
        expect(api.regenerateSummary).toHaveBeenCalledWith(1, {
            topic: "Original Agent request",
            // source_name is stripped so the backend re-resolves the group name.
            sources: [{ source_type: 1, source_id: "chat-1" }],
            // end is the END of the selected day, not its midnight.
            time_range: {
                start: startOfLocalDay(rangeStart).toISOString(),
                end: endOfLocalDay(rangeEnd).toISOString(),
            },
        });
        expect(stream).toHaveBeenCalledWith(1);
        expect(api.createSchedule).not.toHaveBeenCalled();
        expect(page.state.showRegenerateModal).toBe(false);
    });

    it("allows Agent feedback refinement without requiring full Workflow scope", async () => {
        const page = makePage();
        page.state.detail = { ...page.state.detail!, trigger_type: TriggerType.AGENT,
            summary_mode: SummaryMode.BY_PERSON, sources: [], participants: [] };
        page.state.personalResult = { id: 20, version: 1, content: "Original body", citations: [] } as any;
        page.state.regenerateMode = "refine";
        page.state.refineFeedback = "Make it shorter";
        await page.handleRegenerateConfirm();
        expect(api.streamRefinePersonalSummary).toHaveBeenCalledWith(1, {
            feedback: "Make it shorter", base_result_id: 20, base_version: 1,
        }, expect.any(Object));
        expect(api.regenerateSummary).not.toHaveBeenCalled();
        expect(api.saveGenerationConfig).not.toHaveBeenCalled();
    });

  it("delegates continue-refine and confirmation navigation when controlled", () => {
    const onContinueRefine = vi.fn();
    const onViewConfirm = vi.fn();
    const page = makePage({ onContinueRefine, onViewConfirm });
    page.state = {
      ...page.state,
      detail: { ...page.state.detail, referenceable: true },
    } as any;

    page.handleContinueRefine();
    (page as any).handleViewConfirm();

    expect(onContinueRefine).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 1, title: "Legacy title" })
    );
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
      page.render(),
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
      page.render(),
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
