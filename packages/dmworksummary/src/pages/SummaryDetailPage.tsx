import React, { Component } from "react";
import {
    Button,
    Spin,
    Toast,
    Banner,
    Dropdown,
    Tag,
    Modal,
    Popconfirm,
} from "@douyinfe/semi-ui";
import { IconEdit, IconMore, IconSend, IconClock, IconTick, IconClose, IconInfoCircle, IconHistory, IconUser, IconPlus, IconMinusCircle, IconExit } from "@douyinfe/semi-icons";
import { Channel, ChannelTypeGroup, ChannelTypePerson, MessageText, WKSDK } from "wukongimjssdk";
import { I18nContext, t } from "@octo/base";
import WKApp from "@octo/base/src/App";
import VoiceInputButton from "@octo/base/src/Components/VoiceInputButton";
import type { ReplaceMode, SelectionRange } from "@octo/base/src/Components/VoiceInputButton";
import { splitSummaryText } from "../utils/splitMessage";
import SummaryConfirmPage from "./SummaryConfirmPage";
import * as api from "../api/summaryApi";
import OverflowTooltip from "../components/OverflowTooltip";
import type {
    SummaryDetail,
    PersonalResult,
    MemberStatus,
    ScheduleItem,
    ScheduleConfig,
    WorkflowStage,
} from "../types/summary";
import { TaskStatus, SummaryMode, ParticipantStatus } from "../types/summary";
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
import MemberSelectorModal from "../components/MemberSelectorModal";
import type { MemberCandidate } from "../types/summary";

interface SummaryDetailPageProps {
    taskId?: number;
}

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
    lastKnownStatus?: number;
    expandedReports: Record<string, boolean>;
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
    regenerateTopic: string;
    regenerateSubmitting: boolean;
    /** V5：schedule 级一次性确认提交中 */
    confirmingSchedule: boolean;
    workflowDisplayIndex: number;
    workflowGateContent: boolean;
    workflowRevealDone: boolean;
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
            this.setState({ regenerateTopic: text.slice(0, 1000) });
        } else if (mode === "selection" && savedRange) {
            this.setState((prev) => {
                const before = prev.regenerateTopic.slice(0, savedRange.from);
                const after = prev.regenerateTopic.slice(savedRange.to);
                const budget = Math.max(0, 1000 - before.length - after.length);
                return { regenerateTopic: before + text.slice(0, budget) + after };
            });
        } else {
            this.setState((prev) => {
                const pos = savedRange?.from ?? prev.regenerateTopic.length;
                const before = prev.regenerateTopic.slice(0, pos);
                const after = prev.regenerateTopic.slice(pos);
                const budget = Math.max(0, 1000 - before.length - after.length);
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
        isEditing: false,
        editingPersonalReport: false,
        editingTeamSummary: false,
        editingMyDraft: false,
        showAddMember: false,
        addingMember: false,
        showMatterPicker: false,
        forwardingToMatter: false,
        showRegenerateModal: false,
        regenerateTopic: "",
        regenerateSubmitting: false,
        confirmingSchedule: false,
        workflowDisplayIndex: -1,
        workflowGateContent: false,
        workflowRevealDone: false,
    };

    private personalPollTimer: ReturnType<typeof setInterval> | null = null;
    private fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
    private fallbackStartTimeout: ReturnType<typeof setTimeout> | null = null;
    private workflowAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
    private workflowCompleteTimer: ReturnType<typeof setTimeout> | null = null;
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
        window.addEventListener("summary-status-change", this.handleStatusChangeEvent);
        window.addEventListener("summary-batch-heartbeat", this.handleBatchHeartbeat);
        window.addEventListener("summary-list-unmount", this.handleListPageUnmount);
        this.loadDetail();
    }

    componentDidUpdate(prevProps: any) {
        const prevTaskId = prevProps.taskId;
        const currentTaskId = this.taskId;
        if (prevTaskId !== currentTaskId && currentTaskId != null) {
            this.listPageActive = false;
            this.clearAllTimers();
            // Blocking 5：切 task 立即清空上一 task 的 schedule 状态，避免在新 detail
            // 返回前闪现旧定时（bump seq 由 loadDetail 内部完成，令旧 loadSchedule 作废）。
            this.setState({ scheduleItem: null, scheduleLoading: false });
            this.loadDetail();
        }
    }

    componentWillUnmount() {
        window.removeEventListener("summary-status-change", this.handleStatusChangeEvent);
        window.removeEventListener("summary-batch-heartbeat", this.handleBatchHeartbeat);
        window.removeEventListener("summary-list-unmount", this.handleListPageUnmount);
        this.clearAllTimers();
    }

    private clearAllTimers() {
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
        return this.props.taskId ?? null;
    }

    async loadDetail() {
        if (this.taskId == null) return;
        // Blocking 5：每轮 detail 加载开始就 bump 序列号。这样旧 task 未完成的
        // loadSchedule（包括本函数下面发起的）都会被后续轮作废，不会回填到新 task。
        const seq = this.nextScheduleSeq();
        const requestTaskId = this.taskId;
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
        });
        try {
            const detail = await api.getSummaryDetail(this.taskId);
            // detail 本身也可能是旧请求：期间切了 task / 又发了一轮 loadDetail 就丢弃。
            if (this.scheduleLoadSeq !== seq || this.taskId !== requestTaskId) return;
            this.setState({
                detail,
                loading: false,
                lastKnownStatus: detail.status,
                workflowGateContent: false,
            });

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
            } else {
                this.stopFallbackPoll();
            }
            // Load BY_PERSON data
            if (detail.summary_mode === SummaryMode.BY_PERSON) {
                // FE-1：把本轮 seq 传给二次异步加载，迟到响应按 seq/taskId 校验后才 setState。
                this.loadPersonalResult(seq);
                this.loadMembers(seq);
            }
        } catch (err: any) {
            // FE-1（切 task 竞态）：迟到的失败响应也要校验归属，否则旧 task 的加载失败
            // 会把错误/loading 状态写到已切换的新 task 上。
            if (this.scheduleLoadSeq !== seq || this.taskId !== requestTaskId) return;
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
    async loadPersonalResult(seq?: number) {
        if (this.taskId == null) return;
        const reqSeq = seq ?? this.nextScheduleSeq();
        const requestTaskId = this.taskId;
        this.setState({ personalLoading: true });
        try {
            const result = await api.getPersonalResult(this.taskId);
            // 迟到响应（期间切 task / 重新加载）：丢弃，不污染新 task。
            if (this.scheduleLoadSeq !== reqSeq || this.taskId !== requestTaskId) return;
            const shouldGateWorkflow = this.shouldGateWorkflowForPersonalResult(result);
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
        } catch {
            if (this.scheduleLoadSeq !== reqSeq || this.taskId !== requestTaskId) return;
            this.setState({ personalLoading: false });
        }
    }

    /**
     * FE-1（切 task 竞态）：同 loadPersonalResult——迟到的 getMembers 响应不能
     * 把旧 task 的成员名单 setState 到新 task（否则泄漏他人报告 / 污染 team
     * citations、schedule participant 写入）。seq/taskId 不一致一律忽略。
     */
    async loadMembers(seq?: number) {
        if (this.taskId == null) return;
        const reqSeq = seq ?? this.nextScheduleSeq();
        const requestTaskId = this.taskId;
        this.setState({ membersLoading: true });
        try {
            const members = await api.getMembers(this.taskId);
            if (this.scheduleLoadSeq !== reqSeq || this.taskId !== requestTaskId) return;
            this.setState({ members, membersLoading: false });
        } catch {
            if (this.scheduleLoadSeq !== reqSeq || this.taskId !== requestTaskId) return;
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
        } catch (err: any) {
            if (this.taskId !== requestTaskId) return;
            Toast.error(err.message || t("summary.detail.leaveFailed"));
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

    handleRegenerate = () => {
        const { detail } = this.state;
        if (this.taskId == null) return;
        this.setState({
            showRegenerateModal: true,
            regenerateTopic: detail?.title || "",
        });
    };

    handleRegenerateConfirm = async () => {
        if (this.taskId == null || this.state.regenerateSubmitting) return;
        const trimmed = this.state.regenerateTopic.trim();
        if (!trimmed) return;
        this.setState({ regenerateSubmitting: true });
        try {
            await api.regenerateSummary(this.taskId, { topic: trimmed });
            Toast.success(t("summary.detail.regenerateStarted"));
            this.setState({ showRegenerateModal: false });
            this.loadDetail();
            window.dispatchEvent(new CustomEvent("summary-task-regenerated", { detail: { taskId: this.taskId } }));
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        } finally {
            this.setState({ regenerateSubmitting: false });
        }
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
            this.setState({
                scheduleConfig: scheduleItemToConfig(scheduleItem),
                showScheduleConfig: true,
            });
        } else {
            this.setState({
                scheduleConfig: { unit: "week", every: 1, time: "09:00" },
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

    handleForwardToChat = () => {
        const { detail } = this.state;
        if (!detail?.result?.content?.trim()) return;
        WKApp.shared.baseContext.showConversationSelect(async (channels: Channel[]) => {
            const cleanContent = (detail?.result?.content ?? '').replace(/\[\d+\]/g, '').replace(/  +/g, ' ').trim();
            const chunks = splitSummaryText(cleanContent);
            const errors: string[] = [];

            for (const ch of channels) {
                try {
                    for (let i = 0; i < chunks.length; i++) {
                        const msg = new MessageText(chunks[i]);

                        // Inject space_id for person channels (matching ConversationVM.sendMessage pattern)
                        const spaceId = WKApp.shared.currentSpaceId;
                        if (spaceId && ch.channelType === ChannelTypePerson) {
                            const originalEncodeJSON = msg.encodeJSON.bind(msg);
                            msg.encodeJSON = () => {
                                const obj = originalEncodeJSON();
                                obj.space_id = spaceId;
                                return obj;
                            };
                            msg.contentObj = { ...(msg.contentObj || {}), space_id: spaceId };
                        }

                        await WKSDK.shared().chatManager.send(msg, ch);
                        if (i < chunks.length - 1) {
                            await new Promise((r) => setTimeout(r, INTER_MESSAGE_DELAY_MS));
                        }
                    }
                } catch {
                    errors.push(ch.channelID);
                }
            }

            if (errors.length > 0) {
                if (errors.length === channels.length) {
                    Toast.error(t("summary.detail.forwardFailed"));
                } else {
                    Toast.error(t("summary.detail.partialForwardFailed", { values: { failed: errors.length, total: channels.length } }));
                }
            } else {
                Toast.success(t("summary.detail.forwarded"));
            }
        }, t("summary.detail.forwardToChat"));
    };

    handleForwardToMatter = () => {
        const { detail } = this.state;
        if (!detail || detail.status !== TaskStatus.COMPLETED) return;

        const content = detail.result?.content;
        if (!content?.trim()) {
            Toast.warning(t("summary.detail.noForwardContent"));
            return;
        }

        this.setState({ showMatterPicker: true });
    };

    handleMatterSelected = async (matterId: string, matterTitle: string) => {
        const { detail } = this.state;
        if (!detail) return;

        const content = detail.result?.content;
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
            : (detail?.status === TaskStatus.PROCESSING ? 0 : -1);
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
        return (
            <div className="summary-detail-processing">
                <div className="summary-progress-copy">
                    <div className="summary-progress-title">
                        {t("summary.detail.processingTitle")}
                    </div>
                    <div className="summary-progress-desc">
                        {t("summary.detail.processingDesc")}
                    </div>
                </div>
                {this.renderWorkflowProgress()}
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

    renderCompleted() {
        const { detail } = this.state;
        const { t } = this.context;
        if (!detail || !detail.result) return null;
        return (
            <div className="summary-detail-result">
                <div className="summary-detail-result-header">
                    <h3>{t("summary.detail.contentTitle")}</h3>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {/* need5：个人/单人（BY_GROUP 或单人 BY_PERSON）定时按钮放在编辑按钮左边。
                            BY_GROUP 无独立编辑按钮，定时按钮置于结果标题行。 */}
                        {!this.isMultiCollab() && this.renderScheduleButton()}
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
        const { personalResult, personalLoading, detail } = this.state;
        const { t } = this.context;
        if (personalLoading) {
            return (
                <div className="summary-detail-personal">
                    <div className="summary-detail-section-header">
                        <span>{t("summary.detail.mySummary")}</span>
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
                    <span>{t("summary.detail.mySummary")}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {/* need5：单人 BY_PERSON 定时按钮放「编辑」按钮左边。多人协作不在此区渲染
                            （need1 不显示我的总结区；need5 多人定时按钮在团队框）。 */}
                        {!this.isMultiCollab() && this.renderScheduleButton()}
                        {detail && detail.status === TaskStatus.COMPLETED && detail.permissions?.can_edit && !this.state.isEditing && (
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
                {personalResult.content && (
                    <div className="summary-detail-content-box">
                        <CitationText content={personalResult.content} citations={personalResult.citations || []} />
                    </div>
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
        // 问题4：多人协作任务（members.length > 1）且 status===PROCESSING 时，
        // 团队总结正在生成/重算（参与者退出后后端把任务拉回 Processing 重算 meta worker）。
        // 此时 detail.result 可能尚未产出或为旧版本，应显示“生成中”提示，
        // 所以该判断必须放在 `if (!detail.result) return null` 之前。
        if (members.length > 1 && detail.status === TaskStatus.PROCESSING) {
            return (
                <div className="summary-detail-team">
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
                        {/* need5：多人协作→定时按钮放团队框右侧、编辑按钮左边，顺序 [定时][编辑]，均仅 creator。 */}
                        {this.isMultiCollab() && this.renderScheduleButton()}
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

        // Build "..." menu items
        const menuItems: { node: string; key: string; onClick: () => void; danger?: boolean }[] = [];
        if (detail && canRegenerate(detail.status)) {
            menuItems.push({ node: t("summary.detail.regenerate"), key: "regenerate", onClick: this.handleRegenerate });
        }
        if (detail && canCancel(detail.status)) {
            menuItems.push({ node: t("summary.detail.cancelTask"), key: "cancel", onClick: this.handleCancel, danger: true });
        }

        return (
            <div className="summary-detail-header">
                <div className="summary-detail-header-inner">
                    <OverflowTooltip as="h2" className="summary-detail-title" title={detail?.title || t("summary.detail.defaultTitle")}>
                        {detail?.title || t("summary.detail.defaultTitle")}
                    </OverflowTooltip>
                    <div className="summary-detail-header-actions">
                        {detail && detail.status === TaskStatus.COMPLETED && (
                            <Button
                                theme="borderless"
                                icon={<IconSend />}
                                onClick={this.handleForwardToChat}
                            >
                                {t("summary.detail.forwardToChat")}
                            </Button>
                        )}
                        {detail && detail.status === TaskStatus.COMPLETED && (
                            <Button
                                theme="borderless"
                                icon={<IconSend />}
                                onClick={this.handleForwardToMatter}
                                loading={this.state.forwardingToMatter}
                                disabled={this.state.forwardingToMatter}
                            >
                                {t("summary.detail.forwardToMatter")}
                            </Button>
                        )}
                        {menuItems.length > 0 && (
                            <Dropdown
                                trigger="click"
                                position="bottomRight"
                                render={
                                    <Dropdown.Menu>
                                        {menuItems.map((item) => (
                                            <Dropdown.Item
                                                key={item.key}
                                                onClick={item.onClick}
                                                style={item.danger ? { color: "var(--semi-color-danger)" } : undefined}
                                            >
                                                {item.node}
                                            </Dropdown.Item>
                                        ))}
                                    </Dropdown.Menu>
                                }
                            >
                                <Button theme="borderless" icon={<IconMore />} />
                            </Dropdown>
                        )}
                    </div>
                </div>
                {this.renderScheduleSummary()}
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
                                {detail.summary_mode === SummaryMode.BY_PERSON && (
                                    <>
                                        {/* need1：多人协作不再单独显示「我的总结」区块（自己内容改到参与者报告
                                            里我那条，need3）；单人 BY_PERSON 维持显示「我的总结」及其行内编辑。 */}
                                        {!this.isMultiCollab() && (
                                            this.state.isEditing && this.state.personalResult && detail.result_id ? (
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
                                            )
                                        )}
                                        {/* 回归修复：多人协作页给「我自己」补回「提交给全部」轻量入口。
                                            不违反 need1（不恢复我的总结正文区），仅一句提示 + 提交按钮。
                                            isMultiCollab 内部门控；单人/BY_GROUP 返回 null。 */}
                                        {this.renderMySubmitBar()}
                                        {this.renderTeamSummary()}
                                        {this.renderMemberStatus()}
                                        {this.renderParticipantReports()}
                                    </>
                                )}

                                {this.shouldShowProcessingCard() &&
                                    !this.personalReady &&
                                    this.renderProcessing()
                                }

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

                                <SelectedSourcesPanel sources={detail.sources} />
                            </>
                        )}
                    </div>
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
                <Modal
                    title={t("summary.detail.regenerateEditTitle")}
                    visible={this.state.showRegenerateModal}
                    onOk={this.handleRegenerateConfirm}
                    onCancel={this.handleRegenerateCancel}
                    okText={t("summary.detail.regenerate")}
                    cancelText={t("summary.common.cancel")}
                    confirmLoading={this.state.regenerateSubmitting}
                    okButtonProps={{ disabled: !this.state.regenerateTopic.trim() }}
                >
                    <label id="regenerate-topic-label" style={{ display: "block", marginBottom: 8, color: "var(--semi-color-text-1)" }}>
                        {t("summary.detail.regenerateTopicLabel")}
                    </label>
                    <div style={{ position: "relative" }}>
                        <textarea
                            ref={this.regenerateTopicRef}
                            aria-labelledby="regenerate-topic-label"
                            className="summary-regenerate-topic-textarea"
                            rows={3}
                            maxLength={1000}
                            value={this.state.regenerateTopic}
                            onChange={(e) => this.setState({ regenerateTopic: e.target.value.slice(0, 1000) })}
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
                </Modal>
            </div>
        );
    }
}
