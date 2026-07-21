import React, { Component } from "react";
import {
    Button,
    Spin,
    Toast,
    Banner,
    Tag,
    Modal,
    Popconfirm,
} from "@douyinfe/semi-ui";
import { IconEdit, IconSend, IconClock, IconTick, IconClose, IconInfoCircle, IconHistory, IconUser, IconPlus, IconMinusCircle, IconExit, IconDelete } from "@douyinfe/semi-icons";
import { ChevronDown } from "lucide-react";
import { Channel, MessageText } from "wukongimjssdk";
import { I18nContext, t, ForwardService, interpretForwardResult } from "@octo/base";
import WKApp from "@octo/base/src/App";
import VoiceInputButton from "@octo/base/src/Components/VoiceInputButton";
import type { ReplaceMode, SelectionRange } from "@octo/base/src/Components/VoiceInputButton";
import { splitSummaryText } from "../utils/splitMessage";
import SummaryConfirmPage from "./SummaryConfirmPage";
import * as api from "../api/summaryApi";
import { SUMMARY_INPUT_MAX_LENGTH } from "../constants/limits";
// RefineSection 已移除 — 反馈修改改为在智能总结 chat 里引用总结迭代
// (见 CHAT-REFERENCE-BASED-DESIGN-v1)
import OverflowTooltip from "../components/OverflowTooltip";
import type {
    SummaryDetail,
    PersonalResult,
    MemberStatus,
    ScheduleItem,
    ScheduleConfig,
    WorkflowStage,
    SummaryVersionDetail,
    SummaryVersionItem,
} from "../types/summary";
import { TaskStatus, SummaryMode, ParticipantStatus, TriggerType } from "../types/summary";
import {
    formatDate,
    canCancel,
    canRegenerate,
    scheduleItemToConfig,
    scheduleToParams,
    formatScheduleSummary,
    shouldReactivateOnSave,
} from "../utils/summaryHelpers";
import CitationText from "../components/CitationText";
import SelectedSourcesPanel from "../components/SelectedSourcesPanel";
import ScheduleConfigModal from "../components/ScheduleConfigModal";
import MatterPickerModal from "../components/MatterPickerModal";
import * as matterBridge from "../api/matterBridge";
import SummaryEditor from "../components/SummaryEditor";
import SummaryVersionHistory from "../components/SummaryVersionHistory";
import MemberSelectorModal from "../components/MemberSelectorModal";
import type { MemberCandidate } from "../types/summary";

interface SummaryDetailPageProps {
    taskId?: number | string;
    /** Only the list-owned detail route emits list-highlight events. Embedded
     *  instances (ChatSummaryPanel, SummaryConfirmPage) must not pollute the
     *  list selection state. */
    emitSelection?: boolean;
}

// Matters 转发入口暂时隐藏，保留相关代码和弹窗，后续需要时打开此开关即可。
const SHOW_FORWARD_TO_MATTER = false;

type RegenerateMode = "refine" | "full";
type RefineLoadingTarget = "personal" | "team" | "summary";

interface SummaryDetailPageState {
    detail: SummaryDetail | null;
    loading: boolean;
    error: string | null;
    personalResult: PersonalResult | null;
    members: MemberStatus[];
    personalLoading: boolean;
    membersLoading: boolean;
    scheduleLoading: boolean;
    scheduleItem: ScheduleItem | null;
    scheduleDisabling: boolean;
    showScheduleConfig: boolean;
    scheduleConfig: ScheduleConfig | null;
    pendingScheduleInstruction: string;
    lastKnownStatus?: number;
    expandedReports: Record<string, boolean>;
    personalExpanded: boolean;
    isEditing: boolean;
    /** need3：行内编辑「自己的个人报告」中。 */
    editingPersonalReport: boolean;
    /** need4：行内编辑「团队总结」中（仅 creator）。 */
    editingTeamSummary: boolean;
    /** OCT-21：提交前编辑「我自己的个人报告」草稿中（行内编辑器接管「我（未提交）」行）。 */
    editingMyDraft: boolean;
    /** need7：成员选择器弹窗显隐。 */
    showAddMember: boolean;
    /** need7：添加成员提交中。 */
    addingMember: boolean;
    showMatterPicker: boolean;
    forwardingToMatter: boolean;
    showRegenerateModal: boolean;
    regenerateMode: RegenerateMode;
    regenerateTopic: string;
    refineFeedback: string;
    regenerateSubmitting: boolean;
    refineLoadingTarget: RefineLoadingTarget | null;
    versions: SummaryVersionItem[];
    versionsLoading: boolean;
    restoringVersionId: number | null;
    personalVersions: SummaryVersionItem[];
    personalVersionsLoading: boolean;
    restoringPersonalVersionId: number | null;
    showVersionDetailModal: boolean;
    versionDetailLoading: boolean;
    versionDetail: SummaryVersionDetail | null;
    versionDetailIsPersonal: boolean;
    /** V5：schedule 级一次性确认提交中 */
    confirmingSchedule: boolean;
    workflowDisplayIndex: number;
    workflowGateContent: boolean;
    workflowRevealDone: boolean;
    streaming: boolean;
    streamingContent: string;
    streamError: string | null;
    teamStreaming: boolean;
    teamStreamingContent: string;
    teamStreamError: string | null;
}

const INTER_MESSAGE_DELAY_MS = 200;
const PERSONAL_RESULT_POLL_INTERVAL_MS = 1500;
const WORKFLOW_COMPLETE_REVEAL_DELAY_MS = 650;

const SUMMARY_WORKFLOW_STAGES: Array<{ key: WorkflowStage; labelKey: string }> = [
    { key: "understand_question", labelKey: "summary.detail.workflowUnderstandQuestion" },
    { key: "find_relevant_chats", labelKey: "summary.detail.workflowFindRelevantChats" },
    { key: "filter_useful_content", labelKey: "summary.detail.workflowFilterUsefulContent" },
    { key: "analyze_chat_content", labelKey: "summary.detail.workflowAnalyzeChatContent" },
    { key: "generate_summary", labelKey: "summary.detail.workflowGenerateSummary" },
];

export default class SummaryDetailPage extends Component<SummaryDetailPageProps, SummaryDetailPageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private regenerateTopicRef = React.createRef<HTMLTextAreaElement>();

    private handleRegenerateTopicVoice = (
        text: string,
        mode: ReplaceMode,
        savedRange?: SelectionRange
    ) => {
        if (mode === "all") {
            this.setState({ regenerateTopic: text.slice(0, SUMMARY_INPUT_MAX_LENGTH) });
        } else if (mode === "selection" && savedRange) {
            this.setState((prev) => {
                const before = prev.regenerateTopic.slice(0, savedRange.from);
                const after = prev.regenerateTopic.slice(savedRange.to);
                const budget = Math.max(0, SUMMARY_INPUT_MAX_LENGTH - before.length - after.length);
                return { regenerateTopic: before + text.slice(0, budget) + after };
            });
        } else {
            this.setState((prev) => {
                const pos = savedRange?.from ?? prev.regenerateTopic.length;
                const before = prev.regenerateTopic.slice(0, pos);
                const after = prev.regenerateTopic.slice(pos);
                const budget = Math.max(0, SUMMARY_INPUT_MAX_LENGTH - before.length - after.length);
                return { regenerateTopic: before + text.slice(0, budget) + after };
            });
        }
    };

    state: SummaryDetailPageState = {
        detail: null,
        loading: false,
        error: null,
        personalResult: null,
        members: [],
        personalLoading: false,
        membersLoading: false,
        scheduleLoading: false,
        scheduleItem: null,
        scheduleDisabling: false,
        showScheduleConfig: false,
        scheduleConfig: null,
        expandedReports: {},
        personalExpanded: true,
        isEditing: false,
        editingPersonalReport: false,
        editingTeamSummary: false,
        editingMyDraft: false,
        showAddMember: false,
        addingMember: false,
        showMatterPicker: false,
        forwardingToMatter: false,
        showRegenerateModal: false,
        regenerateMode: "refine",
        regenerateTopic: "",
        refineFeedback: "",
        regenerateSubmitting: false,
        refineLoadingTarget: null,
        versions: [],
        versionsLoading: false,
        restoringVersionId: null,
        personalVersions: [],
        personalVersionsLoading: false,
        restoringPersonalVersionId: null,
        showVersionDetailModal: false,
        versionDetailLoading: false,
        versionDetail: null,
        versionDetailIsPersonal: false,
        pendingScheduleInstruction: "",
        confirmingSchedule: false,
        workflowDisplayIndex: -1,
        workflowGateContent: false,
        workflowRevealDone: false,
        streaming: false,
        streamingContent: "",
        streamError: null,
        teamStreaming: false,
        teamStreamingContent: "",
        teamStreamError: null,
    };

    private personalPollTimer: ReturnType<typeof setInterval> | null = null;
    private fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
    private fallbackStartTimeout: ReturnType<typeof setTimeout> | null = null;
    private workflowAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
    private workflowCompleteTimer: ReturnType<typeof setTimeout> | null = null;
    private streamAbortController: AbortController | null = null;
    private streamingTaskId: number | null = null;
    private streamClosedTaskId: number | null = null;
    private teamStreamAbortController: AbortController | null = null;
    private teamStreamingTaskId: number | null = null;
    private teamStreamClosedTaskId: number | null = null;
    private refineStreamAbortController: AbortController | null = null;
    private unmounted = false;
    private workflowTargetIndex = -1;
    private listPageActive = false;
    private lastEventTime = 0;
    private isPersonalPolling = false;
    // Blocking 5（跨 task 串台 / async race）：单调递增的「调度加载序列号」。
    // 每次发起一轮 detail+schedule 加载（loadDetail / 状态切换补拉 / 重新加载）都 bump，
    // loadSchedule 在 setState 前用「发起时捕获的 seq」与最新 seq 比对：不一致说明期间
    // 已切换 task 或重新加载，旧请求的响应必须丢弃，绝不污染当前 task 的 scheduleItem。
    private scheduleLoadSeq = 0;

    /** bump 并返回最新调度加载序列号；任何会改变「当前 scheduleItem 归属」的入口都应调用。 */
    private nextScheduleSeq(): number {
        this.scheduleLoadSeq += 1;
        return this.scheduleLoadSeq;
    }

    componentDidMount() {
        this.unmounted = false;
        window.addEventListener("summary-status-change", this.handleStatusChangeEvent);
        window.addEventListener("summary-batch-heartbeat", this.handleBatchHeartbeat);
        window.addEventListener("summary-list-unmount", this.handleListPageUnmount);
        this.loadDetail();
        if (this.props.emitSelection) {
            const activeTaskId = this.taskId;
            if (activeTaskId != null) {
                window.dispatchEvent(new CustomEvent("summary-detail-active", { detail: { taskId: activeTaskId } }));
            }
        }
    }

    componentDidUpdate(prevProps: any, prevState?: SummaryDetailPageState) {
        const prevTaskId = prevProps.taskId;
        const currentTaskId = this.detailLookupId;
        if (prevTaskId !== currentTaskId && currentTaskId != null) {
            this.listPageActive = false;
            this.clearAllTimers();
            // Blocking 5：切 task 立即清空上一 task 的 schedule 状态，避免在新 detail
            // 返回前闪现旧定时（bump seq 由 loadDetail 内部完成，令旧 loadSchedule 作废）。
            this.setState({
                scheduleItem: null,
                scheduleLoading: false,
                showRegenerateModal: false,
                regenerateSubmitting: false,
                refineLoadingTarget: null,
                showVersionDetailModal: false,
                versionDetailLoading: false,
                versionDetail: null,
                restoringVersionId: null,
                restoringPersonalVersionId: null,
                pendingScheduleInstruction: "",
                streamingContent: "",
                streamError: null,
                streaming: false,
                teamStreamingContent: "",
                teamStreamError: null,
                teamStreaming: false,
            });
            this.streamClosedTaskId = null;
            this.teamStreamClosedTaskId = null;
            this.loadDetail();
            if (this.props.emitSelection) {
                const nextActiveTaskId = this.taskId;
                if (nextActiveTaskId != null) {
                    window.dispatchEvent(new CustomEvent("summary-detail-active", { detail: { taskId: nextActiveTaskId } }));
                }
            }
        }
        if (prevState && prevState.showVersionDetailModal !== this.state.showVersionDetailModal) {
            this.syncVersionDetailScrollLock();
        }
    }

    componentWillUnmount() {
        this.unmounted = true;
        window.removeEventListener("summary-status-change", this.handleStatusChangeEvent);
        window.removeEventListener("summary-batch-heartbeat", this.handleBatchHeartbeat);
        window.removeEventListener("summary-list-unmount", this.handleListPageUnmount);
        this.setVersionDetailScrollLock(false);
        this.clearAllTimers();
        if (this.props.emitSelection) {
            const inactiveTaskId = this.taskId;
            if (inactiveTaskId != null) {
                window.dispatchEvent(new CustomEvent("summary-detail-inactive", { detail: { taskId: inactiveTaskId } }));
            }
        }
    }

    private clearAllTimers() {
        this.stopSummaryStream();
        this.stopTeamSummaryStream();
        this.stopRefineStream();
        if (this.personalPollTimer) {
            clearInterval(this.personalPollTimer);
            this.personalPollTimer = null;
        }
        this.stopFallbackPoll();
        if (this.workflowAdvanceTimer) {
            clearTimeout(this.workflowAdvanceTimer);
            this.workflowAdvanceTimer = null;
        }
        if (this.workflowCompleteTimer) {
            clearTimeout(this.workflowCompleteTimer);
            this.workflowCompleteTimer = null;
        }
        this.workflowTargetIndex = -1;
    }

    private setVersionDetailScrollLock(locked: boolean) {
        document.documentElement.classList.toggle("summary-version-detail-open", locked);
        document.body.classList.toggle("summary-version-detail-open", locked);
    }

    private syncVersionDetailScrollLock() {
        this.setVersionDetailScrollLock(this.state.showVersionDetailModal);
    }

    private workflowStageIndex(stage?: string): number {
        if (!stage) return -1;
        return SUMMARY_WORKFLOW_STAGES.findIndex((item) => item.key === stage);
    }

    private setWorkflowStageDirectly(index: number) {
        if (index < 0) return;
        if (this.workflowAdvanceTimer) {
            clearTimeout(this.workflowAdvanceTimer);
            this.workflowAdvanceTimer = null;
        }
        if (this.workflowCompleteTimer) {
            clearTimeout(this.workflowCompleteTimer);
            this.workflowCompleteTimer = null;
        }
        const nextIndex = Math.max(this.state.workflowDisplayIndex, index);
        this.workflowTargetIndex = nextIndex;
        this.setState({
            workflowDisplayIndex: nextIndex,
            workflowGateContent: true,
            workflowRevealDone: false,
        });
    }

    private finishWorkflowBriefly() {
        if (this.workflowAdvanceTimer) {
            clearTimeout(this.workflowAdvanceTimer);
            this.workflowAdvanceTimer = null;
        }
        if (this.workflowCompleteTimer) {
            clearTimeout(this.workflowCompleteTimer);
            this.workflowCompleteTimer = null;
        }
        const lastIndex = SUMMARY_WORKFLOW_STAGES.length - 1;
        this.workflowTargetIndex = lastIndex;
        this.setState({
            workflowDisplayIndex: lastIndex,
            workflowGateContent: true,
            workflowRevealDone: false,
        }, () => {
            this.workflowCompleteTimer = setTimeout(() => {
                this.workflowCompleteTimer = null;
                this.setState({ workflowRevealDone: true });
            }, WORKFLOW_COMPLETE_REVEAL_DELAY_MS);
        });
    }

    private shouldGateWorkflowForPersonalResult(result: PersonalResult): boolean {
        const { detail } = this.state;
        if (detail?.summary_mode !== SummaryMode.BY_PERSON) return false;

        const personalRunning = result.worker_status === 0 || result.worker_status === 1;
        const personalFailed = result.worker_status === 3;

        // 已经进入过生成态的页面，收到 completed 后保留一次短收尾；
        // 历史已完成总结首次打开时不 gate，避免闪现 workflow 卡片。
        return personalRunning || personalFailed || this.state.workflowGateContent;
    }

    private syncWorkflowProgress(result: PersonalResult) {
        const stageIndex = this.workflowStageIndex(result.workflow_stage);
        if (result.worker_status === 3) {
            if (this.workflowAdvanceTimer) {
                clearTimeout(this.workflowAdvanceTimer);
                this.workflowAdvanceTimer = null;
            }
            this.workflowTargetIndex = stageIndex >= 0
                ? stageIndex
                : Math.max(this.state.workflowDisplayIndex, 0);
            this.setState({
                workflowDisplayIndex: this.workflowTargetIndex,
                workflowGateContent: true,
                workflowRevealDone: false,
            });
            return;
        }
        if (result.worker_status === 2) {
            this.finishWorkflowBriefly();
            return;
        }
        if (result.worker_status === 0 || result.worker_status === 1) {
            this.setWorkflowStageDirectly(stageIndex >= 0 ? stageIndex : 0);
        }
    }

    get taskId(): number | null {
        // 数字 taskId 直接用；字符串 taskNo 深链时先返回 null，待 detail 落库后回填 detail.task_id。
        return typeof this.props.taskId === "number" ? this.props.taskId : this.state.detail?.task_id ?? null;
    }

    // 深链原始标识：数字 task_id 或字符串 task_no，仅用于首次 detail 拉取与切换检测。
    private get detailLookupId(): number | string | null {
        return this.props.taskId ?? null;
    }

    private shouldOperateOnTeamSummary(): boolean {
        const { detail } = this.state;
        return !!(
            detail?.summary_mode === SummaryMode.BY_PERSON &&
            this.isMultiCollab() &&
            detail.result &&
            detail.result_id
        );
    }

    private isMultiCollabRegenerating(): boolean {
        const { detail } = this.state;
        return !!(
            detail?.summary_mode === SummaryMode.BY_PERSON &&
            this.isMultiCollab() &&
            (detail.status === TaskStatus.PENDING || detail.status === TaskStatus.PROCESSING)
        );
    }

    async loadDetail() {
        const lookupId = this.detailLookupId;
        if (lookupId == null) return;
        // Blocking 5：每轮 detail 加载开始就 bump 序列号。这样旧 task 未完成的
        // loadSchedule（包括本函数下面发起的）都会被后续轮作废，不会回填到新 task。
        const seq = this.nextScheduleSeq();
        const requestTaskId = lookupId;
        // F1：切 task / 重拉 detail 时复位全部编辑态，避免旧 task 编辑态（尤其
        // editingTeamSummary）被带入新 task——否则切到非 creator 新 task 会绕过权限进编辑器。
        // FE-1（切任务竞态）：开始新 task 加载时同步清空上一 task 的 personalResult/members，
        // 避免旧任务成员报告 / 个人结果在新 detail 返回前残留显示（泄漏他人报告）。
        if (this.workflowAdvanceTimer) {
            clearTimeout(this.workflowAdvanceTimer);
            this.workflowAdvanceTimer = null;
        }
        if (this.workflowCompleteTimer) {
            clearTimeout(this.workflowCompleteTimer);
            this.workflowCompleteTimer = null;
        }
        this.workflowTargetIndex = -1;

        this.setState({
            loading: true,
            error: null,
            editingTeamSummary: false,
            editingPersonalReport: false,
            editingMyDraft: false,
            isEditing: false,
            personalResult: null,
            members: [],
            personalLoading: false,
            membersLoading: false,
            workflowDisplayIndex: -1,
            workflowGateContent: false,
            workflowRevealDone: false,
            refineLoadingTarget: null,
            versions: [],
            versionsLoading: false,
            restoringVersionId: null,
            personalVersions: [],
            personalVersionsLoading: false,
            restoringPersonalVersionId: null,
        });
        try {
            const detail = await api.getSummaryDetail(lookupId);
            // detail 本身也可能是旧请求：期间切了 task / 又发了一轮 loadDetail 就丢弃。
            if (this.scheduleLoadSeq !== seq || this.detailLookupId !== requestTaskId) return;
            this.setState({
                detail,
                loading: false,
                lastKnownStatus: detail.status,
                workflowGateContent: false,
            });
            if (detail.status === TaskStatus.COMPLETED && detail.result_id) {
                const markRead = api.markSummaryRead;
                if (markRead) void markRead(detail.task_id, { team_result_id: detail.result_id }).then((attention) => {
                    // Guard with the request sequence/lookup key rather than
                    // comparing numeric detail.task_id with a task_no deep-link.
                    if (this.scheduleLoadSeq === seq && this.detailLookupId === requestTaskId) {
                        window.dispatchEvent(new CustomEvent("summary-read", {
                            detail: {
                                taskId: detail.task_id,
                                isUnread: attention.is_unread,
                                needsAttention: attention.needs_attention,
                            },
                        }));
                    }
                }).catch(() => { /* keep unread on failure */ });
            }
            if (detail.status === TaskStatus.COMPLETED && detail.result) {
                this.loadVersions(detail.task_id);
            }

            // Blocking 5（跨 task 串台）：scheduleItem 必须始终对应当前 detail。
            // 同步部分：从「有定时」总结导航到「无定时」总结时，若不显式清空，旧 scheduleItem
            // 会残留 → renderScheduleButton 误判有定时、保存可能把旧定时重绑到新 task。
            // 异步部分：loadSchedule 带上 seq，响应迟到时对比 seq/taskId 才 setState（见 loadSchedule）。
            if (detail.schedule_id && detail.schedule_id > 0) {
                this.loadSchedule(detail.schedule_id, seq);
            } else {
                this.setState({ scheduleItem: null, scheduleLoading: false });
            }

            // Start fallback poll if task is in progress
            if (
                detail.status === TaskStatus.PROCESSING ||
                detail.status === TaskStatus.PENDING ||
                detail.status === TaskStatus.WAITING_CONFIRM
            ) {
                this.startFallbackPoll();
                if (detail.summary_mode === SummaryMode.BY_PERSON && this.streamClosedTaskId !== detail.task_id) {
                    this.startSummaryStream(detail.task_id);
                }
                const isMultiByPerson = detail.summary_mode === SummaryMode.BY_PERSON && ((detail.participants?.length || 0) > 1);
                if (isMultiByPerson && this.teamStreamClosedTaskId !== detail.task_id) {
                    this.startTeamSummaryStream(detail.task_id);
                }
            } else {
                this.stopFallbackPoll();
                this.stopSummaryStream(true);
                this.stopTeamSummaryStream();
                this.setState({ teamStreaming: false, teamStreamingContent: "", teamStreamError: null });
            }
            // Load BY_PERSON data
            if (detail.summary_mode === SummaryMode.BY_PERSON) {
                // FE-1：把本轮 seq 传给二次异步加载，迟到响应按 seq/taskId 校验后才 setState。
                // 字符串 taskNo 深链时 this.taskId 依赖 state.detail（setState 未提交会为 null），
                // 故显式传入刚拿到的 detail.task_id（数字），避开 setState 竞态。
                this.loadPersonalResult(seq, false, detail.task_id);
                this.loadMembers(seq, detail.task_id);
            }
        } catch (err: any) {
            // FE-1（切 task 竞态）：迟到的失败响应也要校验归属，否则旧 task 的加载失败
            // 会把错误/loading 状态写到已切换的新 task 上。
            if (this.scheduleLoadSeq !== seq || this.detailLookupId !== requestTaskId) return;
            this.setState({ error: err.message || t("summary.common.loadingFailed"), loading: false });
        }
    }

    /**
     * Blocking 5（async race）：只有当发起请求时捕获的 seq 与当前 seq 一致、
     * 且 taskId 未变时，才能把响应写回 scheduleItem。不传 seq 时（handleScheduleSave
     * 等同一 task 内的主动刷新）自动 bump 一个新 seq 作为基准，语义上代表
     * 「这次是最新的一次 schedule 加载」。
     */
    async loadSchedule(scheduleId: number, seq?: number) {
        const reqSeq = seq ?? this.nextScheduleSeq();
        const requestTaskId = this.taskId;
        this.setState({ scheduleLoading: true });
        try {
            const item = await api.getSchedule(scheduleId);
            // 旧请求（期间又发了一轮加载 / 切了 task）迟到 resolve：丢弃，不污染新 task。
            if (this.scheduleLoadSeq !== reqSeq || this.taskId !== requestTaskId) return;
            this.setState({ scheduleItem: item, scheduleLoading: false });
        } catch {
            // 同样：只有仍是最新请求才允许清空，避免旧请求的失败反而抹掉新 task 的定时。
            if (this.scheduleLoadSeq !== reqSeq || this.taskId !== requestTaskId) return;
            // Blocking 5：加载失败也要清空 scheduleItem，避免上一条总结的定时残留，
            // 保证 scheduleItem 始终对应当前 detail（宁可显示「设置定时」也不串台）。
            this.setState({ scheduleItem: null, scheduleLoading: false });
        }
    }

    /**
     * FE-1（切 task 竞态）：与 loadSchedule 同风格的「请求归属校验」。
     * 进入时捕获 reqSeq（不传则自动 bump，代表「本次是最新一次加载」，供
     * 同一 task 内主动刷新复用）与 requestTaskId；异步返回后只有 seq + taskId
     * 仍一致才能 setState。过期响应（期间切了 task / 又发了一轮加载）一律
     * 忽略（return），绝不把旧任务的 personalResult 写到新任务界面（泄漏他人报告）。
     */
    async loadPersonalResult(seq?: number, suppressWorkflow = false, taskIdOverride?: number) {
        const requestTaskId = taskIdOverride ?? this.taskId;
        if (requestTaskId == null) return;
        const reqSeq = seq ?? this.nextScheduleSeq();
        this.setState({ personalLoading: true });
        try {
            const result = await api.getPersonalResult(requestTaskId);
            // 迟到响应（期间切 task / 重新加载）：丢弃，不污染新 task。
            // 字符串 taskNo 首次加载时 detail 的 setState 可能未提交，this.taskId 为 null；
            // seq 已能盖住真切 task，故 taskId 只在「已提交且确实不同」时才丢弃，避免静默丢掉首载。
            if (this.scheduleLoadSeq !== reqSeq || (this.taskId != null && this.taskId !== requestTaskId)) return;
            const shouldGateWorkflow = !suppressWorkflow && this.shouldGateWorkflowForPersonalResult(result);
            if (shouldGateWorkflow) {
                this.setState({
                    personalResult: result,
                    personalLoading: false,
                    workflowGateContent: true,
                }, () => this.syncWorkflowProgress(result));
            } else {
                this.setState({
                    personalResult: result,
                    personalLoading: false,
                    workflowGateContent: false,
                    workflowRevealDone: true,
                    workflowDisplayIndex: this.workflowStageIndex(result.workflow_stage),
                });
            }
            this.startPersonalPoll(result.worker_status);
            if (result.current_version_id && result.content?.trim()) {
                const markRead = api.markSummaryRead;
                if (markRead) void markRead(requestTaskId, { personal_version_id: result.current_version_id }).then((attention) => {
                    if (this.scheduleLoadSeq === reqSeq && (this.taskId == null || this.taskId === requestTaskId)) {
                        window.dispatchEvent(new CustomEvent("summary-read", {
                            detail: {
                                taskId: requestTaskId,
                                isUnread: attention.is_unread,
                                needsAttention: attention.needs_attention,
                            },
                        }));
                    }
                }).catch(() => { /* keep unread on failure */ });
            }
            if (result.content?.trim()) {
                this.loadPersonalVersions(requestTaskId);
            } else if (this.taskId == null || this.taskId === requestTaskId) {
                this.setState({ personalVersions: [], personalVersionsLoading: false });
            }
        } catch {
            if (this.scheduleLoadSeq !== reqSeq || (this.taskId != null && this.taskId !== requestTaskId)) return;
            this.setState({ personalLoading: false });
        }
    }

    /**
     * FE-1（切 task 竞态）：同 loadPersonalResult——迟到的 getMembers 响应不能
     * 把旧 task 的成员名单 setState 到新 task（否则泄漏他人报告 / 污染 team
     * citations、schedule participant 写入）。seq/taskId 不一致一律忽略。
     */
    async loadMembers(seq?: number, taskIdOverride?: number) {
        const requestTaskId = taskIdOverride ?? this.taskId;
        if (requestTaskId == null) return;
        const reqSeq = seq ?? this.nextScheduleSeq();
        this.setState({ membersLoading: true });
        try {
            const members = await api.getMembers(requestTaskId);
            if (this.scheduleLoadSeq !== reqSeq || (this.taskId != null && this.taskId !== requestTaskId)) return;
            this.setState({ members, membersLoading: false });
        } catch {
            if (this.scheduleLoadSeq !== reqSeq || (this.taskId != null && this.taskId !== requestTaskId)) return;
            this.setState({ membersLoading: false });
        }
    }

    startPersonalPoll(workerStatus: number) {
        if (this.personalPollTimer) clearInterval(this.personalPollTimer);
        if (workerStatus === 0 || workerStatus === 1) {
            this.personalPollTimer = setInterval(async () => {
                if (this.taskId == null) return;
                if (this.isPersonalPolling) return;
                this.isPersonalPolling = true;
                // 续修2：捕获本 tick 发起时的 taskId。轮询是周期性的——不每 tick 抢 seq
                // （会与其它同 task 加载互杀），只用 requestTaskId 守卫：切 task 后迟到响应
                // 必丢弃，同 task 合法加载不误杀。
                const requestTaskId = this.taskId;
                try {
                    const result = await api.getPersonalResult(this.taskId);
                    // 切 task 后（clearInterval 停不住已在途请求）迟到响应：丢弃，不串台。
                    if (this.taskId !== requestTaskId) return;
                    this.setState({
                        personalResult: result,
                        workflowGateContent: true,
                    }, () => this.syncWorkflowProgress(result));
                    if (result.worker_status !== 0 && result.worker_status !== 1) {
                        if (this.personalPollTimer) clearInterval(this.personalPollTimer);
                        // 终态一次性补拉 members：轮询已停，给它一个新 seq 即可。
                        this.loadMembers(this.nextScheduleSeq());
                    }
                } catch {
                    // ignore poll errors
                } finally {
                    this.isPersonalPolling = false;
                }
            }, PERSONAL_RESULT_POLL_INTERVAL_MS);
        }
    }

    handleSubmitPersonal = async () => {
        if (this.taskId == null) return;
        try {
            await api.submitPersonalResult(this.taskId);
            Toast.success(t("summary.detail.submitSuccess"));
            // 续修1：成对 refresh 共用一个 seq，避免互相作废。
            const seq = this.nextScheduleSeq();
            this.loadPersonalResult(seq);
            this.loadMembers(seq);
            // F1：最后一人提交后团队总结/状态由 meta 聚合产生，team 区读 state.detail，
            // 必须 loadDetail 才能刷出新团队总结与状态，否则显示旧数据。
            this.loadDetail();
        } catch (err: any) {
            Toast.error(err.message || t("summary.detail.submitFailed"));
        }
    };

    handleRespondToTask = async (action: "accept" | "reject") => {
        if (this.taskId == null) return;
        try {
            await api.respondToTask(this.taskId, action);
            Toast.success(action === "accept" ? t("summary.action.accepted") : t("summary.action.rejected"));
            this.loadDetail();
            // 问题2：accept/reject 成功后需通知左侧列表刷新状态（否则仍显“待确认”）。
            // SummaryListPage 监听 "summary-task-regenerated" → loadData() 全量重拉，
            // 是实际能刷新列表卡片状态的事件；同时保留 "summary-status-change"
            // （携 taskIds，与现有广播机制一致）供详情页自身及其他潜在监听者。
            window.dispatchEvent(new CustomEvent("summary-status-change", { detail: { taskIds: [this.taskId] } }));
            window.dispatchEvent(new CustomEvent("summary-task-regenerated", { detail: { taskIds: [this.taskId] } }));
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    // 问题3：creator 移除某成员。成功后重拉详情（后端已重算团队总结）。
    handleRemoveMember = async (uid: string) => {
        if (this.taskId == null) return;
        const requestTaskId = this.taskId;
        try {
            await api.removeMember(this.taskId, uid);
            // FE-1（切 task 竞态）：await 期间可能已切走，迟到响应不能在新 task 上弹提示/重拉。
            if (this.taskId !== requestTaskId) return;
            Toast.success(t("summary.detail.removeMemberSuccess"));
            this.loadDetail();
        } catch (err: any) {
            if (this.taskId !== requestTaskId) return;
            Toast.error(err.message || t("summary.detail.removeMemberFailed"));
        }
    };

    // 问题3：非 creator 参与者退出多人协作。成功后返回列表（popToRoot 回到根）。
    handleLeaveTask = async () => {
        if (this.taskId == null) return;
        const requestTaskId = this.taskId;
        try {
            await api.leaveSummary(this.taskId);
            // FE-1（切 task 竞态）：await 期间可能已切走，迟到响应不能在新 task 上弹提示/导航。
            if (this.taskId !== requestTaskId) return;
            Toast.success(t("summary.detail.leaveSuccess"));
            WKApp.routeRight.popToRoot();
            WKApp.mittBus.emit("summary-list-refresh-requested" as any);
        } catch (err: any) {
            if (this.taskId !== requestTaskId) return;
            Toast.error(err.message || t("summary.detail.leaveFailed"));
        }
    };

    handleDeleteTask = async () => {
        if (this.taskId == null) return;
        const requestTaskId = this.taskId;
        try {
            await api.deleteSummary(this.taskId);
            if (this.taskId !== requestTaskId) return;
            Toast.success(t("summary.list.deleteSuccess"));
            WKApp.routeRight.popToRoot();
            WKApp.mittBus.emit("summary-list-refresh-requested" as any);
        } catch (err: any) {
            if (this.taskId !== requestTaskId) return;
            Toast.error(err.message || t("summary.common.deleteFailed"));
        }
    };

    private handleBatchHeartbeat = (event: Event) => {
        if (this.taskId == null) return;
        const taskIds: number[] | undefined = (event as CustomEvent).detail?.taskIds;
        if (!taskIds || !taskIds.includes(this.taskId)) return;

        this.listPageActive = true;
        this.lastEventTime = Date.now();
        this.stopFallbackPoll();
    };

    private handleStatusChangeEvent = async (event: Event) => {
        if (this.taskId == null) return;

        const detail_ = (event as CustomEvent).detail;
        const taskIds: number[] | undefined = detail_?.taskIds;
        if (!taskIds || !taskIds.includes(this.taskId)) return;

        this.listPageActive = true;
        this.lastEventTime = Date.now();
        this.stopFallbackPoll();

        try {
            // 续修3：await 前捕获 requestTaskId。task A 状态事件触发后、await 未返回前切到
            // task B，A 的 detail（含 result.team_citations）不得 setState 到 B 页面（A detail +
            // B members/personal 混搭串台）。迟到直接 return，后续 prevStatus 判断 / 成对
            // reload 都在这道守卫之后。
            const requestTaskId = this.taskId;
            const detail = await api.getSummaryDetail(this.taskId);
            if (this.taskId !== requestTaskId) return;
            const prevStatus = this.state.lastKnownStatus;
            const newStatus = detail.status;
            this.setState({ detail, lastKnownStatus: newStatus });

            if (prevStatus !== undefined && prevStatus !== newStatus) {
                if (
                    newStatus === TaskStatus.COMPLETED ||
                    newStatus === TaskStatus.FAILED ||
                    newStatus === TaskStatus.CANCELLED
                ) {
                    if (detail.summary_mode === SummaryMode.BY_PERSON) {
                        // 续修1：一个刷新周期共用一个 seq，避免成对调用各自
                        // nextScheduleSeq() 互相作废（第二个把第一个的 reqSeq 作废，
                        // 导致第一个响应被守卫丢弃 / personalLoading 卡 true）。
                        const seq = this.nextScheduleSeq();
                        this.loadPersonalResult(seq);
                        this.loadMembers(seq);
                    }
                }
            }
        } catch {
            // ignore
        }
    };

    private handleListPageUnmount = () => {
        this.listPageActive = false;
        const status = this.state.lastKnownStatus;
        if (
            status === TaskStatus.PENDING ||
            status === TaskStatus.WAITING_CONFIRM ||
            status === TaskStatus.PROCESSING
        ) {
            this.startFallbackPoll();
        }
    };

    private startFallbackPoll() {
        if (this.fallbackPollTimer || this.fallbackStartTimeout) return;

        if (this.listPageActive && Date.now() - this.lastEventTime > 15000) {
            this.listPageActive = false;
        }
        if (this.listPageActive) return;

        this.fallbackStartTimeout = setTimeout(() => {
            this.fallbackStartTimeout = null;
            if (this.listPageActive) return;

            this.doFallbackPollOnce();

            this.fallbackPollTimer = setInterval(async () => {
                this.doFallbackPollOnce();
            }, 15000);
        }, 5000);
    }

    private async doFallbackPollOnce() {
        if (this.taskId == null) return;
        // 续修4：tick 开始处捕获 requestTaskId，整个 tick 内 batchStatus / getSummaryDetail
        // 及 await 后所有 setState 都用这一个 requestTaskId 守卫：兑底轮询 await 期间切
        // task，旧 task 的 team result/citations 不得写进新 task 页。
        const requestTaskId = this.taskId;
        try {
            const updates = await api.batchStatus([this.taskId]);
            if (this.taskId !== requestTaskId) return;
            const update = updates.find(u => u.id === requestTaskId);
            if (!update) return;

            const prevStatus = this.state.lastKnownStatus;
            const newStatus = update.status;

            if (prevStatus !== undefined && prevStatus !== newStatus) {
                try {
                    const detail = await api.getSummaryDetail(this.taskId);
                    if (this.taskId !== requestTaskId) return;
                    this.setState({ detail, lastKnownStatus: newStatus });
                    if (
                        newStatus === TaskStatus.COMPLETED ||
                        newStatus === TaskStatus.FAILED ||
                        newStatus === TaskStatus.CANCELLED
                    ) {
                        this.stopFallbackPoll();
                        // 续修1：本轮刷新共用一个 seq，传给所有子加载（personal/members/schedule），
                        // 避免多次 nextScheduleSeq() 互相作废。
                        const seq = this.nextScheduleSeq();
                        if (detail.summary_mode === SummaryMode.BY_PERSON) {
                            this.loadPersonalResult(seq);
                            this.loadMembers(seq);
                        }
                        if (detail.schedule_id && detail.schedule_id > 0) {
                            this.loadSchedule(detail.schedule_id, seq);
                        }
                    }
                } catch {
                    // Don't advance lastKnownStatus — retry on next tick
                }
            }
        } catch {
            // ignore polling errors
        }
    }

    private stopFallbackPoll() {
        if (this.fallbackStartTimeout) {
            clearTimeout(this.fallbackStartTimeout);
            this.fallbackStartTimeout = null;
        }
        if (this.fallbackPollTimer) {
            clearInterval(this.fallbackPollTimer);
            this.fallbackPollTimer = null;
        }
    }


    private startSummaryStream(taskId: number) {
        if (this.streamClosedTaskId === taskId) return;
        if (this.streamingTaskId === taskId && this.streamAbortController) return;
        this.stopSummaryStream();
        const controller = new AbortController();
        this.streamAbortController = controller;
        this.streamingTaskId = taskId;
        this.setState({ streaming: true, streamError: null, streamingContent: "" });
        let terminalReceived = false;
        void api.streamSummary(taskId, {
            scope: "personal",
            signal: controller.signal,
            onEvent: (event) => {
                if (this.taskId !== taskId) return;
                if (event.type === "start") {
                    this.setState({ streamingContent: "", streamError: null });
                    return;
                }
                if (event.type === "stage" && event.stage) {
                    const idx = this.workflowStageIndex(event.stage);
                    if (idx >= 0) this.setWorkflowStageDirectly(idx);
                    return;
                }
                if (event.type === "delta") {
                    if (event.content) {
                        this.setState({ streamingContent: event.content });
                    } else if (event.delta) {
                        this.setState((prev) => ({ streamingContent: prev.streamingContent + event.delta }));
                    }
                    return;
                }
                if (event.type === "snapshot") {
                    this.setState({ streamingContent: event.content || "" });
                    return;
                }
                if (event.type === "done") {
                    terminalReceived = true;
                    this.streamAbortController = null;
                    this.streamingTaskId = null;
                    this.streamClosedTaskId = taskId;
                    this.setState({ streaming: false });
                    this.loadDetail();
                    return;
                }
                if (event.type === "error") {
                    terminalReceived = true;
                    this.streamAbortController = null;
                    this.streamingTaskId = null;
                    this.streamClosedTaskId = taskId;
                    this.setState({ streaming: false, streamError: event.message || null });
                    this.loadDetail();
                }
            },
        }).then(() => {
            if (terminalReceived || controller.signal.aborted || this.taskId !== taskId) return;
            this.streamAbortController = null;
            this.streamingTaskId = null;
            this.streamClosedTaskId = taskId;
            this.setState({ streaming: false });
            this.startFallbackPoll();
        }).catch((err: any) => {
            if (controller.signal.aborted || this.taskId !== taskId) return;
            this.streamAbortController = null;
            this.streamingTaskId = null;
            this.streamClosedTaskId = taskId;
            this.setState({ streaming: false, streamError: err?.message || null });
            // Keep the existing polling path as the reliability fallback.
            this.startFallbackPoll();
        });
    }

    private stopSummaryStream(resetState = false) {
        if (this.streamAbortController) {
            this.streamAbortController.abort();
            this.streamAbortController = null;
        }
        this.streamingTaskId = null;
        if (resetState && !this.unmounted) {
            this.setState({ streaming: false, streamingContent: "", streamError: null });
        }
    }

    private stopRefineStream() {
        if (this.refineStreamAbortController) {
            this.refineStreamAbortController.abort();
            this.refineStreamAbortController = null;
        }
    }

    private isRefineDonePayload(event: api.SummaryStreamEvent) {
        return event.type === "done" && (
            event.result_id != null ||
            event.version != null ||
            event.version_id != null ||
            event.content != null ||
            event.citations != null ||
            event.team_citations != null ||
            event.generated_at != null
        );
    }

    private resetSummaryStreamForNewRun(taskId: number) {
        this.stopSummaryStream();
        this.streamClosedTaskId = null;
        this.setState({ streaming: false, streamingContent: "", streamError: null });
        if (this.taskId === taskId) {
            this.startSummaryStream(taskId);
        }
    }

    private startTeamSummaryStream(taskId: number) {
        if (this.teamStreamClosedTaskId === taskId) return;
        if (this.teamStreamingTaskId === taskId && this.teamStreamAbortController) return;
        this.stopTeamSummaryStream();
        const controller = new AbortController();
        this.teamStreamAbortController = controller;
        this.teamStreamingTaskId = taskId;
        this.setState({ teamStreaming: true, teamStreamError: null, teamStreamingContent: "" });
        let terminalReceived = false;
        void api.streamSummary(taskId, {
            scope: "team",
            signal: controller.signal,
            onEvent: (event) => {
                if (this.taskId !== taskId) return;
                if (event.type === "start") {
                    this.setState({ teamStreamingContent: "", teamStreamError: null });
                    return;
                }
                if (event.type === "delta") {
                    if (event.content) {
                        this.setState({ teamStreamingContent: event.content });
                    } else if (event.delta) {
                        this.setState((prev) => ({ teamStreamingContent: prev.teamStreamingContent + event.delta }));
                    }
                    return;
                }
                if (event.type === "snapshot") {
                    this.setState({ teamStreamingContent: event.content || "" });
                    return;
                }
                if (event.type === "done") {
                    terminalReceived = true;
                    this.teamStreamAbortController = null;
                    this.teamStreamingTaskId = null;
                    this.teamStreamClosedTaskId = taskId;
                    this.setState({ teamStreaming: false });
                    this.loadDetail();
                    return;
                }
                if (event.type === "error") {
                    terminalReceived = true;
                    this.teamStreamAbortController = null;
                    this.teamStreamingTaskId = null;
                    this.teamStreamClosedTaskId = taskId;
                    this.setState({ teamStreaming: false, teamStreamError: event.message || null });
                    this.loadDetail();
                }
            },
        }).then(() => {
            if (terminalReceived || controller.signal.aborted || this.taskId !== taskId) return;
            this.teamStreamAbortController = null;
            this.teamStreamingTaskId = null;
            this.teamStreamClosedTaskId = taskId;
            this.setState({ teamStreaming: false });
            this.startFallbackPoll();
        }).catch((err: any) => {
            if (controller.signal.aborted || this.taskId !== taskId) return;
            this.teamStreamAbortController = null;
            this.teamStreamingTaskId = null;
            this.teamStreamClosedTaskId = taskId;
            this.setState({ teamStreaming: false, teamStreamError: err?.message || null });
            this.startFallbackPoll();
        });
    }

    private stopTeamSummaryStream() {
        if (this.teamStreamAbortController) {
            this.teamStreamAbortController.abort();
            this.teamStreamAbortController = null;
        }
        this.teamStreamingTaskId = null;
    }

    private resetTeamSummaryStreamForNewRun(taskId: number) {
        this.stopTeamSummaryStream();
        this.teamStreamClosedTaskId = null;
        this.setState({ teamStreaming: false, teamStreamingContent: "", teamStreamError: null });
        if (this.taskId === taskId) {
            this.startTeamSummaryStream(taskId);
        }
    }

    handleRegenerate = () => {
        const { detail } = this.state;
        if (this.taskId == null) return;
        this.setState({
            showRegenerateModal: true,
            regenerateMode: "refine",
            regenerateTopic: detail?.title || "",
            refineFeedback: "",
        });
    };

    async loadVersions(taskId = this.taskId) {
        if (taskId == null) return;
        this.setState({ versionsLoading: true });
        try {
            const resp = await api.listSummaryVersions(taskId, 3);
            if (this.taskId !== taskId) return;
            this.setState({ versions: resp.versions || [], versionsLoading: false });
        } catch {
            if (this.taskId !== taskId) return;
            this.setState({ versions: [], versionsLoading: false });
        }
    }

    async loadPersonalVersions(taskId = this.taskId) {
        if (taskId == null) return;
        this.setState({ personalVersionsLoading: true });
        try {
            const resp = await api.listPersonalSummaryVersions(taskId, 3);
            if (this.taskId !== taskId) return;
            this.setState({ personalVersions: resp.versions || [], personalVersionsLoading: false });
        } catch {
            if (this.taskId !== taskId) return;
            this.setState({ personalVersions: [], personalVersionsLoading: false });
        }
    }

    handleRegenerateConfirm = async () => {
        if (this.taskId == null || this.state.regenerateSubmitting) return;
        const requestTaskId = this.taskId;
        const { detail, regenerateMode } = this.state;
        const trimmed = regenerateMode === "refine"
            ? this.state.refineFeedback.trim()
            : this.state.regenerateTopic.trim();
        if (!trimmed) return;
        this.stopRefineStream();
        this.setState({ regenerateSubmitting: true });
        let restoreRefineDraft: (() => void) | null = null;
        let currentRefineController: AbortController | null = null;
        try {
            const operateOnTeamSummary = this.shouldOperateOnTeamSummary();
            if (regenerateMode === "refine") {
                if (detail?.summary_mode === SummaryMode.BY_PERSON && !operateOnTeamSummary) {
                    const baseResultId = this.state.personalResult?.id;
                    if (!baseResultId) return;
                    const previousPersonalResult = this.state.personalResult;
                    const previousMembers = this.state.members;
                    restoreRefineDraft = () => {
                        if (this.taskId === requestTaskId) this.setState({ personalResult: previousPersonalResult, members: previousMembers });
                    };
                    this.setState({ showRegenerateModal: false, refineLoadingTarget: "personal" });
                    const refineController = new AbortController();
                    currentRefineController = refineController;
                    this.refineStreamAbortController = refineController;
                    let draft = "";
                    let refined: api.SummaryStreamEvent | null = null;
                    await api.streamRefinePersonalSummary(requestTaskId, {
                        feedback: trimmed,
                        base_result_id: baseResultId,
                        base_version: this.state.personalResult?.version,
                    }, {
                        signal: refineController.signal,
                        onEvent: (event) => {
                            if (this.taskId !== requestTaskId || refineController.signal.aborted) return;
                            if (event.type === "delta") {
                                draft = event.content || (draft + (event.delta || ""));
                                const myUid = WKApp.loginInfo.uid;
                                this.setState((prev) => ({
                                    personalResult: prev.personalResult ? { ...prev.personalResult, content: draft } : prev.personalResult,
                                    members: prev.members.map((m) => m.user_id === myUid ? { ...m, content: draft } : m),
                                } as Pick<SummaryDetailPageState, "personalResult" | "members">));
                                return;
                            }
                            if (event.type === "snapshot") {
                                draft = event.content || "";
                                const myUid = WKApp.loginInfo.uid;
                                this.setState((prev) => ({
                                    personalResult: prev.personalResult ? { ...prev.personalResult, content: draft } : prev.personalResult,
                                    members: prev.members.map((m) => m.user_id === myUid ? { ...m, content: draft } : m),
                                } as Pick<SummaryDetailPageState, "personalResult" | "members">));
                                return;
                            }
                            if (event.type === "error") {
                                throw new Error(event.message || t("summary.common.operationFailed"));
                            }
                            if (this.isRefineDonePayload(event)) {
                                refined = event;
                            }
                        },
                    });
                    if (this.refineStreamAbortController === refineController) this.refineStreamAbortController = null;
                    if (this.taskId !== requestTaskId || refineController.signal.aborted) return;
                    if (!refined) throw new Error(t("summary.common.operationFailed"));
                    restoreRefineDraft = null;
                    Toast.success(t("summary.detail.refineSuccess"));
                    this.appendLocalScheduleInstruction(trimmed);
                    this.reloadScheduleAfterInstructionChange(requestTaskId);
                    this.setState((prev) => {
                        const nextPersonal = prev.personalResult ? {
                            ...prev.personalResult,
                            id: refined!.result_id || prev.personalResult.id,
                            version: refined!.version || prev.personalResult.version,
                            content: refined!.content || draft,
                            citations: (refined!.citations as any) || prev.personalResult.citations,
                            msg_count: refined!.msg_count ?? prev.personalResult.msg_count,
                            generated_at: refined!.generated_at || prev.personalResult.generated_at,
                        } : prev.personalResult;
                        const myUid = WKApp.loginInfo.uid;
                        return {
                            showRegenerateModal: false,
                            refineLoadingTarget: null,
                            personalResult: nextPersonal,
                            members: prev.members.map((m) => m.user_id === myUid ? {
                                ...m,
                                content: refined!.content || draft,
                                citations: (refined!.citations as any) || m.citations,
                            } : m),
                        } as Pick<SummaryDetailPageState, "showRegenerateModal" | "refineLoadingTarget" | "personalResult" | "members">;
                    });
                    this.loadPersonalVersions(this.taskId);
                } else {
                    const baseResultId = detail?.result_id;
                    if (!baseResultId) return;
                    const previousDetail = this.state.detail;
                    restoreRefineDraft = () => {
                        if (this.taskId === requestTaskId) this.setState({ detail: previousDetail });
                    };
                    this.setState({
                        showRegenerateModal: false,
                        refineLoadingTarget: operateOnTeamSummary ? "team" : "summary",
                    });
                    const refineController = new AbortController();
                    currentRefineController = refineController;
                    this.refineStreamAbortController = refineController;
                    let draft = "";
                    let refined: api.SummaryStreamEvent | null = null;
                    await api.streamRefineSummary(requestTaskId, { feedback: trimmed, base_result_id: baseResultId }, {
                        signal: refineController.signal,
                        onEvent: (event) => {
                            if (this.taskId !== requestTaskId || refineController.signal.aborted) return;
                            if (event.type === "delta") {
                                draft = event.content || (draft + (event.delta || ""));
                                this.setState((prev) => {
                                    if (!prev.detail?.result) return null;
                                    return {
                                        detail: {
                                            ...prev.detail,
                                            result: { ...prev.detail.result, content: draft },
                                        },
                                    } as Pick<SummaryDetailPageState, "detail">;
                                });
                                return;
                            }
                            if (event.type === "snapshot") {
                                draft = event.content || "";
                                this.setState((prev) => {
                                    if (!prev.detail?.result) return null;
                                    return {
                                        detail: {
                                            ...prev.detail,
                                            result: { ...prev.detail.result, content: draft },
                                        },
                                    } as Pick<SummaryDetailPageState, "detail">;
                                });
                                return;
                            }
                            if (event.type === "error") {
                                throw new Error(event.message || t("summary.common.operationFailed"));
                            }
                            if (this.isRefineDonePayload(event)) {
                                refined = event;
                            }
                        },
                    });
                    if (this.refineStreamAbortController === refineController) this.refineStreamAbortController = null;
                    if (this.taskId !== requestTaskId || refineController.signal.aborted) return;
                    if (!refined) throw new Error(t("summary.common.operationFailed"));
                    restoreRefineDraft = null;
                    Toast.success(t("summary.detail.refineSuccess"));
                    this.appendLocalScheduleInstruction(trimmed);
                    this.reloadScheduleAfterInstructionChange(requestTaskId);
                    this.setState((prev) => {
                        if (!prev.detail?.result) return { showRegenerateModal: false, refineLoadingTarget: null } as Pick<SummaryDetailPageState, "showRegenerateModal" | "refineLoadingTarget">;
                        return {
                            showRegenerateModal: false,
                            refineLoadingTarget: null,
                            detail: {
                                ...prev.detail,
                                result_id: refined!.result_id || prev.detail.result_id,
                                result: {
                                    ...prev.detail.result,
                                    content: refined!.content || draft,
                                    version: refined!.version || prev.detail.result.version,
                                    citations: (refined!.citations as any) || prev.detail.result.citations,
                                    team_citations: (refined!.team_citations as any) || prev.detail.result.team_citations,
                                    total_msg_count: refined!.total_msg_count ?? prev.detail.result.total_msg_count,
                                    total_token_used: refined!.total_token_used ?? prev.detail.result.total_token_used,
                                    model_version: refined!.model_version || prev.detail.result.model_version,
                                    operation_type: refined!.operation_type,
                                    operation_note: refined!.operation_note,
                                    parent_result_id: refined!.parent_result_id,
                                    generated_at: refined!.generated_at || prev.detail.result.generated_at,
                                },
                            },
                        } as Pick<SummaryDetailPageState, "showRegenerateModal" | "refineLoadingTarget" | "detail">;
                    });
                    this.loadVersions(this.taskId);
                }
            } else {
                if (operateOnTeamSummary) {
                    await api.regenerateSummary(requestTaskId, { topic: trimmed });
                    if (this.taskId !== requestTaskId) return;
                    Toast.success(t("summary.detail.regenerateStarted"));
                    this.resetTeamSummaryStreamForNewRun(requestTaskId);
                    this.resetLocalScheduleInstruction(trimmed);
                    this.setState((prev) => prev.detail ? {
                        showRegenerateModal: false,
                        detail: {
                            ...prev.detail,
                            title: trimmed || prev.detail.title,
                            status: TaskStatus.PENDING,
                        },
                    } as Pick<SummaryDetailPageState, "showRegenerateModal" | "detail"> : { showRegenerateModal: false } as Pick<SummaryDetailPageState, "showRegenerateModal">);
                    this.loadDetail();
                } else if (detail?.summary_mode === SummaryMode.BY_PERSON && this.isMultiCollab()) {
                    await api.regeneratePersonalSummary(requestTaskId, { topic: trimmed });
                    if (this.taskId !== requestTaskId) return;
                    Toast.success(t("summary.detail.regenerateStarted"));
                    this.resetSummaryStreamForNewRun(requestTaskId);
                    this.resetLocalScheduleInstruction(trimmed);
                    this.setState((prev) => ({
                        showRegenerateModal: false,
                        detail: prev.detail ? {
                            ...prev.detail,
                            title: trimmed || prev.detail.title,
                        } : prev.detail,
                        personalResult: prev.personalResult ? {
                            ...prev.personalResult,
                            worker_status: 0,
                            workflow_stage: "",
                            content: "",
                            citations: [],
                            submitted_at: null,
                            generated_at: null,
                            msg_count: 0,
                        } : prev.personalResult,
                        personalVersions: [],
                        personalVersionsLoading: false,
                        workflowDisplayIndex: 0,
                        workflowGateContent: true,
                        workflowRevealDone: false,
                    } as Pick<SummaryDetailPageState, "showRegenerateModal" | "detail" | "personalResult" | "personalVersions" | "personalVersionsLoading" | "workflowDisplayIndex" | "workflowGateContent" | "workflowRevealDone">));
                    const seq = this.nextScheduleSeq();
                    this.loadPersonalResult(seq);
                    this.loadMembers(seq);
                } else {
                    await api.regenerateSummary(requestTaskId, { topic: trimmed });
                    if (this.taskId !== requestTaskId) return;
                    Toast.success(t("summary.detail.regenerateStarted"));
                    if (detail?.summary_mode === SummaryMode.BY_PERSON) {
                        this.resetSummaryStreamForNewRun(requestTaskId);
                    }
                    this.resetLocalScheduleInstruction(trimmed);
                    this.setState({ showRegenerateModal: false });
                    this.loadDetail();
                }
            }
            if (this.taskId !== requestTaskId) return;
            window.dispatchEvent(new CustomEvent("summary-task-regenerated", { detail: { taskId: requestTaskId } }));
        } catch (err: any) {
            if (err?.name === "AbortError" || this.taskId !== requestTaskId || this.unmounted) return;
            restoreRefineDraft?.();
            this.setState({ refineLoadingTarget: null });
            Toast.error(err.message || t("summary.common.operationFailed"));
        } finally {
            if (currentRefineController && this.refineStreamAbortController === currentRefineController) {
                this.refineStreamAbortController.abort();
                this.refineStreamAbortController = null;
            }
            if (this.taskId === requestTaskId && !this.unmounted) {
                this.setState({ regenerateSubmitting: false });
            }
        }
    };

    handleRestoreVersion = async (version: SummaryVersionItem): Promise<boolean> => {
        if (this.taskId == null || this.state.restoringVersionId != null) return false;
        const requestTaskId = this.taskId;
        this.setState({ restoringVersionId: version.result_id });
        try {
            await api.restoreSummaryVersion(requestTaskId, version.result_id);
            if (this.taskId !== requestTaskId) return false;
            Toast.success(t("summary.detail.versionRestored"));
            this.loadDetail();
            return true;
        } catch (err: any) {
            if (this.taskId !== requestTaskId) return false;
            Toast.error(err.message || t("summary.common.operationFailed"));
            return false;
        } finally {
            this.setState({ restoringVersionId: null });
        }
    };


    handleRestorePersonalVersion = async (version: SummaryVersionItem): Promise<boolean> => {
        if (this.taskId == null || this.state.restoringPersonalVersionId != null) return false;
        const requestTaskId = this.taskId;
        this.setState({
            restoringPersonalVersionId: version.result_id,
            workflowGateContent: false,
            workflowRevealDone: true,
            workflowDisplayIndex: -1,
        });
        try {
            await api.restorePersonalSummaryVersion(requestTaskId, version.result_id);
            if (this.taskId !== requestTaskId) return false;
            Toast.success(t("summary.detail.versionRestored"));
            const seq = this.nextScheduleSeq();
            this.loadPersonalResult(seq, true);
            this.loadMembers(seq);
            this.loadPersonalVersions(this.taskId);
            return true;
        } catch (err: any) {
            if (this.taskId !== requestTaskId) return false;
            Toast.error(err.message || t("summary.common.operationFailed"));
            return false;
        } finally {
            this.setState({ restoringPersonalVersionId: null });
        }
    };

    handleViewVersion = async (version: SummaryVersionItem, isPersonal: boolean) => {
        if (this.taskId == null || this.state.versionDetailLoading) return;
        const requestTaskId = this.taskId;
        const requestResultId = version.result_id;
        this.setState({
            showVersionDetailModal: true,
            versionDetailLoading: true,
            versionDetail: null,
            versionDetailIsPersonal: isPersonal,
        });
        try {
            const detail = isPersonal
                ? await api.getPersonalSummaryVersion(requestTaskId, requestResultId)
                : await api.getSummaryVersion(requestTaskId, requestResultId);
            if (this.taskId !== requestTaskId) return;
            if (detail.result_id !== requestResultId) {
                this.setState({ showVersionDetailModal: false, versionDetailLoading: false, versionDetail: null });
                return;
            }
            this.setState({ versionDetail: detail, versionDetailLoading: false });
        } catch (err: any) {
            if (this.taskId !== requestTaskId) return;
            Toast.error(err.message || t("summary.common.operationFailed"));
            this.setState({ showVersionDetailModal: false, versionDetailLoading: false, versionDetail: null });
        }
    };

    handleCloseVersionDetail = () => {
        if (this.state.versionDetailLoading) return;
        this.setState({ showVersionDetailModal: false, versionDetail: null });
    };

    handleRegenerateCancel = () => {
        this.setState({ showRegenerateModal: false });
    };

    handleCancel = async () => {
        if (this.taskId == null) return;
        try {
            await api.cancelSummary(this.taskId);
            Toast.success(t("summary.detail.cancelSuccess"));
            this.loadDetail();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    openScheduleModal = () => {
        const { scheduleItem } = this.state;
        // Blocking 1：is_active=false 的记录在交互上视为「无活动定时」，但仍回填
        // 原有周期/时刻，方便用户「重新启用」时不用从零填。保存逻辑（handleScheduleSave）
        // 会检测原记录是否 inactive 并走重新启用路径。
        if (scheduleItem) {
            const scheduleConfig = scheduleItemToConfig(scheduleItem);
            this.setState({
                scheduleConfig: {
                    ...scheduleConfig,
                    generationInstruction: this.scheduleInstructionForConfig(scheduleItem.generation_instruction),
                },
                showScheduleConfig: true,
            });
        } else {
            this.setState({
                scheduleConfig: {
                    unit: "week",
                    every: 1,
                    time: "09:00",
                    generationInstruction: this.defaultScheduleInstruction(),
                },
                showScheduleConfig: true,
            });
        }
    };

    /**
     * V5/§4.2/§6.1：本任务是否「多人」。
     *
     * 竞态修复（第3轮）：members 来自 loadDetail 之后的二次异步 getMembers，到达
     * 时间不确定。若以 members.length 作主判据，members 未回填的窗口里多人任务会被
     * 误判为单人 → handleScheduleSave 漏传 confirm_policy=1。
     *
     * 因此判定的「可靠数据源」改为 detail.participants —— 它随 loadDetail 的
     * getSummaryDetail 一并同步返回（不依赖二次异步），且语义即本任务全体参与者
     *（含 creator + 协作成员）。只有当 detail 里就没有 participants 信息时，才退回
     * 用已加载的 members 兜底。
     *
     * 注意：这里只回答「是否多人」。members 是否「已加载完成」由 handleScheduleSave
     * 的保存前 guard（isMembersReadyForSave）单独把关，避免把「members 加载中」误
     * 当「确实单人」。
     */
    private isMultiPerson(): boolean {
        const { detail, members } = this.state;
        // 主判据：detail.participants（同步随 detail 返回，不受二次异步竞态影响）。
        if (detail && Array.isArray(detail.participants) && detail.participants.length > 0) {
            return detail.participants.length > 1;
        }
        // 兜底：detail 没带 participants 时，用已加载的 members。
        return members.length > 1;
    }

    /**
     * 需求1/5/7：是否「多人协作」= 多人（participants>1）且 BY_PERSON。
     * 多人协作页：不单独显示「我的总结」区（need1）；定时按钮入团队框（need5）；
     * 成员状态区可加成员（need7）。单人 BY_PERSON / BY_GROUP 不算多人协作。
     */
    private isMultiCollab(): boolean {
        const { detail } = this.state;
        return detail?.summary_mode === SummaryMode.BY_PERSON && this.isMultiPerson();
    }

    /**
     * 竞态修复（第3轮）：保存定时前判断「多人判定所依赖的数据是否已可靠就绪」。
     *
     * - 若 isMultiPerson 能从 detail.participants 得出结论（detail 已加载且带
     *   participants），则判定不依赖二次异步 members，任何时刻都可靠 → 直接就绪。
     * - 否则（只能退回 members 兜底）必须等 members 加载完成才允许保存；membersLoading
     *   为 true 时表示「members 加载中」，此时不能保存（不能把加载中误当单人）。
     *
     * 用 membersLoading 标志严格区分「加载中」(true) 与「已加载且确实单人」(false 且
     * members.length<=1)。
     */
    private isMembersReadyForSave(): boolean {
        const { detail, membersLoading } = this.state;
        // detail 带 participants → 多人判定不依赖 members，始终就绪。
        if (detail && Array.isArray(detail.participants) && detail.participants.length > 0) {
            return true;
        }
        // 退回 members 兜底的情形：members 仍在加载中则未就绪。
        return !membersLoading;
    }

    /**
     * 构造「手动转定时/改定时」要显式带给后端的协作名单 [{user_id,user_name}]。
     * 数据源与 isMultiPerson 的可靠判据一致：优先 detail.participants（随 detail
     * 同步返回，不受二次异步 members 竞态影响），否则退回已加载的 members。
     * 单人（仅 creator）时返回单元素或空，由后端按真实 task participants 兜底，
     * 不会被误判为多人。
     */
    private buildScheduleParticipants(): { user_id: string; user_name?: string }[] {
        const { detail, members } = this.state;
        const seen = new Set<string>();
        const out: { user_id: string; user_name?: string }[] = [];
        const push = (userId?: string, userName?: string) => {
            if (!userId || seen.has(userId)) return;
            seen.add(userId);
            out.push(userName ? { user_id: userId, user_name: userName } : { user_id: userId });
        };
        if (detail && Array.isArray(detail.participants) && detail.participants.length > 0) {
            detail.participants.forEach((p) => push(p.user_id, p.user_name));
            return out;
        }
        members.forEach((m) => push(m.user_id, m.user_name));
        return out;
    }

    handleScheduleSave = async (config: ScheduleConfig) => {
        // 续修5：入口捕获发起时的 requestTaskId。用户保存定时后、网络往返期间
        // 切到别的 task，不能把 A 的 schedule 回显到 B（loadSchedule 只能守「调用后才切」，
        // 守不住「调用前已切」）。await 后、调 loadSchedule / 动新 task UI 前均校验。
        const requestTaskId = this.taskId;
        const { detail, scheduleItem } = this.state;
        if (!detail) return;

        // 竞态修复（第3轮）finding 1：多人判定只能退回 members 兜底且 members 尚未
        // 加载完成时，不能保存——否则 isMultiPerson() 会把「members 加载中」误判为
        // 单人，漏传 confirm_policy=1（手动转定时未触发后端一次性确认重置）。
        // 阻止保存并提示，等 members 就绪后用户重试。
        if (!this.isMembersReadyForSave()) {
            Toast.warning(t("summary.detail.membersLoadingRetry"));
            return;
        }

        // V5：多人定时（手动转定时/改定时）写路径必须带 confirm_policy=1，
        // 触发后端一次性确认（create 全员置 confirmed=false；update 重置确认）。
        // 单人不传 confirm_policy，走后端兜底。复用 scheduleToParams 的条件透传。
        const confirmPolicy = this.isMultiPerson() ? 1 : undefined;
        // 显式契约：手动转定时/改定时时把当前协作名单一并带给后端，
        // 不依赖后端从 task participants 兜底也能保住全部协作成员（修复
        // 多人手动转定时丢成员、定时轮退化成单人总结的根因之配套）。
        // 数据源优先 detail.participants（随 detail 同步返回），否则退回
        // 已加载的 members；二者就绪由 isMembersReadyForSave 上方 guard 把关。
        const scheduleParticipants = this.buildScheduleParticipants();
        const participantsParam =
            scheduleParticipants.length > 0 ? { participants: scheduleParticipants } : {};
        const { cron_expr, interval_days, interval_months, day_of_week, day_of_month, run_time, confirm_policy } =
            scheduleToParams({ ...config, confirm_policy: confirmPolicy });
        const generation_instruction = (config.generationInstruction || "").trim();

        try {
            if (scheduleItem) {
                // Blocking 1：原记录被停用（is_active=false）时，仅 update 不会把 is_active
                // 切回 true，定时仍不生效。所以：先 update 应用新配置，再 toggle(id,true)
                // 重新启用。toggle 在 re-enable 时会按 NextRunWithInterval 重算 next_run_at 到
                // 未来，保证「停用→再设置保存→定时真正重新生效」。
                const wasInactive = shouldReactivateOnSave(scheduleItem);

                // Plan A1: detail-page edit is scoped to THIS summary. The backend
                // clones a new schedule (and rebinds this task) when the schedule
                // is shared by multiple summaries, so other summaries are not
                // affected. The response carries the effective schedule_id (the
                // clone's id when cloned, or the original id otherwise).
                const updated = await api.updateSchedule(scheduleItem.schedule_id, {
                    cron_expr,
                    interval_days,
                    interval_months,
                    day_of_week,
                    day_of_month,
                    run_time,
                    generation_instruction,
                    scope: 'task',
                    task_id: detail.task_id,
                    ...participantsParam,
                    // V5：多人「改/转定时」带 confirm_policy=1 触发后端一次性确认重置。
                    ...(confirm_policy !== undefined ? { confirm_policy } : {}),
                });
                const effectiveScheduleId = updated?.schedule_id ?? scheduleItem.schedule_id;

                if (wasInactive) {
                    // 重新启用：对生效的 schedule_id（可能是 clone）调 toggle(true)，
                    // 把 is_active 置回 1 并把 next_run 推到未来。
                    await api.toggleSchedule(effectiveScheduleId, true);
                }

                Toast.success(t("summary.detail.scheduleSaved"));
                // 续修5：切了 task 就别回显 / 别动新 task 的 UI。
                if (this.taskId !== requestTaskId) return;
                this.loadSchedule(effectiveScheduleId);
            } else {
                // 为「无定时」总结新建定时：一步式 create，带 scope='task' + task_id。
                // 后端在一个事务里原子完成：校验 task 归属 → 建定时 → Update
                // summary_task.schedule_id 绑定（一对一约束）。不再需要第二步 update
                // 绑定，也不会产生游离定时，所以去掉 B2 回滚。失败时后端返回
                // 中文错误（一对一约束 / 40004 无权限 / scope=task 必传 task_id 等），
                // 由下方 catch 的 Toast.error 透出 err.message。
                const newSchedule = await api.createSchedule({
                    title: detail.title,
                    generation_instruction,
                    summary_mode: detail.summary_mode,
                    cron_expr,
                    interval_days,
                    interval_months,
                    day_of_week,
                    day_of_month,
                    run_time,
                    time_range_type: 2,
                    // 强剥 source_name：与即时总结/ScheduleForm 一致，提交时只带
                    // {source_type, source_id}，让后端按 source_id 现查 IM 库权威群名
                    // （带类型后缀）。避免详情页把 detail.sources 里的客户端名
                    // （未命名来源会退化成原始 group_no/thread id）写进定时配置。
                    sources: detail.sources.map(({ source_type, source_id }) => ({
                        source_type,
                        source_id,
                    })),
                    scope: 'task',
                    task_id: detail.task_id,
                    ...participantsParam,
                    // V5：多人「手动转定时」关键路径带 confirm_policy=1，
                    // 后端创建 participant_config 时全员（含 creator）置 confirmed=false。
                    ...(confirm_policy !== undefined ? { confirm_policy } : {}),
                });
                Toast.success(t("summary.detail.scheduleCreated"));
                // 拉取刚建并已绑定的定时回显。
                // 续修5：切了 task 就别回显 / 别动新 task 的 UI。
                if (this.taskId !== requestTaskId) return;
                this.loadSchedule(newSchedule.schedule_id);
            }
            // 续修5：迟到则不关闭新 task 的弹框。
            if (this.taskId !== requestTaskId) return;
            this.setState({ showScheduleConfig: false });
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.saveFailed"));
        }
    };

    private scheduleInstructionVersionSource() {
        const { versions, personalVersions } = this.state;
        return [...versions, ...personalVersions];
    }

    private defaultScheduleInstruction() {
        const pending = this.state.pendingScheduleInstruction.trim();
        if (pending) return pending;

        const { detail } = this.state;
        const versionSource = this.scheduleInstructionVersionSource();
        let base = detail?.title || "";
        const refinements: string[] = [];
        versionSource
            .slice()
            .sort((a, b) => a.version - b.version)
            .forEach((version) => {
                const note = (version.operation_note || "").trim();
                if (["generate", "regenerate", "scheduled_generate"].includes(version.operation_type)) {
                    base = note || base;
                    refinements.length = 0;
                    return;
                }
                if (version.operation_type === "refine" && note) {
                    refinements.push(note);
                }
            });
        return [base.trim(), ...refinements].filter(Boolean).join("\n");
    }

    private scheduleInstructionForConfig(existingInstruction?: string) {
        const existing = (existingInstruction || "").trim();
        if (!existing) return this.defaultScheduleInstruction();

        const missingRefinements = this.refinementNotesSinceLastReset()
            .filter((note) => !existing.includes(note));
        if (missingRefinements.length === 0) return existing;
        return [existing, ...missingRefinements].filter(Boolean).join("\n");
    }

    private refinementNotesSinceLastReset() {
        const versionSource = this.scheduleInstructionVersionSource();
        const refinements: string[] = [];
        versionSource
            .slice()
            .sort((a, b) => a.version - b.version)
            .forEach((version) => {
                if (["generate", "regenerate", "scheduled_generate"].includes(version.operation_type || "generate")) {
                    refinements.length = 0;
                    return;
                }
                const note = (version.operation_note || "").trim();
                if (version.operation_type === "refine" && note) {
                    refinements.push(note);
                }
            });
        return refinements;
    }

    private appendLocalScheduleInstruction(feedback: string) {
        const addition = feedback.trim();
        if (!addition) return;
        this.setState((prev) => {
            const current = prev.scheduleItem
                ? (prev.scheduleItem.generation_instruction || "").trim()
                : (prev.pendingScheduleInstruction || prev.detail?.title || "").trim();
            const nextInstruction = current ? `${current}\n${addition}` : addition;
            return {
                pendingScheduleInstruction: nextInstruction,
                scheduleItem: prev.scheduleItem ? {
                    ...prev.scheduleItem,
                    generation_instruction: nextInstruction,
                } : prev.scheduleItem,
                scheduleConfig: prev.scheduleConfig ? {
                    ...prev.scheduleConfig,
                    generationInstruction: nextInstruction,
                } : prev.scheduleConfig,
            } as Pick<SummaryDetailPageState, "pendingScheduleInstruction" | "scheduleItem" | "scheduleConfig">;
        });
    }

    private resetLocalScheduleInstruction(instruction: string) {
        const next = instruction.trim();
        if (!next) return;
        this.setState((prev) => ({
            pendingScheduleInstruction: next,
            scheduleItem: prev.scheduleItem ? {
                ...prev.scheduleItem,
                title: next,
                generation_instruction: next,
            } : prev.scheduleItem,
            scheduleConfig: prev.scheduleConfig ? {
                ...prev.scheduleConfig,
                generationInstruction: next,
            } : prev.scheduleConfig,
        } as Pick<SummaryDetailPageState, "pendingScheduleInstruction" | "scheduleItem" | "scheduleConfig">));
    }

    private reloadScheduleAfterInstructionChange(requestTaskId: number | null) {
        const scheduleId = this.state.scheduleItem?.schedule_id;
        if (!scheduleId || this.taskId !== requestTaskId) return;
        this.loadSchedule(scheduleId);
    }

    // 任务1：「关闭定时」——停用（可恢复），不走 delete。
    // 调 toggleSchedule(..., false) 把 is_active 置 0，成功后刷新详情页定时状态。
    //
    // Blocking 4（降级）：这里 toggleSchedule(schedule_id, false) 是「全局」停用（未带
    // scope='task'）。之所以不改为 task-scoped disable：后端已上一对一约束（一个定时
    // 只绑一个总结），所以全局 disable 与本 task 级 disable 等价、实际无害。
    // ⚠若未来放开定时共享（一个定时绑多个总结），需改为 task-scoped disable，
    // 否则会误停其他总结的定时。
    handleScheduleDisable = async () => {
        // 续修6：入口捕获 requestTaskId。await toggleSchedule 期间切 task，不得把 A 的
        // schedule 回显到 B 的 scheduleItem。迟到则放弃回显，但必须复位 scheduleDisabling
        //（当前无 finally，在 return 前安全复位），别让 loading 卡住。
        const requestTaskId = this.taskId;
        const { scheduleItem } = this.state;
        if (!scheduleItem) return;
        this.setState({ scheduleDisabling: true });
        try {
            const updated = await api.toggleSchedule(scheduleItem.schedule_id, false);
            // 迟到（已切 task）：不回显新 task，仅复位本地 loading 标志。
            if (this.taskId !== requestTaskId) {
                this.setState({ scheduleDisabling: false });
                return;
            }
            Toast.success(t("summary.detail.scheduleDisabled"));
            // 任务3：回显一致——停用后本地把 is_active 置 false，
            // 使 hasSchedule / 描述行不再把它当作“有效定时”。
            this.setState({
                scheduleItem: { ...scheduleItem, ...(updated || {}), is_active: false },
                showScheduleConfig: false,
                scheduleDisabling: false,
            });
        } catch (err: any) {
            this.setState({ scheduleDisabling: false });
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    /**
     * 「继续优化」按钮 — 打开一个新的智能总结 chat session,预置引用当前总结。
     * 见 CHAT-REFERENCE-BASED-DESIGN-v1: 详情页入口和顶栏「新总结」入口的语义
     * 完全等价 — 都是新起一次 chat 生产工作台,唯一差别是这里预填了引用。
     *
     * 实现:通过 window 事件解耦(避免 SummaryCreatePage↔SummaryDetailPage 循环导入)。
     * module.tsx 里注册顶栏「新总结」入口的 handler 监听此事件,收到后打开
     * 一个新的 SummaryCreatePage 实例,并把 derivedFromTask 作为 prop 塞入。
     *
     * 用户在新 chat 里聊完保存后:①出现的是全新总结(和当前总结平级) ②当前
     * 总结不变 ③新总结的 SummaryTask.referenced_task_ids 记录来源。
     */
    handleContinueRefine = () => {
        const { detail } = this.state;
        if (!detail || detail.trigger_type !== TriggerType.AGENT) return;
        const event = new CustomEvent('summary-open-chat-with-reference', {
            detail: {
                task_id: detail.task_id,
                title: detail.title,
                trigger_type: detail.trigger_type,
                status: detail.status,
                creator_id: detail.creator_id,
                summary_mode: detail.summary_mode,
                time_range_start: detail.time_range_start,
                time_range_end: detail.time_range_end,
                sources: detail.sources || [],
                total_msg_count: 0,
                created_at: '',
                updated_at: '',
            },
        });
        window.dispatchEvent(event);
    };

    handleForwardToChat = () => {
        const { detail, personalResult } = this.state;
        // #158/#161 agent 总结 fallback:agent workflow 只写 personal_result 表,
        // 不写 summary_result 表(agent_summary.go: creatorPR 是 deliverable,没有
        // 单独的 SummaryResult 行)。所以 GET /summaries/:id 返 detail.result=null,
        // 但 detail.personal_result 有 content(前端渲染正文也是走这个 fallback)。
        // 传统 workflow 优先走 detail.result;agent workflow 走 personalResult。
        // 两者的 content 语义都是"给用户看的最终交付文本",转发到聊天的姿势一致。
        const sourceContent = detail?.result?.content ?? personalResult?.content ?? '';
        if (!sourceContent.trim()) return;
        WKApp.shared.baseContext.showConversationSelect(async (channels: Channel[]) => {
            const cleanContent = sourceContent.replace(/\[\d+\]/g, '').replace(/  +/g, ' ').trim();
            const chunks = splitSummaryText(cleanContent);

            // 长文分块 → 同 channel 内 serial 保序 + interMessageDelayMs 节流；
            // 跨 channel 也走 serial（保持与原实现一致的顺序体验）。
            // 原先手写的 space_id monkey-patch 由 ForwardService 内部
            // wrapSendContentForInjection + opts.spaceId 代替。
            const result = await ForwardService.send(
                channels,
                () => chunks.map((c) => new MessageText(c)),
                {
                    channelMode: "serial",
                    messageMode: "serial",
                    interMessageDelayMs: INTER_MESSAGE_DELAY_MS,
                    spaceId: WKApp.shared.currentSpaceId,
                },
            );

            // 分母保持 channels 数（scope='targets'），不改动用户可见的 Toast 语义。
            const state = interpretForwardResult(result, "targets");
            if (state.kind === "all-failed") {
                Toast.error(t("summary.detail.forwardFailed"));
            } else if (state.kind === "partial") {
                Toast.error(t("summary.detail.partialForwardFailed", { values: { failed: state.failed, total: state.total } }));
            } else {
                Toast.success(t("summary.detail.forwarded"));
            }
        }, t("summary.detail.forwardToChat"));
    };

    handleForwardToMatter = () => {
        const { detail, personalResult } = this.state;
        if (!detail || detail.status !== TaskStatus.COMPLETED) return;

        // #907 review (yujiawei P2): mirror handleForwardToChat's agent
        // summary fallback so this path won't ship broken when
        // SHOW_FORWARD_TO_MATTER is flipped back on. See handleForwardToChat
        // for the full rationale (agent workflow only writes personal_result).
        const content = detail.result?.content ?? personalResult?.content;
        if (!content?.trim()) {
            Toast.warning(t("summary.detail.noForwardContent"));
            return;
        }

        this.setState({ showMatterPicker: true });
    };

    handleMatterSelected = async (matterId: string, matterTitle: string) => {
        const { detail, personalResult } = this.state;
        if (!detail) return;

        // Same fallback as handleForwardToMatter (they must stay in sync).
        const content = detail.result?.content ?? personalResult?.content;
        if (!content?.trim()) return;

        this.setState({ forwardingToMatter: true, showMatterPicker: false });
        try {
            await matterBridge.addComment(matterId, content);
            Toast.success(t("summary.detail.forwardedToMatter", { values: { title: matterTitle } }));
        } catch (err: any) {
            Toast.error(err.message || t("summary.detail.forwardFailed"));
        } finally {
            this.setState({ forwardingToMatter: false });
        }
    };

    /**
     * Whether the personal summary content is already visible in BY_PERSON mode.
     * Mirrors the content-display predicate in renderPersonalSummary (shows when content is non-empty),
     * so the global "generating" card and the personal summary are guaranteed to be mutually exclusive
     * regardless of worker_status value/type/timing.
     */
    private canRevealPersonalContent(): boolean {
        return !this.state.workflowGateContent || this.state.workflowRevealDone;
    }

    private get personalReady(): boolean {
        const { detail, personalResult } = this.state;
        return (
            detail?.summary_mode === SummaryMode.BY_PERSON &&
            !!personalResult?.content?.trim() &&
            this.canRevealPersonalContent()
        );
    }

    private shouldShowWorkflowCard(): boolean {
        const { detail, personalResult } = this.state;
        if (detail?.summary_mode !== SummaryMode.BY_PERSON) return false;

        const personalRunning = personalResult?.worker_status === 0 || personalResult?.worker_status === 1;
        const personalFailed = personalResult?.worker_status === 3;
        const replayingCompletedWorkflow = this.state.workflowGateContent && !this.state.workflowRevealDone;

        return personalRunning || personalFailed || replayingCompletedWorkflow;
    }

    private shouldShowProcessingCard(): boolean {
        const { detail } = this.state;
        if (!detail) return false;

        const genericProcessing =
            detail.summary_mode !== SummaryMode.BY_PERSON &&
            (detail.status === TaskStatus.PENDING || detail.status === TaskStatus.PROCESSING);

        return this.shouldShowWorkflowCard() || genericProcessing;
    }

    renderWorkflowProgress() {
        const { detail, personalResult } = this.state;
        const { t } = this.context;
        if (detail?.summary_mode !== SummaryMode.BY_PERSON) return null;

        const activeIndex = this.state.workflowDisplayIndex >= 0
            ? this.state.workflowDisplayIndex
            : (detail?.status === TaskStatus.PENDING || detail?.status === TaskStatus.PROCESSING ? 0 : -1);
        const personalDone = personalResult?.worker_status === 2;
        const personalFailed = personalResult?.worker_status === 3;
        const allDone = (detail?.status === TaskStatus.COMPLETED || personalDone) && this.state.workflowRevealDone;

        return (
            <div className="summary-progress-stages">
                {SUMMARY_WORKFLOW_STAGES.map((item, index) => {
                    let className = "summary-progress-stage summary-progress-stage-pending";
                    let mark: React.ReactNode = "○";
                    if (allDone || (activeIndex >= 0 && index < activeIndex)) {
                        className = "summary-progress-stage summary-progress-stage-done";
                        mark = "✓";
                    } else if (activeIndex === index) {
                        className = personalFailed
                            ? "summary-progress-stage summary-progress-stage-failed"
                            : "summary-progress-stage summary-progress-stage-active";
                        mark = personalFailed ? "×" : <span className="summary-progress-stage-spinner" />;
                    }
                    return (
                        <div className={className} key={item.key}>
                            <span style={{ width: 20, display: "inline-block" }}>{mark}</span>
                            <span>{t(item.labelKey)}</span>
                        </div>
                    );
                })}
            </div>
        );
    }

    renderProcessing() {
        const { t } = this.context;
        const { personalResult } = this.state;
        const isTeamRegenerating = this.isMultiCollabRegenerating();
        const myPersonalDone = isTeamRegenerating && personalResult?.worker_status === 2 && this.state.workflowRevealDone;
        const titleKey = myPersonalDone
            ? "summary.detail.teamRegeneratingWaitingTitle"
            : (isTeamRegenerating ? "summary.detail.teamRegeneratingWorkflowTitle" : "summary.detail.processingTitle");
        const descKey = myPersonalDone
            ? "summary.detail.teamRegeneratingWaitingDesc"
            : (isTeamRegenerating ? "summary.detail.teamRegeneratingWorkflowDesc" : "summary.detail.processingDesc");
        return (
            <div className="summary-detail-processing">
                <div className="summary-progress-copy">
                    <div className="summary-progress-title">
                        {t(titleKey)}
                    </div>
                    <div className="summary-progress-desc">
                        {t(descKey)}
                    </div>
                </div>
                {this.renderWorkflowProgress()}
            </div>
        );
    }

    renderTeamGeneratingStatus() {
        const { t } = this.context;
        return (
            <div className="summary-detail-team summary-detail-team-generating-card">
                <div className="summary-detail-section-header">
                    <span>{t("summary.detail.teamSummary")}</span>
                </div>
                <div className="summary-detail-team-generating">
                    <Spin size="small" />
                    <span>{t("summary.detail.teamGenerating")}</span>
                </div>
            </div>
        );
    }

    renderRefineLoadingStatus() {
        const { t } = this.context;
        const target = this.state.refineLoadingTarget;
        if (!target) return null;
        const titleKey = target === "personal"
            ? "summary.detail.mySummary"
            : (target === "team" ? "summary.detail.teamSummary" : "summary.detail.contentTitle");
        const descKey = target === "personal"
            ? "summary.detail.refiningPersonal"
            : (target === "team" ? "summary.detail.refiningTeam" : "summary.detail.refiningSummary");
        return (
            <div className="summary-detail-team summary-detail-team-generating-card">
                <div className="summary-detail-section-header">
                    <span>{t(titleKey)}</span>
                </div>
                <div className="summary-detail-team-generating">
                    <Spin size="small" />
                    <span>{t(descKey)}</span>
                </div>
            </div>
        );
    }

    renderStreamingContent() {
        const content = this.state.streamingContent.trim();
        if (!this.state.streaming || !content) return null;
        return (
            <div className="summary-detail-personal summary-detail-streaming">
                <div className="summary-detail-content-box">
                    <CitationText content={this.state.streamingContent} citations={[]} />
                </div>
            </div>
        );
    }

    renderTeamStreamingContent() {
        const content = this.state.teamStreamingContent.trim();
        if (!this.state.teamStreaming || !content) return null;
        return (
            <div className="summary-detail-team summary-detail-streaming">
                <div className="summary-detail-section-header">
                    <span>{this.context.t("summary.detail.teamSummary")}</span>
                </div>
                <div className="summary-detail-content-box">
                    <CitationText content={this.state.teamStreamingContent} citations={[]} members={this.state.members} />
                </div>
            </div>
        );
    }

    renderFailed() {
        const { detail } = this.state;
        const { t } = this.context;
        if (!detail) return null;
        return (
            <div className="summary-detail-failed">
                <div className="summary-detail-failed-icon">⚠️</div>
                <h3>{t("summary.detail.failedTitle")}</h3>
                {detail.error_message && (
                    <div className="summary-detail-failed-reason">
                        {detail.error_message}
                    </div>
                )}
                <div className="summary-detail-failed-meta">
                    <div>{t("summary.detail.taskNo", { values: { taskNo: detail.task_no } })}</div>
                    <div>{t("summary.detail.createdAt", { values: { time: formatDate(detail.created_at) } })}</div>
                </div>
            </div>
        );
    }


    private formatVersionOperation(version: SummaryVersionItem): string {
        const { t } = this.context;
        if ((version.operation_type || "generate") === "generate") {
            return t("summary.detail.versionInitialGenerate");
        }
        const key = `summary.detail.versionOperation.${version.operation_type || "generate"}`;
        const label = t(key);
        return label === key ? t("summary.detail.versionOperation.generate") : label;
    }

    renderVersionHistory() {
        const { versions, versionsLoading, detail, restoringVersionId } = this.state;
        if (!detail?.result || versionsLoading || versions.length <= 1) return null;
        const currentVersion = detail.result.version;
        const canRestore = !!(detail.permissions?.can_edit_team || detail.permissions?.can_edit);
        return (
            <SummaryVersionHistory
                versions={versions}
                versionsLoading={versionsLoading}
                currentVersion={currentVersion}
                restoringVersionId={restoringVersionId}
                canRestore={canRestore}
                onViewVersion={(version: SummaryVersionItem) => this.handleViewVersion(version, false)}
                onRestoreVersion={(version: SummaryVersionItem) => this.handleRestoreVersion(version)}
            />
        );
    }


    renderPersonalVersionHistory() {
        const { personalVersions, personalVersionsLoading, personalResult, restoringPersonalVersionId, detail } = this.state;
        // 多人协作最终页只保留团队汇总版本控制；个人报告里的版本历史会让用户误以为
        // 恢复个人版本会直接影响最终团队结果，因此在多人协作场景统一隐藏。
        if (this.isMultiCollab()) return null;
        if (!personalResult?.content || personalVersionsLoading || personalVersions.length <= 1) return null;
        const currentVersion = personalResult.version || personalVersions[0]?.version || 0;
        const canRestore = !!detail?.permissions?.can_edit_personal;
        return (
            <SummaryVersionHistory
                versions={personalVersions}
                versionsLoading={personalVersionsLoading}
                currentVersion={currentVersion}
                restoringVersionId={restoringPersonalVersionId}
                canRestore={canRestore}
                onViewVersion={(version: SummaryVersionItem) => this.handleViewVersion(version, true)}
                onRestoreVersion={(version: SummaryVersionItem) => this.handleRestorePersonalVersion(version)}
            />
        );
    }

    renderVersionDetailModal() {
        const { t } = this.context;
        const { versionDetail, versionDetailLoading, versionDetailIsPersonal, detail, personalResult } = this.state;
        const currentVersion = versionDetailIsPersonal
            ? (personalResult?.version || 0)
            : (detail?.result?.version || 0);
        const isCurrent = !!versionDetail && versionDetail.version === currentVersion;
        const canRestore = !!versionDetail && !isCurrent && (versionDetailIsPersonal
            ? !!detail?.permissions?.can_edit_personal
            : !!(detail?.permissions?.can_edit_team || detail?.permissions?.can_edit));
        const operation = versionDetail ? this.formatVersionOperation(versionDetail) : "";
        return (
            <Modal
                width="min(860px, calc(100vw - 48px))"
                bodyStyle={{
                    maxHeight: "calc(100vh - 320px)",
                    overflowY: "auto",
                }}
                title={versionDetail
                    ? t("summary.detail.versionDetailTitle", { values: { version: versionDetail.version, operation } })
                    : t("summary.detail.versionDetailLoading")}
                visible={this.state.showVersionDetailModal}
                onCancel={this.handleCloseVersionDetail}
                footer={
                    <div className="summary-version-detail-footer">
                        <Button onClick={this.handleCloseVersionDetail}>{t("summary.common.close")}</Button>
                        {canRestore && versionDetail && (
                            <Button
                                theme="solid"
                                loading={versionDetailIsPersonal
                                    ? this.state.restoringPersonalVersionId === versionDetail.result_id
                                    : this.state.restoringVersionId === versionDetail.result_id}
                                onClick={async () => {
                                    const restored = versionDetailIsPersonal
                                        ? await this.handleRestorePersonalVersion(versionDetail)
                                        : await this.handleRestoreVersion(versionDetail);
                                    if (restored) {
                                        this.setState({ showVersionDetailModal: false, versionDetail: null });
                                    }
                                }}
                            >
                                {t("summary.detail.restoreVersion")}
                            </Button>
                        )}
                    </div>
                }
            >
                {versionDetailLoading ? (
                    <div className="summary-version-detail-loading">
                        <Spin />
                    </div>
                ) : versionDetail ? (
                    <div className="summary-version-detail">
                        <section className="summary-version-detail-section">
                            <div className="summary-version-detail-label">{t("summary.detail.versionDetailUserContent")}</div>
                            <div className="summary-version-detail-note">
                                {detail?.title || t("summary.common.unknown")}
                            </div>
                        </section>
                        <section className="summary-version-detail-section">
                            <div className="summary-version-detail-label">{t("summary.detail.versionDetailFeedback")}</div>
                            <div className="summary-version-detail-note">
                                {versionDetail.operation_type === "refine" && versionDetail.operation_note
                                    ? versionDetail.operation_note
                                    : t("summary.detail.versionDetailNoFeedback")}
                            </div>
                        </section>
                        <section className="summary-version-detail-section">
                            <div className="summary-version-detail-label">{t("summary.detail.versionDetailResult")}</div>
                            <div className="summary-version-detail-content">
                                <CitationText
                                    content={versionDetail.content}
                                    citations={versionDetail.citations || []}
                                    teamCitations={versionDetail.team_citations || []}
                                    members={this.state.members}
                                    disableTeamMemberPreview
                                />
                            </div>
                        </section>
                    </div>
                ) : null}
            </Modal>
        );
    }

    renderCompleted() {
        const { detail } = this.state;
        const { t } = this.context;
        if (!detail || !detail.result) return null;
        return (
            <div className="summary-detail-result">
                <div className="summary-detail-result-header">
                    <h3>{t("summary.detail.contentTitle")}</h3>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="summary-detail-result-badges">
                            <Tag color="blue" size="small" prefixIcon={<IconHistory />}>
                                {t("summary.common.version", { values: { version: detail.result.version } })}
                            </Tag>
                            <Tag color="green" size="small">
                                {t("summary.common.messagesCount", { values: { count: detail.result.total_msg_count } })}
                            </Tag>
                            {detail.result_is_edited && detail.result_edited_at && (
                                <Tag color="orange" size="small">
                                    {t("summary.detail.edited")}
                                </Tag>
                            )}
                        </div>
                    </div>
                </div>
                {this.renderVersionHistory()}
                <div className="summary-detail-result-content">
                    <CitationText content={detail.result.content} citations={detail.result.citations || []} />
                </div>
                <div className="summary-detail-result-footer">
                    <span className="summary-detail-result-time">
                        {t("summary.detail.generatedAt", { values: { time: formatDate(detail.result.generated_at) } })}
                    </span>
                    {detail.result_is_edited && detail.result_edited_at && (
                        <span className="summary-detail-result-time">
                            {t("summary.detail.lastEditedAt", { values: { time: formatDate(detail.result_edited_at) } })}
                        </span>
                    )}
                </div>
            </div>
        );
    }

    renderPersonalSummary() {
        const { personalResult, personalLoading, detail, personalExpanded } = this.state;
        const { t } = this.context;
        if (personalLoading) {
            return (
                <div className="summary-detail-personal">
                    <div className="summary-detail-section-header">
                        <button
                            type="button"
                            className="summary-detail-section-toggle"
                            onClick={this.togglePersonalExpanded}
                        >
                            <ChevronDown size={14} className={`summary-detail-chevron${personalExpanded ? " summary-detail-chevron--expanded" : ""}`} />
                            <span>{t("summary.detail.mySummary")}</span>
                        </button>
                    </div>
                    <Spin size="small" />
                </div>
            );
        }
        if (!personalResult) return null;
        if (personalResult.content?.trim() && !this.canRevealPersonalContent()) return null;
        return (
            <div className="summary-detail-personal">
                <div className="summary-detail-section-header">
                    <button
                        type="button"
                        className="summary-detail-section-toggle"
                        onClick={this.togglePersonalExpanded}
                    >
                        <ChevronDown size={14} className={`summary-detail-chevron${personalExpanded ? " summary-detail-chevron--expanded" : ""}`} />
                        <span>{t("summary.detail.mySummary")}</span>
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {/* #158/#161 fast-follow：agent 总结不支持 edit —— 后端 PUT /edit
                            走的是 SummaryResult 表更新，但 agent 保存路径只写
                            personal_result 表（agent_summary.go 里 creatorPR 是唯一
                            deliverable，不建 summary_result 行）。用户点击编辑保存后
                            会 404 "总结结果不存在"。前端直接不渲染。
                            如果未来后端为 agent 建 SummaryResult 行，只需删除下面
                            这行 trigger_type 判断即可。 */}
                        {detail && detail.status === TaskStatus.COMPLETED && detail.permissions?.can_edit && !this.state.isEditing && detail.trigger_type !== TriggerType.AGENT && (
                            <Button
                                size="small"
                                theme="borderless"
                                icon={<IconEdit />}
                                onClick={this.handleStartEdit}
                            >
                                {t("summary.common.edit")}
                            </Button>
                        )}
                        {personalResult.worker_status === 2 && !personalResult.submitted_at && this.state.members.length > 1 && (
                            <Button size="small" theme="solid" onClick={this.handleSubmitPersonal}>
                                {t("summary.detail.submitToAll")}
                            </Button>
                        )}
                    </div>
                </div>
                {personalExpanded && (
                    <>
                        {this.renderPersonalVersionHistory()}
                        {personalResult.content && (
                            <div className="summary-detail-content-box">
                                <CitationText content={personalResult.content} citations={personalResult.citations || []} />
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    }

    /**
     * 回归修复：多人协作页(isMultiCollab)给「我自己」补回「提交给全部」入口。
     *
     * need1 把多人页的 renderPersonalSummary()（我的总结正文区）整体隐藏了，
     * 连带把原在其中的「提交给全部」按钮也一起藏掉 → 个人总结完成后无提交入口
     * → submitted_at 永远 NULL → meta 完成判定永不满足 → 任务卡 Processing。
     *
     * 这里只渲染「一句提示 + 提交按钮」的轻量 bar，不展开我的总结全文，
     * 因此不违反 need1。条件：多人协作 + 我的个人总结已完成(worker_status===2)
     * + 尚未提交(!submitted_at) + 多人(members>1)。
     * 提交成功后 handleSubmitPersonal 会刷新 personalResult/members，
     * submitted_at 有值后本 bar 自动消失，我那条也会作为 submitted 出现在参与者报告区。
     *
     * 方案甲（老板新要求）：顶部提醒美化成「带框卡片」（圆角/浅背景/左色条/icon），
     * 不再光秃秃一行；同时把提交入口也下放到【参与者报告区】我那条
     * （renderMyPendingSubmitRow），两处都能提交，主入口随报告上下文更合理。
     * 二者共用同一门控（shouldShowMySubmit）+ handleSubmitPersonal。
     */
    // 共享门控：是否应展示「我的提交」入口（顶部卡片 + 参与者报告区行 复用）。
    shouldShowMySubmit(): boolean {
        const { personalResult, members, isEditing, editingPersonalReport, editingTeamSummary, editingMyDraft } = this.state;
        if (!this.isMultiCollab()) return false;
        if (!this.canRevealPersonalContent()) return false;
        // F2：任一编辑态下隐藏提交入口，避免与编辑器并存、提交触发团队聚合与编辑冲突。
        // OCT-21：草稿编辑态（editingMyDraft）也走同款互斥，整行（含「提交给全部」按钮）让位给草稿编辑器分支。
        if (isEditing || editingPersonalReport || editingTeamSummary || editingMyDraft) return false;
        if (personalResult?.worker_status !== 2) return false;
        if (personalResult.submitted_at) return false;
        if (members.length <= 1) return false;
        return true;
    }

    renderMySubmitBar() {
        const { t } = this.context;
        if (!this.shouldShowMySubmit()) return null;
        // 美化：带框卡片（圆角 + 浅背景 + 左色条 + IconInfoCircle 提示 icon），
        // 样式见 .summary-detail-my-submit-bar（index.css）。
        return (
            <div className="summary-detail-my-submit-bar">
                <IconInfoCircle className="summary-detail-my-submit-icon" />
                <span className="summary-detail-my-submit-hint">{t("summary.detail.mySubmitHint")}</span>
                <Button size="small" theme="solid" onClick={this.handleSubmitPersonal}>
                    {t("summary.detail.submitToAll")}
                </Button>
            </div>
        );
    }

    renderTeamSummary() {
        const { detail, members, editingTeamSummary } = this.state;
        const { t } = this.context;
        if (!detail) return null;
        // 多人协作重新生成中不再展示邀请流程；主区域展示个人 workflow，
        // 团队旧结果降级为“上一版团队汇总”，避免用户误解为新结果未变化。
        if (this.isMultiCollabRegenerating()) {
            if (!detail.result) return null;
            return (
                <div className="summary-detail-team summary-detail-team-previous">
                    <div className="summary-detail-section-header">
                        <span>{t("summary.detail.previousTeamSummary")}</span>
                        <div className="summary-detail-section-badges">
                            <Tag color="blue" size="small" prefixIcon={<IconHistory />}>
                                {t("summary.common.version", { values: { version: detail.result.version } })}
                            </Tag>
                            <Tag color="grey" size="small" prefixIcon={<IconClock />} className="summary-detail-team-generated-time">
                                {t("summary.detail.generatedAt", { values: { time: formatDate(detail.result.generated_at) } })}
                            </Tag>
                        </div>
                    </div>
                    <div className="summary-detail-previous-desc">
                        {t("summary.detail.previousTeamSummaryDesc")}
                    </div>
                    <div className="summary-detail-content-box">
                        <CitationText
                            content={detail.result.content}
                            citations={detail.result.citations || []}
                            teamCitations={detail.result.team_citations || []}
                            members={members}
                            hidePlainCitations
                        />
                    </div>
                </div>
            );
        }
        if (!detail.result) return null;
        if (members.length <= 1) return null;
        const submittedCount = members.filter((m) => m.submitted_at && m.content).length;
        if (submittedCount === 0) return null;
        // need4：团队总结编辑按钮仅 creator（can_edit_team）。
        const canEditTeam = !!detail.permissions?.can_edit_team;
        // need4：行内编辑团队总结（走既有 PUT /summaries/:id/edit，后端已放开多人 creator）。
        // F1（纵深防御）：加 canEditTeam 双校验——即使 editingTeamSummary 残留，非 creator 也不进编辑器。
        if (editingTeamSummary && canEditTeam && detail.result_id) {
            return (
                <div className="summary-detail-team">
                    <div className="summary-detail-section-header">
                        <span>{t("summary.detail.teamSummary")}</span>
                    </div>
                    <SummaryEditor
                        taskId={detail.task_id}
                        baseResultId={detail.result_id}
                        initialContent={detail.result.content || ""}
                        onSave={this.handleEditTeamSave}
                        onCancel={this.handleEditTeamCancel}
                    />
                </div>
            );
        }
        return (
            <div className="summary-detail-team">
                <div className="summary-detail-section-header">
                    <span>{t("summary.detail.teamSummary")}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="summary-detail-section-badges">
                            <Tag color="cyan" size="small" prefixIcon={<IconUser />}>
                                {t("summary.detail.submittedPeople", { values: { count: submittedCount } })}
                            </Tag>
                            <Tag color="blue" size="small" prefixIcon={<IconHistory />}>
                                {t("summary.common.version", { values: { version: detail.result.version } })}
                            </Tag>
                            {/* 团队总结当前版本的生成时间：与「版本」Tag 语义相邻，与 single 视图（985行）保持一致的容错（formatDate 对 null 返回 "-"）。 */}
                            <Tag color="grey" size="small" prefixIcon={<IconClock />} className="summary-detail-team-generated-time">
                                {t("summary.detail.generatedAt", { values: { time: formatDate(detail.result.generated_at) } })}
                            </Tag>
                        </div>
                        {/* need4：团队编辑按钮仅 creator（can_edit_team），非 creator 不渲染。 */}
                        {canEditTeam && detail.status === TaskStatus.COMPLETED && (
                            <Button
                                size="small"
                                theme="borderless"
                                icon={<IconEdit />}
                                onClick={this.handleStartEditTeam}
                            >
                                {t("summary.detail.editTeamSummary")}
                            </Button>
                        )}
                    </div>
                </div>
                {this.renderVersionHistory()}
                <div className="summary-detail-content-box">
                    <CitationText
                        content={detail.result.content}
                        citations={detail.result.citations || []}
                        teamCitations={detail.result.team_citations || []}
                        members={members}
                        hidePlainCitations
                    />
                </div>
            </div>
        );
    }

    // need7：成员状态区顶部标题行；标题右侧「添加成员」按钮仅 creator（can_add_member）。
    renderMemberStatusHeader() {
        const { detail } = this.state;
        const { t } = this.context;
        const canAddMember = !!detail?.permissions?.can_add_member;
        // 问题3：非 creator 且是参与者 -> 显示“退出多人协作”。
        const myUid = WKApp.loginInfo.uid;
        const isCreator = detail?.creator_id != null && detail.creator_id === myUid;
        const isParticipant = !!detail?.participants?.some((p) => p.user_id === myUid);
        const canLeave = !isCreator && isParticipant && detail?.creator_id != null;
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <h3 style={{ margin: 0 }}>{t("summary.detail.memberStatus")}</h3>
                <span style={{ display: "inline-flex", gap: 8 }}>
                    {canAddMember && (
                        <Button
                            size="small"
                            theme="borderless"
                            icon={<IconPlus />}
                            onClick={this.handleOpenAddMember}
                        >
                            {t("summary.detail.addMember")}
                        </Button>
                    )}
                    {canLeave && (
                        <Popconfirm
                            title={t("summary.detail.leaveTask")}
                            content={t("summary.detail.leaveConfirm")}
                            onConfirm={this.handleLeaveTask}
                        >
                            <Button
                                size="small"
                                theme="borderless"
                                type="danger"
                                icon={<IconExit />}
                            >
                                {t("summary.detail.leaveTask")}
                            </Button>
                        </Popconfirm>
                    )}
                </span>
            </div>
        );
    }

    renderMemberStatus() {
        const { members, membersLoading, detail } = this.state;
        const { t } = this.context;
        if (membersLoading) {
            return (
                <div className="summary-detail-members">
                    {this.renderMemberStatusHeader()}
                    <Spin size="small" />
                </div>
            );
        }
        // 如果只有 1 个人（creator 自己），不显示成员状态区块
        if (members.length <= 1) return null;

        const statusConfig: Record<string, { icon: React.ReactNode; label: string; type: "success" | "warning" | "danger" | "default" }> = {
            pending: { icon: <IconClock />, label: t("summary.memberStatus.pending"), type: "warning" },
            accepted: { icon: <IconTick />, label: t("summary.memberStatus.accepted"), type: "success" },
            declined: { icon: <IconClose />, label: t("summary.memberStatus.declined"), type: "danger" },
            processing: { icon: <IconInfoCircle />, label: t("summary.memberStatus.processing"), type: "default" },
            completed: { icon: <IconTick />, label: t("summary.memberStatus.completed"), type: "success" },
            submitted: { icon: <IconTick />, label: t("summary.memberStatus.submitted"), type: "success" },
        };

        return (
            <div className="summary-detail-members">
                {this.renderMemberStatusHeader()}
                <div className="summary-detail-members-list">
                    {members.map((m) => {
                        const st = statusConfig[m.status] || statusConfig["pending"];
                        const isMe = m.user_id === WKApp.loginInfo.uid;
                        // 问题3：creator 视角（can_remove_member）可移除非自己、非 creator 的成员。
                        const canRemove =
                            !!detail?.permissions?.can_remove_member &&
                            !isMe &&
                            m.user_id !== detail?.creator_id;
                        return (
                            <div key={m.user_id} className="summary-detail-member-item">
                                <span className="summary-detail-member-name">{m.user_name}</span>
                                <Tag color={st.type} prefixIcon={st.icon} size="small">
                                    {st.label}
                                </Tag>
                                {isMe && m.status === "pending" && (
                                    <span style={{ display: "inline-flex", gap: 4, marginLeft: 8 }}>
                                        <Button size="small" theme="solid" onClick={() => this.handleRespondToTask("accept")}>{t("summary.action.accept")}</Button>
                                        <Button size="small" onClick={() => this.handleRespondToTask("reject")}>{t("summary.action.reject")}</Button>
                                    </span>
                                )}
                                {m.submitted_at && (
                                    <span className="summary-detail-member-time">
                                        {formatDate(m.submitted_at)}
                                    </span>
                                )}
                                {canRemove && (
                                    <Popconfirm
                                        title={t("summary.detail.removeMember")}
                                        content={t("summary.detail.removeMemberConfirm")}
                                        onConfirm={() => this.handleRemoveMember(m.user_id)}
                                    >
                                        <Button
                                            size="small"
                                            theme="borderless"
                                            type="danger"
                                            icon={<IconMinusCircle />}
                                            style={{ marginLeft: "auto" }}
                                        />
                                    </Popconfirm>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    toggleReport = (userId: string) => {
        this.setState((prev) => ({
            expandedReports: { ...prev.expandedReports, [userId]: !prev.expandedReports[userId] },
        }));
    };

    renderParticipantReports() {
        const { members, membersLoading, expandedReports, editingPersonalReport, detail, personalResult, editingMyDraft } = this.state;
        const { t } = this.context;
        // 如果只有 1 个人（creator 自己），不显示参与者报告区块
        if (membersLoading || members.length <= 1) return null;
        // OCT-15 / upstream #495：成员按三类语义切分，pending 显式把 declined 排除掉，
        // 否则被拒绝的成员会一直在「等待提交」里悬挂。declined 单独成集合，下面单独渲染。
        const submitted = members.filter((m) => m.submitted_at && m.content);
        const declined = members.filter((m) => m.status === "declined");
        const pending = members.filter(
            (m) => m.status !== "declined" && (!m.submitted_at || !m.content)
        );
        if (submitted.length === 0 && pending.length === 0 && declined.length === 0) return null;
        const myUid = WKApp.loginInfo.uid;
        // need2（排序）：把「我」那条置顶，其余保持原相对顺序（stable）。
        const submittedSorted = [
            ...submitted.filter((m) => m.user_id === myUid),
            ...submitted.filter((m) => m.user_id !== myUid),
        ];
        // 方案甲：“我自己个人总结已完成但未提交”既不在 submitted（submitted_at 为空）
        // 也不该以“等待提交”的被动 pending 行呈现。这里显式渲染“我（未提交）+ 提交按钮”的主入口行（renderMyPendingSubmitRow），
        // 并从 generic pending 里排掉我那条，避免重复。不展开我的总结正文 → 不违反 need1。
        const showMyPending = this.shouldShowMySubmit();
        // OCT-21 / GLM-F3：草稿编辑态独立守卫（与 shouldShowMySubmit 的前置条件等价，
        // 但不再依赖「无任何编辑态」——本身就是编辑态）。补 isMultiCollab() 纵深防御。
        const showMyDraftEditing =
            editingMyDraft &&
            this.isMultiCollab() &&
            personalResult?.worker_status === 2 &&
            !personalResult?.submitted_at &&
            members.length > 1;
        // v2 F2：只要 renderMyPendingSubmitRow 会渲染「我」（无论草稿编辑态或常规态），
        // 都必须从 pendingOthers 里排掉「我」，避免双份渲染。
        const pendingOthers = (showMyPending || showMyDraftEditing)
            ? pending.filter((m) => m.user_id !== myUid)
            : pending;
        // need3：自己那条的「编辑」按钮 gate=can_edit_personal。
        const canEditPersonal = !!detail?.permissions?.can_edit_personal;
        return (
            <div className="summary-detail-participant-reports">
                <h3>{t("summary.detail.participantReports")}</h3>
                {submittedSorted.map((m) => {
                    const expanded = !!expandedReports[m.user_id];
                    const content = m.content!;
                    const isMe = m.user_id === myUid;
                    // need3：自己那条进入行内编辑（initialContent=自己的 content），保存调 personal-edit。
                    // F1（纵深防御）：加 canEditPersonal 双校验，权限不足即使状态残留也不进 editor。
                    if (isMe && editingPersonalReport && canEditPersonal) {
                        return (
                            <div key={m.user_id} className="summary-detail-participant-report-item">
                                <div className="summary-detail-participant-report-header">
                                    <span>{m.user_name}</span>
                                </div>
                                <SummaryEditor
                                    mode="personal"
                                    taskId={detail!.task_id}
                                    baseResultId={detail?.result_id ?? 0}
                                    initialContent={content}
                                    onSave={this.handleEditPersonalReportSave}
                                    onCancel={this.handleEditPersonalReportCancel}
                                />
                            </div>
                        );
                    }
                    // need3：他人那条隐私收口（citations=[] 、清 [n]）不变；自己那条不被清洗，可正常显示引用。
                    const displayContent = isMe ? content : content.replace(/\[\d+\]/g, '');
                    const displayCitations = isMe ? (m.citations || []) : [];
                    const needsTruncate = displayContent.length > 100;
                    return (
                        <div
                            key={m.user_id}
                            className="summary-detail-participant-report-item"
                        >
                            {/* 问题3：收起触发点收窄为 header 行与底部 toggle 行，正文区不再绑点击，
                                避免展开后选文字/点 [n] 引用误触收起。仅 needsTruncate 时可点、带手型光标。 */}
                            <div
                                className={`summary-detail-participant-report-header${needsTruncate ? " clickable" : ""}`}
                                onClick={() => needsTruncate && this.toggleReport(m.user_id)}
                            >
                                <span>{m.user_name}</span>
                                <span style={{ color: "var(--semi-color-text-3)", fontWeight: 400 }}>·</span>
                                <span style={{ fontSize: 13, color: "var(--semi-color-text-2)", fontWeight: 400 }}>
                                    {formatDate(m.submitted_at!)}
                                </span>
                                {/* need3：仅自己那条加「编辑」按钮（gate=can_edit_personal）；他人无按钮。 */}
                                {isMe && canEditPersonal && detail?.status === TaskStatus.COMPLETED && (
                                    <Button
                                        size="small"
                                        theme="borderless"
                                        icon={<IconEdit />}
                                        style={{ marginLeft: "auto" }}
                                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); this.handleStartEditPersonalReport(); }}
                                    >
                                        {t("summary.detail.editMyReport")}
                                    </Button>
                                )}
                            </div>
                            {isMe && this.renderPersonalVersionHistory()}
                            <div className="summary-detail-participant-report-content">
                                {/* 问题2：「我」那条也参与 expanded/needsTruncate 收起逻辑。
                                    isMe 始终用 CitationText 渲染（保留引用可点）；
                                    collapsed 时传截断后的 content（截断后编号可能丢失，
                                    可接受），展开时传完整 content。他人那条逻辑不变。 */}
                                {isMe ? (
                                    <CitationText
                                        content={expanded || !needsTruncate ? displayContent : displayContent.slice(0, 100) + "..."}
                                        citations={displayCitations}
                                    />
                                ) : expanded ? (
                                    <CitationText
                                        content={displayContent}
                                        citations={displayCitations}
                                    />
                                ) : (
                                    <div>
                                        {needsTruncate ? displayContent.slice(0, 100) + "..." : displayContent}
                                    </div>
                                )}
                            </div>
                            {needsTruncate && (
                                <div
                                    className="summary-detail-participant-report-toggle clickable"
                                    onClick={() => this.toggleReport(m.user_id)}
                                >
                                    {expanded ? t("summary.detail.collapse") : t("summary.detail.expandAll")}
                                </div>
                            )}
                        </div>
                    );
                })}
                {showMyPending && this.renderMyPendingSubmitRow()}
                {showMyDraftEditing && this.renderMyPendingSubmitRow()}
                {pendingOthers.map((m) => (
                    <div key={m.user_id} className="summary-detail-participant-report-pending">
                        <IconClock style={{ fontSize: 14 }} />
                        <span>{t("summary.detail.waitingSubmit", { values: { name: m.user_name } })}</span>
                    </div>
                ))}
                {/* OCT-15 / upstream #495：declined 成员单独成行，复用 confirmPage.declined（“已拒绝参与” / “Participation declined”）。
                    沿用 pending 行的容器类名 + 一个 --declined modifier 以便将来定制样式；本次不动 SCSS。 */}
                {declined.map((m) => (
                    <div
                        key={m.user_id}
                        className="summary-detail-participant-report-pending summary-detail-participant-report-pending--declined"
                    >
                        <IconClose style={{ fontSize: 14 }} />
                        <span>
                            {m.user_name}
                            <span style={{ color: "var(--semi-color-text-3)", fontWeight: 400 }}> · </span>
                            <span style={{ fontSize: 13, color: "var(--semi-color-text-2)", fontWeight: 400 }}>
                                {t("summary.confirmPage.declined")}
                            </span>
                        </span>
                    </div>
                ))}
            </div>
        );
    }

    /**
     * 方案甲：参与者报告区里「我（未提交）」的主提交入口行。
     * need1（修正）：提交前自己的总结也要在参与者报告里能看到正文，并可在此处提交。
     * 正文/引用取 this.state.personalResult（members 接口对未提交的人不下发 content），
     * 用 CitationText 渲染（引用可点）。提交按钮走 handleSubmitPersonal 不变。
     */
    renderMyPendingSubmitRow() {
        const { t } = this.context;
        const { personalResult, editingMyDraft, detail } = this.state;
        const myContent = personalResult?.content || "";
        const myCitations = personalResult?.citations || [];
        // OCT-21：草稿编辑态——整行让位给 SummaryEditor (mode=personal_draft)，
        // 「提交给全部」按钮在编辑态下不可见（与既有「team / personal 编辑」体验一致）。
        if (editingMyDraft && detail) {
            return (
                <div
                    key="__my_pending_submit_editing__"
                    className="summary-detail-participant-report-item summary-detail-my-pending-row"
                >
                    <div className="summary-detail-participant-report-header">
                        <span>{t("summary.detail.mySubmitRowName")}</span>
                    </div>
                    <SummaryEditor
                        mode="personal_draft"
                        taskId={detail.task_id}
                        baseResultId={detail.result_id ?? 0}
                        initialContent={myContent}
                        onSave={this.handleEditMyDraftSave}
                        onCancel={this.handleEditMyDraftCancel}
                    />
                </div>
            );
        }
        return (
            <div
                key="__my_pending_submit__"
                className="summary-detail-participant-report-item summary-detail-my-pending-row"
            >
                <div className="summary-detail-participant-report-header">
                    <span>{t("summary.detail.mySubmitRowName")}</span>
                    {/* OCT-21：提交前编辑入口。文案复用 summary.common.edit；按钮放在「提交给全部」左侧。 */}
                    <Button
                        size="small"
                        theme="borderless"
                        icon={<IconEdit />}
                        style={{ marginLeft: "auto" }}
                        onClick={this.handleStartEditMyDraft}
                    >
                        {t("summary.common.edit")}
                    </Button>
                    <Button
                        size="small"
                        theme="solid"
                        style={{ marginLeft: 8 }}
                        onClick={this.handleSubmitPersonal}
                    >
                        {t("summary.detail.submitToAll")}
                    </Button>
                </div>
                {this.renderPersonalVersionHistory()}
                {myContent && this.canRevealPersonalContent() && (
                    <div className="summary-detail-participant-report-content">
                        <CitationText content={myContent} citations={myCitations} />
                    </div>
                )}
            </div>
        );
    }

    handleStartEdit = () => {
        // F1：进入单人个人总结编辑时互斥关闭另两个编辑态。
        // OCT-21：同时关闭草稿编辑态（纵深防御）。
        this.setState({ isEditing: true, editingTeamSummary: false, editingPersonalReport: false, editingMyDraft: false });
    };

    togglePersonalExpanded = () => {
        this.setState((prev) => ({ personalExpanded: !prev.personalExpanded }));
    };

    handleEditSave = () => {
        this.setState({ isEditing: false });
        this.loadDetail();
    };

    handleEditCancel = () => {
        this.setState({ isEditing: false });
    };

    // need3：进入/退出「自己的个人报告」行内编辑。保存走 personal-edit（后端自动重算团队）。
    handleStartEditPersonalReport = () => {
        // F1：互斥——只留 editingPersonalReport，关闭团队/单人编辑态。
        // OCT-21：同时关闭草稿编辑态。
        this.setState({ editingPersonalReport: true, editingTeamSummary: false, isEditing: false, editingMyDraft: false });
    };
    handleEditPersonalReportSave = () => {
        this.setState({ editingPersonalReport: false });
        // need6：保存后 loadDetail 刷新（后端已触发团队重算）；同时重拉个人/成员。
        this.loadDetail();
    };
    handleEditPersonalReportCancel = () => {
        this.setState({ editingPersonalReport: false });
    };

    // need4：进入/退出「团队总结」行内编辑（仅 creator）。保存走既有 PUT /summaries/:id/edit。
    handleStartEditTeam = () => {
        // F1：互斥——只留 editingTeamSummary，关闭个人/单人编辑态。
        // OCT-21：同时关闭草稿编辑态。
        this.setState({ editingTeamSummary: true, editingPersonalReport: false, isEditing: false, editingMyDraft: false });
    };
    handleEditTeamSave = () => {
        this.setState({ editingTeamSummary: false });
        this.loadDetail();
    };
    handleEditTeamCancel = () => {
        this.setState({ editingTeamSummary: false });
    };

    // OCT-21：提交前编辑「我自己」的个人报告草稿。三件套与 handleStartEditPersonalReport 对齐。
    handleStartEditMyDraft = () => {
        // 互斥：只留 editingMyDraft，关闭其他三种编辑态。
        this.setState({
            editingMyDraft: true,
            isEditing: false,
            editingPersonalReport: false,
            editingTeamSummary: false,
        });
    };
    handleEditMyDraftSave = () => {
        // v2 F3：保存后统一走 loadDetail()——不是 loadPersonalResult。
        // 理由：草稿保存遇 409（已被并发 submit 抢先）会让 personalResult.submitted_at 变非空，
        // 但 members 中的「我」仍是 pending，只刷 personalResult 会让分桶视图错乱。
        // loadDetail 一把全刷（task/members/personal/schedule），保证分桶绝对一致；
        // 草稿成功路径不重算团队，loadDetail 也不会触发新的 LLM 调用，开销可接受。
        this.setState({ editingMyDraft: false });
        this.loadDetail();
    };
    handleEditMyDraftCancel = () => {
        this.setState({ editingMyDraft: false });
    };

    // need7：creator 添加新成员。选定后调 POST /members，成功 loadDetail 刷新（新成员 Pending）。
    handleOpenAddMember = () => {
        this.setState({ showAddMember: true });
    };
    handleAddMemberConfirm = async (selected: MemberCandidate[]) => {
        if (this.taskId == null) return;
        const userIds = selected.map((m) => m.user_id).filter(Boolean);
        if (userIds.length === 0) {
            this.setState({ showAddMember: false });
            return;
        }
        this.setState({ addingMember: true });
        try {
            await api.addMembers(this.taskId, userIds);
            Toast.success(t("summary.detail.addMemberSuccess"));
            this.setState({ showAddMember: false, addingMember: false });
            // 新成员以「待确认」出现在成员状态列表，重拉详情。
            this.loadDetail();
        } catch (err: any) {
            this.setState({ addingMember: false });
            Toast.error(err.message || t("summary.detail.addMemberFailed"));
        }
    };
    handleAddMemberCancel = () => {
        this.setState({ showAddMember: false });
    };

    renderScheduleButton() {
        const { detail, scheduleItem, scheduleLoading, isEditing, editingTeamSummary, editingPersonalReport, editingMyDraft } = this.state;
        const { t } = this.context;
        // OCT-21 / GPT-S1：草稿编辑态也隐藏 schedule 按钮，与其它编辑态保持一致约束。
        if (!detail?.permissions?.can_schedule || isEditing || editingTeamSummary || editingPersonalReport || editingMyDraft) return null;
        // #158/#161 fast-follow：agent 总结不支持 schedule —— schedule 到点会 trigger
        // 后端 pipeline 走传统 map-reduce 重跑，但 agent 总结的产出是 chat 交互生成，
        // 没有可 replay 的 sources/participants。触发后任务会卡在 Pending 或 fail，
        // 用户体验很差。前端直接不渲染这个按钮，避免用户误点。
        if (detail?.trigger_type === TriggerType.AGENT) return null;

        // 任务3：hasSchedule 仅在存在且 is_active 时为 true。
        // 停用后文案回到「设置定时更新」。
        const hasActiveSchedule = !!scheduleItem && scheduleItem.is_active !== false;
        const hasSchedule =
            hasActiveSchedule ||
            (!scheduleItem && !!(detail.schedule_id && detail.schedule_id > 0));

        return (
            <Button
                size="small"
                theme="borderless"
                type="tertiary"
                icon={<IconClock />}
                onClick={this.openScheduleModal}
                disabled={scheduleLoading}
                loading={scheduleLoading}
            >
                {t(hasSchedule ? "summary.detail.editSchedule" : "summary.detail.setSchedule")}
            </Button>
        );
    }

    /**
     * V5/§4.2：本任务是否为 V5 schedule 级 CONFIRM 任务。
     * 以 scheduleItem.confirm_policy===1 区分两条确认路：
     *  - true：WAITING_CONFIRM 入口走 schedule 级确认 banner（不导向旧页）。
     *  - false：旧 task 级 manual 确认流，保留导向 SummaryConfirmPage。
     * 无 scheduleItem 或 confirm_policy≠1 均视为旧路径（false）。
     */
    private isV5ScheduleConfirm(): boolean {
        const { scheduleItem } = this.state;
        return !!scheduleItem && scheduleItem.confirm_policy === 1;
    }

    /**
     * 竞态修复（第3轮）finding 2：WAITING_CONFIRM 多人分支的渲染分路决策。
     *
     * scheduleItem 由 loadDetail 之后的二次异步 loadSchedule 回填，到达时间不确定。
     * 若直接用 isV5ScheduleConfirm()（只看 confirm_policy===1）分路，scheduleItem 未到
     * 的瞬间窗口会返回 false → V5 CONFIRM 任务 fallback 到旧 SummaryConfirmPage。
     *
     * 因此把旧分支的条件从「!isV5」收紧为「已加载完成 && 确认不是 V5」：
     *  - 'loading'：scheduleLoading 期间（scheduleItem 尚未到）只显示加载态，不暴露
     *    任何确认入口，绝不 fallback 旧页。
     *  - 'v5'：加载完成且 confirm_policy===1 → schedule 级确认 banner。
     *  - 'legacy'：加载完成且确认非 V5（confirm_policy≠1）或确无 schedule
     *    （scheduleItem 为 null 且 scheduleLoading=false）→ 保留旧 SummaryConfirmPage 路径。
     */
    private waitingConfirmMode(): 'loading' | 'v5' | 'legacy' {
        if (this.state.scheduleLoading) return 'loading';
        return this.isV5ScheduleConfirm() ? 'v5' : 'legacy';
    }

    /**
     * V5/§4.5：当前登录用户是否尚需对本定时任务完成一次性确认。
     * 条件：confirm_policy=1（CONFIRM）且该用户在 participant_config 名单里 confirmed=false
     *（含 creator——creator 也要确认）。确认后永久免确认，按钮消失。
     * 兼容：participant_config 为旧纯数组时无 confirmed 态，视为需确认。
     */
    needsScheduleConfirm(): boolean {
        const { scheduleItem } = this.state;
        if (!scheduleItem) return false;
        if (scheduleItem.is_active === false) return false;
        if (scheduleItem.confirm_policy !== 1) return false;
        const uid = WKApp.loginInfo.uid;
        const pc = scheduleItem.participant_config;
        if (!pc || !uid) return false;
        // 旧纯数组（string[]）：无确认态 → 只要在名单里就视为需确认。
        if (Array.isArray(pc)) {
            return pc.includes(uid);
        }
        const me = (pc.participants || []).find((p) => p.user_id === uid);
        if (!me) return false;
        return me.confirmed !== true;
    }

    handleConfirmSchedule = async () => {
        // 续修7：入口捕获 requestTaskId。await confirmSchedule 期间切 task，不得把 A 的
        // schedule 回显到 B（finally 的 confirmingSchedule 复位保留）。
        const requestTaskId = this.taskId;
        const { scheduleItem } = this.state;
        if (!scheduleItem) return;
        this.setState({ confirmingSchedule: true });
        try {
            await api.confirmSchedule(scheduleItem.schedule_id);
            // 迟到（已切 task）：不回显新 task（confirmingSchedule 由 finally 复位）。
            if (this.taskId !== requestTaskId) return;
            Toast.success(t("summary.detail.scheduleConfirmed"));
            WKApp.mittBus.emit("summary-attention-refresh-requested" as any);
            // 复用现有加载路径刷新（不新增任何出站推送）：重拉 schedule 让按钮消失。
            this.loadSchedule(scheduleItem.schedule_id);
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        } finally {
            this.setState({ confirmingSchedule: false });
        }
    };

    // V5/§4.5：schedule 级一次性确认入口。常驻直到该成员确认成功；
    // 确认后后续所有轮不再出现。点击调 POST /summary-schedules/:id/confirm。
    renderScheduleConfirm() {
        const { t } = this.context;
        if (!this.needsScheduleConfirm()) return null;
        return (
            <Banner
                type="info"
                closeIcon={null}
                fullMode={false}
                style={{ marginTop: 12 }}
                description={
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <span>{t("summary.detail.scheduleConfirmHint")}</span>
                        <Button
                            theme="solid"
                            size="small"
                            loading={this.state.confirmingSchedule}
                            onClick={this.handleConfirmSchedule}
                        >
                            {t("summary.detail.scheduleConfirmButton")}
                        </Button>
                    </div>
                }
            />
        );
    }

    // 任务2：详情页直观展示当前定时（人类可读）。
    renderScheduleSummary() {
        const { detail, scheduleItem } = this.state;
        const { t } = this.context;
        // need2：定时**信息**只读展示对所有参与者可见（can_view_schedule），不再限 creator。
        // 位置不变（header）。定时**设置**按钮仍仅 creator（renderScheduleButton, need5），两者拆开。
        if (!detail?.permissions?.can_view_schedule) return null;
        if (!scheduleItem) return null;

        const inactive = scheduleItem.is_active === false;
        if (inactive) {
            // 已停用：灰色提示，不当作有效定时
            return (
                <div
                    className="summary-detail-schedule-summary summary-detail-schedule-summary--inactive"
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        color: "var(--semi-color-text-2)",
                    }}
                >
                    <IconClock size="small" />
                    <span>{t("summary.detail.scheduleDisabledHint")}</span>
                </div>
            );
        }

        const text = formatScheduleSummary(scheduleItem);
        if (!text) return null;
        return (
            <div
                className="summary-detail-schedule-summary"
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    color: "var(--semi-color-text-1)",
                }}
            >
                <IconClock size="small" style={{ color: "var(--semi-color-primary)" }} />
                <span>{text}</span>
            </div>
        );
    }

    renderHeader() {
        const { detail } = this.state;
        const { t } = this.context;
        const myUid = WKApp.loginInfo.uid;
        const isCreator = detail?.creator_id != null && detail.creator_id === myUid;
        const isParticipant = !!detail?.participants?.some((p) => p.user_id === myUid);

        return (
            <div className="summary-detail-header">
                <div className="summary-detail-header-inner">
                    <div className="summary-detail-header-title-wrap">
                        <OverflowTooltip as="h2" className="summary-detail-title" title={detail?.title || t("summary.detail.defaultTitle")}>
                            {detail?.title || t("summary.detail.defaultTitle")}
                        </OverflowTooltip>
                        {this.renderScheduleSummary()}
                    </div>
                    <div className="summary-detail-header-actions">
                        {detail && detail.status === TaskStatus.COMPLETED && detail.trigger_type === TriggerType.AGENT && (
                            <Button
                                theme="solid"
                                type="primary"
                                onClick={this.handleContinueRefine}
                            >
                                {t("summary.detail.continueRefine")}
                            </Button>
                        )}
                        {this.renderScheduleButton()}
                        {detail && detail.status === TaskStatus.COMPLETED && (() => {
                            // #907 review (yujiawei P2-1): agent summary forward
                            // sources fall through to personalResult.content, which
                            // is fetched async by loadPersonalResult. During that
                            // load window a click would silently no-op. Disable +
                            // loading state until the fallback content is in.
                            // Traditional workflow has detail.result inline, so it
                            // is never gated here.
                            const isAgent = detail.trigger_type === TriggerType.AGENT;
                            const agentContentReady = !!this.state.personalResult?.content?.trim();
                            const waitingForFallback = isAgent && !detail.result?.content?.trim() && !agentContentReady;
                            return (
                                <Button
                                    size="small"
                                    theme="borderless"
                                    type="tertiary"
                                    icon={<IconSend />}
                                    onClick={this.handleForwardToChat}
                                    loading={waitingForFallback && this.state.personalLoading}
                                    disabled={waitingForFallback}
                                >
                                    {t("summary.detail.forwardToChat")}
                                </Button>
                            );
                        })()}
                        {SHOW_FORWARD_TO_MATTER && detail && detail.status === TaskStatus.COMPLETED && (
                            <Button
                                size="small"
                                theme="borderless"
                                type="tertiary"
                                icon={<IconSend />}
                                onClick={this.handleForwardToMatter}
                                loading={this.state.forwardingToMatter}
                                disabled={this.state.forwardingToMatter}
                            >
                                {t("summary.detail.forwardToMatter")}
                            </Button>
                        )}
                        {/* #158/#161 fast-follow：agent 总结不支持 regenerate —— 传统
                            regenerate 走 triggerWorker("personal_summary")，agent 任务无
                            participants/sources 可 replay 会卡死；"重生成"对 agent 应为
                            "重开一次 chat"，continueRefine 已覆盖该入口。 */}
                        {detail && canRegenerate(detail.status) && detail.trigger_type !== TriggerType.AGENT && (
                            <Button
                                size="small"
                                theme="borderless"
                                type="tertiary"
                                icon={<IconHistory />}
                                onClick={this.handleRegenerate}
                            >
                                {t("summary.detail.regenerate")}
                            </Button>
                        )}
                        {detail && canCancel(detail.status) && (
                            <Button
                                size="small"
                                theme="borderless"
                                type="tertiary"
                                icon={<IconClose />}
                                onClick={this.handleCancel}
                            >
                                {t("summary.detail.cancelTask")}
                            </Button>
                        )}
                        {detail && isCreator ? (
                            <Popconfirm
                                title={t("summary.summaryCard.deleteTitle")}
                                content={t("summary.summaryCard.deleteContent", { values: { title: detail?.title || detail?.task_no || "" } })}
                                onConfirm={this.handleDeleteTask}
                            >
                                <Button
                                    size="small"
                                    theme="borderless"
                                    type="tertiary"
                                    icon={<IconDelete />}
                                    aria-label={t("summary.common.delete")}
                                />
                            </Popconfirm>
                        ) : detail && isParticipant ? (
                            <Popconfirm
                                title={t("summary.detail.leaveTask")}
                                content={t("summary.detail.leaveConfirm")}
                                onConfirm={this.handleLeaveTask}
                            >
                                <Button
                                    size="small"
                                    theme="borderless"
                                    type="tertiary"
                                    icon={<IconExit />}
                                    aria-label={t("summary.detail.leaveTask")}
                                />
                            </Popconfirm>
                        ) : null}
                    </div>
                </div>
                {this.renderScheduleConfirm()}
            </div>
        );
    }

    render() {
        const { detail, loading, error, showScheduleConfig, scheduleConfig } = this.state;
        const { t } = this.context;

        return (
            <div className="summary-detail-page">
                {this.renderHeader()}

                <div className="summary-detail-content-wrapper">
                    <div className="summary-detail-content-scroll">
                        <div className="summary-detail-content-inner">
                        {loading && (
                            <div className="summary-detail-loading">
                                <Spin size="large" />
                            </div>
                        )}

                        {error && (
                            <Banner
                                type="warning"
                                description={t("summary.detail.errorCause")}
                                closeIcon={null}
                                style={{ marginBottom: 16 }}
                                fullMode={false}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span>{error}</span>
                                    <Button size="small" onClick={() => this.loadDetail()}>{t("summary.common.retry")}</Button>
                                </div>
                            </Banner>
                        )}

                        {detail && !loading && (() => {
                            const myP = detail.participants?.find((p) => p.user_id === WKApp.loginInfo.uid);
                            const isMultiParticipant = (detail.participants?.length ?? 0) > 1;
                            const isPendingInvite = isMultiParticipant && myP != null && myP.status === ParticipantStatus.PENDING;
                            return isPendingInvite ? (
                                <div
                                    className="summary-detail-respond-banner"
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 12,
                                        padding: "12px 16px",
                                        marginBottom: 16,
                                        background: "var(--semi-color-primary-light-default)",
                                        borderRadius: 8,
                                    }}
                                >
                                    <span style={{ flex: 1, color: "var(--semi-color-text-0)" }}>{t("summary.detail.inviteQuestion")}</span>
                                    <Button size="small" theme="solid" onClick={() => this.handleRespondToTask("accept")}>{t("summary.action.accept")}</Button>
                                    <Button size="small" onClick={() => this.handleRespondToTask("reject")}>{t("summary.action.reject")}</Button>
                                </div>
                            ) : null;
                        })()}

                        {detail && !loading && (
                            <>
                                {this.renderRefineLoadingStatus()}
                                {detail.summary_mode === SummaryMode.BY_PERSON && (
                                    <>
                                        {/* need1：多人协作不再单独显示「我的总结」区块（自己内容改到参与者报告
                                            里我那条，need3）；单人 BY_PERSON 维持显示「我的总结」及其行内编辑。 */}
                                        {!this.isMultiCollab() && (
                                            <>
                                                {this.shouldShowProcessingCard() && !this.personalReady && this.renderProcessing()}
                                                {this.state.isEditing && this.state.personalResult && detail.result_id ? (
                                                    <div className="summary-detail-personal">
                                                        <h3>{t("summary.detail.mySummaryPlain")}</h3>
                                                        <SummaryEditor
                                                            taskId={detail.task_id}
                                                            baseResultId={detail.result_id}
                                                            initialContent={this.state.personalResult.content || ""}
                                                            onSave={this.handleEditSave}
                                                            onCancel={this.handleEditCancel}
                                                        />
                                                    </div>
                                                ) : (
                                                    this.renderPersonalSummary()
                                                )}
                                            </>
                                        )}
                                        {/* 回归修复：多人协作页给「我自己」补回「提交给全部」轻量入口。
                                            不违反 need1（不恢复我的总结正文区），仅一句提示 + 提交按钮。
                                            isMultiCollab 内部门控；单人/BY_GROUP 返回 null。 */}
                                        {this.isMultiCollabRegenerating() && this.shouldShowWorkflowCard() && this.renderProcessing()}
                                        {this.isMultiCollabRegenerating() && !this.shouldShowWorkflowCard() && this.renderTeamGeneratingStatus()}
                                        {this.renderMySubmitBar()}
                                        {this.state.teamStreaming && this.state.teamStreamingContent.trim() ? (
                                            <>
                                                {this.renderTeamStreamingContent()}
                                                {this.renderStreamingContent()}
                                            </>
                                        ) : (
                                            <>
                                                {this.renderStreamingContent()}
                                                {this.renderTeamSummary()}
                                            </>
                                        )}
                                        {this.renderMemberStatus()}
                                        {this.renderParticipantReports()}
                                    </>
                                )}

                                {detail.summary_mode !== SummaryMode.BY_PERSON &&
                                    this.shouldShowProcessingCard() &&
                                    !this.personalReady &&
                                    this.renderProcessing()
                                }
                                {detail.summary_mode !== SummaryMode.BY_PERSON && this.renderStreamingContent()}

                                {detail.status === TaskStatus.FAILED && this.renderFailed()}

                                {detail.status === TaskStatus.CANCELLED && (
                                    <div className="summary-detail-cancelled">
                                        <div style={{ fontSize: 48, marginBottom: 12 }}>🚫</div>
                                        <p style={{ fontSize: 16, fontWeight: 500 }}>{t("summary.detail.cancelledTitle")}</p>
                                        <p style={{ fontSize: 14, color: "var(--semi-color-text-2)", marginTop: 8 }}>
                                            {t("summary.detail.cancelledDesc")}
                                        </p>
                                    </div>
                                )}

                                {/* 单人时不显示"等待参与者确认"，因为creator自动接受 */}
                                {detail.status === TaskStatus.WAITING_CONFIRM && this.state.members.length > 1 && (() => {
                                    const mode = this.waitingConfirmMode();
                                    return mode === 'loading' ? (
                                        // 竞态修复（第3轮）finding 2：scheduleItem 由 loadDetail 之后的二次
                                        // 异步 loadSchedule 回填，未到达时 isV5ScheduleConfirm() 会返回 false。
                                        // 若此时直接 fallback 到旧 SummaryConfirmPage，V5 CONFIRM 任务会在
                                        // scheduleItem 未到的瞬间窗口落到旧 task 级确认流。因此定时加载
                                        // 未完成期间只显示加载态，不暴露任何确认入口；等 scheduleItem 到了
                                        // （scheduleLoading=false）再按 isV5ScheduleConfirm 分路。
                                        this.renderProcessing()
                                    ) : mode === 'v5' ? (
                                        // V5/§4.2：schedule 级 CONFIRM 任务（confirm_policy===1）。
                                        // 不再导向旧 task 级 SummaryConfirmPage（POST /summaries/:id/confirm
                                        // 选 sources，与「确认一次长期生效」语义冲突）。改为引导到
                                        // header 中常驻的 schedule 级确认 banner（renderScheduleConfirm →
                                        // POST /summary-schedules/:id/confirm）。进入本详情页即可触达该 banner。
                                        <div className="summary-detail-waiting">
                                            <div style={{ fontSize: 48, marginBottom: 12 }}>⏳</div>
                                            <p style={{ fontSize: 16, fontWeight: 500 }}>{t("summary.detail.waitingConfirmTitle")}</p>
                                            <p style={{ fontSize: 14, color: "var(--semi-color-text-2)", marginTop: 8, marginBottom: 16 }}>
                                                {t("summary.detail.scheduleConfirmHint")}
                                            </p>
                                        </div>
                                    ) : (
                                        // 旧的非 V5 / task 级 manual 确认流（confirm_policy 非 1 或无 schedule）
                                        // 保留走 SummaryConfirmPage，不破坏旧路径。
                                        <div className="summary-detail-waiting">
                                            <div style={{ fontSize: 48, marginBottom: 12 }}>⏳</div>
                                            <p style={{ fontSize: 16, fontWeight: 500 }}>{t("summary.detail.waitingConfirmTitle")}</p>
                                            <p style={{ fontSize: 14, color: "var(--semi-color-text-2)", marginTop: 8, marginBottom: 16 }}>
                                                {t("summary.detail.waitingConfirmDesc")}
                                            </p>
                                            <Button onClick={() => WKApp.routeLeft.push(<SummaryConfirmPage taskId={this.taskId} />)}>
                                                {t("summary.detail.viewConfirmStatus")}
                                            </Button>
                                        </div>
                                    );
                                })()}
                                {/* 单人 WaitingConfirm 状态显示生成中（个人总结已出则不再显示 loading） */}
                                {detail.status === TaskStatus.WAITING_CONFIRM && this.state.members.length <= 1 && !this.personalReady && (
                                    this.renderProcessing()
                                )}

                                {detail.status === TaskStatus.COMPLETED && detail.summary_mode !== SummaryMode.BY_PERSON && (
                                    this.renderCompleted()
                                )}

                                {/* RefineSection removed — 反馈修改改为在智能总结 chat 里引用总结迭代
                                    (见 CHAT-REFERENCE-BASED-DESIGN-v1) */}
                            </>
                        )}
                    </div>
                </div>
                {detail && !loading && (
                    <div className="summary-detail-sources-footer">
                        <div className="summary-detail-sources-footer-inner">
                            <SelectedSourcesPanel sources={detail.sources} />
                        </div>
                    </div>
                )}
                </div>

                <ScheduleConfigModal
                    visible={showScheduleConfig}
                    value={scheduleConfig || { unit: "week", every: 1, time: "09:00" }}
                    onConfirm={this.handleScheduleSave}
                    onCancel={() => this.setState({ showScheduleConfig: false })}
                    hasExisting={!!this.state.scheduleItem && this.state.scheduleItem.is_active !== false}
                    onDisable={this.handleScheduleDisable}
                    disabling={this.state.scheduleDisabling}
                />
                <MatterPickerModal
                    visible={this.state.showMatterPicker}
                    onSelect={this.handleMatterSelected}
                    onCancel={() => this.setState({ showMatterPicker: false })}
                />
                {/* need7：复用创建任务时的成员选择器，creator 添加新成员。 */}
                <MemberSelectorModal
                    visible={this.state.showAddMember}
                    selected={[]}
                    excludedUserIds={(this.state.detail?.participants || []).map((p) => p.user_id)}
                    confirmLoading={this.state.addingMember}
                    onConfirm={this.handleAddMemberConfirm}
                    onCancel={this.handleAddMemberCancel}
                />
                {this.renderVersionDetailModal()}
                <Modal
                    title={t("summary.detail.adjustSummaryTitle")}
                    visible={this.state.showRegenerateModal}
                    onOk={this.handleRegenerateConfirm}
                    onCancel={this.handleRegenerateCancel}
                    okText={this.state.regenerateMode === "refine" ? t("summary.detail.refineAction") : t("summary.detail.regenerate")}
                    cancelText={t("summary.common.cancel")}
                    confirmLoading={this.state.regenerateSubmitting}
                    okButtonProps={{
                        disabled: this.state.regenerateMode === "refine"
                            ? !this.state.refineFeedback.trim() || (this.state.detail?.summary_mode === SummaryMode.BY_PERSON && !this.shouldOperateOnTeamSummary() ? !this.state.personalResult?.id : !this.state.detail?.result_id)
                            : !this.state.regenerateTopic.trim(),
                    }}
                >
<div className="summary-adjust-mode-list">
                        <button
                            type="button"
                            className={this.state.regenerateMode === "refine" ? "summary-adjust-mode is-active" : "summary-adjust-mode"}
                            onClick={() => this.setState({ regenerateMode: "refine" })}
                        >
                            <span className="summary-adjust-mode-title">{t("summary.detail.refineModeTitle")}</span>
                            <span className="summary-adjust-mode-desc">{t("summary.detail.refineModeDesc")}</span>
                        </button>
                        <button
                            type="button"
                            className={this.state.regenerateMode === "full" ? "summary-adjust-mode is-active" : "summary-adjust-mode"}
                            onClick={() => this.setState({ regenerateMode: "full" })}
                        >
                            <span className="summary-adjust-mode-title">{t("summary.detail.fullRegenerateModeTitle")}</span>
                            <span className="summary-adjust-mode-desc">{t("summary.detail.fullRegenerateModeDesc")}</span>
                        </button>
                    </div>
                    {this.state.regenerateMode === "refine" ? (
                        <>
                            <label id="summary-refine-feedback-label" className="summary-adjust-label">
                                {t("summary.detail.refineFeedbackLabel")}
                            </label>
                            <textarea
                                aria-labelledby="summary-refine-feedback-label"
                                className="summary-regenerate-topic-textarea"
                                rows={4}
                                maxLength={2000}
                                placeholder={t("summary.detail.refineFeedbackPlaceholder")}
                                value={this.state.refineFeedback}
                                onChange={(e) => this.setState({ refineFeedback: e.target.value.slice(0, 2000) })}
                            />
                        </>
                    ) : (
                        <>
                            <label id="regenerate-topic-label" className="summary-adjust-label">
                                {t("summary.detail.regenerateTopicLabel")}
                            </label>
                            <div style={{ position: "relative" }}>
                                <textarea
                                    ref={this.regenerateTopicRef}
                                    aria-labelledby="regenerate-topic-label"
                                    className="summary-regenerate-topic-textarea"
                                    rows={3}
                                    maxLength={SUMMARY_INPUT_MAX_LENGTH}
                                    value={this.state.regenerateTopic}
                                    onChange={(e) => this.setState({ regenerateTopic: e.target.value.slice(0, SUMMARY_INPUT_MAX_LENGTH) })}
                                />
                                <VoiceInputButton
                                    inputRef={this.regenerateTopicRef}
                                    onTranscribed={this.handleRegenerateTopicVoice}
                                    getCurrentText={() => this.state.regenerateTopic}
                                    showModeMenu
                                    size="sm"
                                    className="wk-vib--textarea-corner"
                                />
                            </div>
                        </>
                    )}
                </Modal>
            </div>
        );
    }
}
