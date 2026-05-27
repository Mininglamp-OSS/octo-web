import React, { Component } from "react";
import {
    Button,
    Spin,
    Toast,
    Banner,
    Dropdown,
    Tag,
} from "@douyinfe/semi-ui";
import { IconEdit, IconMore, IconSend, IconClock, IconTick, IconClose, IconInfoCircle, IconHistory, IconUser } from "@douyinfe/semi-icons";
import { Channel, ChannelTypeGroup, ChannelTypePerson, MessageText, WKSDK } from "wukongimjssdk";
import { I18nContext, t } from "@octo/base";
import WKApp from "@octo/base/src/App";
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
} from "../types/summary";
import { TaskStatus, SummaryMode, ParticipantStatus } from "../types/summary";
import {
    formatDate,
    canCancel,
    canRegenerate,
    cronToScheduleConfig,
    scheduleToCron,
} from "../utils/summaryHelpers";
import SummaryContent from "../components/SummaryContent";
import CitationText from "../components/CitationText";
import SelectedSourcesPanel from "../components/SelectedSourcesPanel";
import ScheduleConfigModal from "../components/ScheduleConfigModal";
import MatterPickerModal from "../components/MatterPickerModal";
import * as matterBridge from "../api/matterBridge";
import SummaryEditor from "../components/SummaryEditor";

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
    showScheduleConfig: boolean;
    scheduleConfig: ScheduleConfig | null;
    lastKnownStatus?: number;
    expandedReports: Record<string, boolean>;
    isEditing: boolean;
    showMatterPicker: boolean;
    forwardingToMatter: boolean;
}

const INTER_MESSAGE_DELAY_MS = 200;

export default class SummaryDetailPage extends Component<SummaryDetailPageProps, SummaryDetailPageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

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
        showScheduleConfig: false,
        scheduleConfig: null,
        expandedReports: {},
        isEditing: false,
        showMatterPicker: false,
        forwardingToMatter: false,
    };

    private personalPollTimer: ReturnType<typeof setInterval> | null = null;
    private fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
    private fallbackStartTimeout: ReturnType<typeof setTimeout> | null = null;
    private listPageActive = false;
    private lastEventTime = 0;
    private isPersonalPolling = false;

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
    }

    get taskId(): number | null {
        return this.props.taskId ?? null;
    }

    async loadDetail() {
        if (this.taskId == null) return;
        this.setState({ loading: true, error: null });
        try {
            const detail = await api.getSummaryDetail(this.taskId);
            this.setState({ detail, loading: false, lastKnownStatus: detail.status });

            // Load schedule if associated
            if (detail.schedule_id && detail.schedule_id > 0) {
                this.loadSchedule(detail.schedule_id);
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
                this.loadPersonalResult();
                this.loadMembers();
            }
        } catch (err: any) {
            this.setState({ error: err.message || t("summary.common.loadingFailed"), loading: false });
        }
    }

    async loadSchedule(scheduleId: number) {
        this.setState({ scheduleLoading: true });
        try {
            const item = await api.getSchedule(scheduleId);
            this.setState({ scheduleItem: item, scheduleLoading: false });
        } catch {
            this.setState({ scheduleLoading: false });
        }
    }

    async loadPersonalResult() {
        if (this.taskId == null) return;
        this.setState({ personalLoading: true });
        try {
            const result = await api.getPersonalResult(this.taskId);
            this.setState({ personalResult: result, personalLoading: false });
            this.startPersonalPoll(result.worker_status);
        } catch {
            this.setState({ personalLoading: false });
        }
    }

    async loadMembers() {
        if (this.taskId == null) return;
        this.setState({ membersLoading: true });
        try {
            const members = await api.getMembers(this.taskId);
            this.setState({ members, membersLoading: false });
        } catch {
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
                try {
                    const result = await api.getPersonalResult(this.taskId);
                    this.setState({ personalResult: result });
                    if (result.worker_status !== 0 && result.worker_status !== 1) {
                        if (this.personalPollTimer) clearInterval(this.personalPollTimer);
                        this.loadMembers();
                    }
                } catch {
                    // ignore poll errors
                } finally {
                    this.isPersonalPolling = false;
                }
            }, 5000);
        }
    }

    handleSubmitPersonal = async () => {
        if (this.taskId == null) return;
        try {
            await api.submitPersonalResult(this.taskId);
            Toast.success(t("summary.detail.submitSuccess"));
            this.loadPersonalResult();
            this.loadMembers();
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
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
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
            const detail = await api.getSummaryDetail(this.taskId);
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
                        this.loadPersonalResult();
                        this.loadMembers();
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
        try {
            const updates = await api.batchStatus([this.taskId]);
            const update = updates.find(u => u.id === this.taskId);
            if (!update) return;

            const prevStatus = this.state.lastKnownStatus;
            const newStatus = update.status;

            if (prevStatus !== undefined && prevStatus !== newStatus) {
                try {
                    const detail = await api.getSummaryDetail(this.taskId);
                    this.setState({ detail, lastKnownStatus: newStatus });
                    if (
                        newStatus === TaskStatus.COMPLETED ||
                        newStatus === TaskStatus.FAILED ||
                        newStatus === TaskStatus.CANCELLED
                    ) {
                        this.stopFallbackPoll();
                        if (detail.summary_mode === SummaryMode.BY_PERSON) {
                            this.loadPersonalResult();
                            this.loadMembers();
                        }
                        if (detail.schedule_id && detail.schedule_id > 0) {
                            this.loadSchedule(detail.schedule_id);
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

    handleRegenerate = async () => {
        if (this.taskId == null) return;
        try {
            await api.regenerateSummary(this.taskId);
            Toast.success(t("summary.detail.regenerateStarted"));
            this.loadDetail();
            window.dispatchEvent(new CustomEvent("summary-task-regenerated", { detail: { taskId: this.taskId } }));
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
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
        if (scheduleItem) {
            this.setState({
                scheduleConfig: cronToScheduleConfig(scheduleItem.cron_expr),
                showScheduleConfig: true,
            });
        } else {
            this.setState({
                scheduleConfig: { period: "daily", time: "09:00" },
                showScheduleConfig: true,
            });
        }
    };

    handleScheduleSave = async (config: ScheduleConfig) => {
        const { detail, scheduleItem } = this.state;
        if (!detail) return;

        const cronExpr = scheduleToCron(config);

        try {
            if (scheduleItem) {
                await api.updateSchedule(scheduleItem.schedule_id, { cron_expr: cronExpr });
                Toast.success(t("summary.detail.scheduleSaved"));
                this.loadSchedule(scheduleItem.schedule_id);
            } else {
                const newSchedule = await api.createSchedule({
                    title: detail.title,
                    summary_mode: detail.summary_mode,
                    cron_expr: cronExpr,
                    time_range_type: 2,
                    sources: detail.sources,
                });
                Toast.success(t("summary.detail.scheduleCreated"));
                this.setState({ scheduleItem: newSchedule });
            }
            this.setState({ showScheduleConfig: false });
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.saveFailed"));
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

    renderProcessing() {
        const { t } = this.context;
        return (
            <div className="summary-detail-processing">
                <Spin size="large" />
                <h3 style={{ marginTop: 16 }}>
                    {t("summary.detail.processingTitle")}
                </h3>
                <div style={{ fontSize: 14, color: "var(--semi-color-text-2)", marginTop: 8 }}>
                    {t("summary.detail.processingDesc")}
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

    renderCompleted() {
        const { detail } = this.state;
        const { t } = this.context;
        if (!detail || !detail.result) return null;
        return (
            <div className="summary-detail-result">
                <div className="summary-detail-result-header">
                    <h3>{t("summary.detail.contentTitle")}</h3>
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
        return (
            <div className="summary-detail-personal">
                <div className="summary-detail-section-header">
                    <span>{t("summary.detail.mySummary")}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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

    renderTeamSummary() {
        const { detail, members } = this.state;
        const { t } = this.context;
        if (!detail || !detail.result) return null;
        if (members.length <= 1) return null;
        const submittedCount = members.filter((m) => m.status === "submitted").length;
        if (submittedCount === 0) return null;
        return (
            <div className="summary-detail-team">
                <div className="summary-detail-section-header">
                    <span>{t("summary.detail.teamSummary")}</span>
                    <div className="summary-detail-section-badges">
                        <Tag color="cyan" size="small" prefixIcon={<IconUser />}>
                            {t("summary.detail.submittedPeople", { values: { count: submittedCount } })}
                        </Tag>
                        <Tag color="blue" size="small" prefixIcon={<IconHistory />}>
                            {t("summary.common.version", { values: { version: detail.result.version } })}
                        </Tag>
                    </div>
                </div>
                <div className="summary-detail-content-box">
                    <SummaryContent content={detail.result.content} />
                </div>
            </div>
        );
    }

    renderMemberStatus() {
        const { members, membersLoading } = this.state;
        const { t } = this.context;
        if (membersLoading) {
            return (
                <div className="summary-detail-members">
                    <h3>{t("summary.detail.memberStatus")}</h3>
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
                <h3>{t("summary.detail.memberStatus")}</h3>
                <div className="summary-detail-members-list">
                    {members.map((m) => {
                        const st = statusConfig[m.status] || statusConfig["pending"];
                        const isMe = m.user_id === WKApp.loginInfo.uid;
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
        const { members, membersLoading, expandedReports } = this.state;
        const { t } = this.context;
        // 如果只有 1 个人（creator 自己），不显示参与者报告区块
        if (membersLoading || members.length <= 1) return null;
        const submitted = members.filter((m) => m.submitted_at && m.content);
        const pending = members.filter((m) => !m.submitted_at || !m.content);
        if (submitted.length === 0 && pending.length === 0) return null;
        return (
            <div className="summary-detail-participant-reports">
                <h3>{t("summary.detail.participantReports")}</h3>
                {submitted.map((m) => {
                    const expanded = !!expandedReports[m.user_id];
                    const content = m.content!;
                    const needsTruncate = content.length > 100;
                    return (
                        <div
                            key={m.user_id}
                            className={`summary-detail-participant-report-item${needsTruncate ? " clickable" : ""}`}
                            onClick={() => needsTruncate && this.toggleReport(m.user_id)}
                        >
                            <div className="summary-detail-participant-report-header">
                                <span>{m.user_name}</span>
                                <span style={{ color: "var(--semi-color-text-3)", fontWeight: 400 }}>·</span>
                                <span style={{ fontSize: 13, color: "var(--semi-color-text-2)", fontWeight: 400 }}>
                                    {formatDate(m.submitted_at!)}
                                </span>
                            </div>
                            <div className="summary-detail-participant-report-content">
                                {expanded ? (
                                    <CitationText content={content} citations={m.citations || []} />
                                ) : (
                                    <div>
                                        {needsTruncate ? content.slice(0, 100) + "..." : content}
                                    </div>
                                )}
                            </div>
                            {needsTruncate && (
                                <div className="summary-detail-participant-report-toggle">
                                    {expanded ? t("summary.detail.collapse") : t("summary.detail.expandAll")}
                                </div>
                            )}
                        </div>
                    );
                })}
                {pending.map((m) => (
                    <div key={m.user_id} className="summary-detail-participant-report-pending">
                        <IconClock style={{ fontSize: 14 }} />
                        <span>{t("summary.detail.waitingSubmit", { values: { name: m.user_name } })}</span>
                    </div>
                ))}
            </div>
        );
    }

    handleStartEdit = () => {
        this.setState({ isEditing: true });
    };

    handleEditSave = () => {
        this.setState({ isEditing: false });
        this.loadDetail();
    };

    handleEditCancel = () => {
        this.setState({ isEditing: false });
    };

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
                    <OverflowTooltip as="h2" className="summary-detail-title">
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
                            const isPendingInvite = myP != null && myP.status === ParticipantStatus.PENDING;
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
                                        {this.renderTeamSummary()}
                                        {this.renderMemberStatus()}
                                        {this.renderParticipantReports()}
                                    </>
                                )}

                                {(detail.status === TaskStatus.PENDING || detail.status === TaskStatus.PROCESSING) &&
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
                                {detail.status === TaskStatus.WAITING_CONFIRM && this.state.members.length > 1 && (
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
                                )}
                                {/* 单人 WaitingConfirm 状态显示生成中 */}
                                {detail.status === TaskStatus.WAITING_CONFIRM && this.state.members.length <= 1 && (
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
                    value={scheduleConfig || { period: "daily", time: "09:00" }}
                    onConfirm={this.handleScheduleSave}
                    onCancel={() => this.setState({ showScheduleConfig: false })}
                />
                <MatterPickerModal
                    visible={this.state.showMatterPicker}
                    onSelect={this.handleMatterSelected}
                    onCancel={() => this.setState({ showMatterPicker: false })}
                />
            </div>
        );
    }
}
