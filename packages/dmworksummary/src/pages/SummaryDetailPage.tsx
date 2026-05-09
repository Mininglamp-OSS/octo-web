import React, { Component } from "react";
import {
    Button,
    Spin,
    Toast,
    Banner,
    Dropdown,
} from "@douyinfe/semi-ui";
import { IconEdit, IconMore, IconSend } from "@douyinfe/semi-icons";
import { Channel, ChannelTypeGroup, ChannelTypePerson, MessageText, WKSDK } from "wukongimjssdk";
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
            this.setState({ error: err.message || "加载失败", loading: false });
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
            Toast.success("已提交");
            this.loadPersonalResult();
            this.loadMembers();
        } catch (err: any) {
            Toast.error(err.message || "提交失败");
        }
    };

    handleRespondToTask = async (action: "accept" | "reject") => {
        if (this.taskId == null) return;
        try {
            await api.respondToTask(this.taskId, action);
            Toast.success(action === "accept" ? "已同意" : "已拒绝");
            this.loadDetail();
        } catch (err: any) {
            Toast.error(err.message || "操作失败");
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
            Toast.success("已开始重新生成");
            this.loadDetail();
            window.dispatchEvent(new CustomEvent("summary-task-regenerated", { detail: { taskId: this.taskId } }));
        } catch (err: any) {
            Toast.error(err.message || "操作失败");
        }
    };

    handleCancel = async () => {
        if (this.taskId == null) return;
        try {
            await api.cancelSummary(this.taskId);
            Toast.success("任务已取消");
            this.loadDetail();
        } catch (err: any) {
            Toast.error(err.message || "操作失败");
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
                Toast.success("定时更新已保存");
                this.loadSchedule(scheduleItem.schedule_id);
            } else {
                const newSchedule = await api.createSchedule({
                    title: detail.title,
                    summary_mode: detail.summary_mode,
                    cron_expr: cronExpr,
                    time_range_type: 2,
                    sources: detail.sources,
                });
                Toast.success("定时更新已创建");
                this.setState({ scheduleItem: newSchedule });
            }
            this.setState({ showScheduleConfig: false });
        } catch (err: any) {
            Toast.error(err.message || "保存失败");
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
                    Toast.error('转发失败');
                } else {
                    Toast.error(`部分频道转发失败 (${errors.length}/${channels.length})`);
                }
            } else {
                Toast.success('已转发');
            }
        }, '转发到聊天');
    };

    handleForwardToMatter = () => {
        const { detail } = this.state;
        if (!detail || detail.status !== TaskStatus.COMPLETED) return;

        const content = detail.result?.content;
        if (!content?.trim()) {
            Toast.warning('暂无可转发的内容');
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
            Toast.success(`已转发到「${matterTitle}」`);
        } catch (err: any) {
            Toast.error(err.message || '转发失败');
        } finally {
            this.setState({ forwardingToMatter: false });
        }
    };

    renderProcessing() {
        return (
            <div className="summary-detail-processing" style={{ padding: "32px 0", textAlign: "center", color: "var(--semi-color-text-2)" }}>
                <Spin size="large" />
                <div style={{ marginTop: 16, fontSize: 14 }}>
                    正在生成总结...
                </div>
            </div>
        );
    }

    renderFailed() {
        const { detail } = this.state;
        if (!detail) return null;
        return (
            <div className="summary-detail-failed">
                <div className="summary-detail-failed-icon">❌</div>
                <h3>总结生成失败</h3>
                {detail.error_message && (
                    <div className="summary-detail-failed-reason">
                        失败原因：{detail.error_message}
                    </div>
                )}
                <div className="summary-detail-failed-meta">
                    <div>任务编号：{detail.task_no}</div>
                    <div>创建时间：{formatDate(detail.created_at)}</div>
                </div>
            </div>
        );
    }

    renderCompleted() {
        const { detail } = this.state;
        if (!detail || !detail.result) return null;
        return (
            <div className="summary-detail-result">
                <CitationText content={detail.result.content} citations={detail.result.citations || []} />
                <div className="summary-detail-result-meta">
                    <span>版本 {detail.result.version}</span>
                    <span>·</span>
                    <span>{detail.result.total_msg_count} 条消息</span>
                    <span>·</span>
                    <span>{formatDate(detail.result.generated_at)}</span>
                    {detail.result_is_edited && detail.result_edited_at && (
                        <>
                            <span>·</span>
                            <span>已编辑 {formatDate(detail.result_edited_at)}</span>
                        </>
                    )}
                </div>
            </div>
        );
    }

    renderPersonalSummary() {
        const { personalResult, personalLoading } = this.state;
        if (personalLoading) {
            return (
                <div className="summary-detail-personal">
                    <h3>我的总结</h3>
                    <Spin size="small" />
                </div>
            );
        }
        if (!personalResult) return null;
        return (
            <div className="summary-detail-personal">
                <h3>我的总结</h3>
                <div className="summary-detail-personal-status">
                    {personalResult.worker_status === 2 && !personalResult.submitted_at && this.state.members.length > 1 && (
                        <Button size="small" theme="solid" onClick={this.handleSubmitPersonal}>
                            提交给所有人
                        </Button>
                    )}
                </div>
                {personalResult.content && (
                    <div className="summary-detail-personal-content">
                        <CitationText content={personalResult.content} citations={personalResult.citations || []} />
                    </div>
                )}
            </div>
        );
    }

    renderTeamSummary() {
        const { detail, members } = this.state;
        if (!detail || !detail.result) return null;
        if (members.length <= 1) return null;
        const submittedCount = members.filter((m) => m.status === "submitted").length;
        if (submittedCount === 0) return null;
        return (
            <div className="summary-detail-team">
                <h3>团队汇总</h3>
                <SummaryContent content={detail.result.content} />
                <div className="summary-detail-team-meta">
                    <span>基于 {submittedCount} 人提交</span>
                    <span>·</span>
                    <span>版本 {detail.result.version}</span>
                </div>
            </div>
        );
    }

    renderMemberStatus() {
        const { members, membersLoading } = this.state;
        if (membersLoading) {
            return (
                <div className="summary-detail-members">
                    <h3>成员状态</h3>
                    <Spin size="small" />
                </div>
            );
        }
        // 如果只有 1 个人（creator 自己），不显示成员状态区块
        if (members.length <= 1) return null;
        const statusMap: Record<string, { icon: string; label: string }> = {
            pending: { icon: "⏸", label: "待响应" },
            accepted: { icon: "✅", label: "已同意" },
            declined: { icon: "🚫", label: "已拒绝" },
            processing: { icon: "⏳", label: "生成中" },
            completed: { icon: "✅", label: "已完成" },
            submitted: { icon: "✅", label: "已提交" },
        };
        return (
            <div className="summary-detail-members">
                <h3>成员状态</h3>
                <div className="summary-detail-members-list">
                    {members.map((m) => {
                        const st = statusMap[m.status] || statusMap["pending"];
                        const isMe = m.user_id === WKApp.loginInfo.uid;
                        return (
                            <div key={m.user_id} className="summary-detail-member-item">
                                <span className="summary-detail-member-name">{m.user_name}</span>
                                <span className="summary-detail-member-status">
                                    {st.icon} {st.label}
                                </span>
                                {isMe && m.status === "pending" && (
                                    <span style={{ display: "inline-flex", gap: 4, marginLeft: 8 }}>
                                        <Button size="small" theme="solid" onClick={() => this.handleRespondToTask("accept")}>同意</Button>
                                        <Button size="small" onClick={() => this.handleRespondToTask("reject")}>拒绝</Button>
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
        // 如果只有 1 个人（creator 自己），不显示参与者报告区块
        if (membersLoading || members.length <= 1) return null;
        const submitted = members.filter((m) => m.submitted_at && m.content);
        const pending = members.filter((m) => !m.submitted_at || !m.content);
        if (submitted.length === 0 && pending.length === 0) return null;
        return (
            <div className="summary-detail-participant-reports" style={{ marginTop: 16 }}>
                <h3>参与者报告</h3>
                {submitted.map((m) => {
                    const expanded = !!expandedReports[m.user_id];
                    const content = m.content!;
                    const needsTruncate = content.length > 100;
                    return (
                        <div
                            key={m.user_id}
                            style={{
                                padding: "8px 12px",
                                fontSize: 14,
                                borderBottom: "1px solid var(--semi-color-border)",
                                cursor: needsTruncate ? "pointer" : "default",
                            }}
                            onClick={() => needsTruncate && this.toggleReport(m.user_id)}
                        >
                            <div style={{ fontWeight: 500, marginBottom: 4, color: "var(--semi-color-text-0)" }}>
                                {m.user_name} · {formatDate(m.submitted_at!)}
                            </div>
                            {expanded ? (
                                <CitationText content={content} citations={m.citations || []} />
                            ) : (
                                <div style={{ color: "var(--semi-color-text-1)" }}>
                                    {needsTruncate ? content.slice(0, 100) + "..." : content}
                                </div>
                            )}
                            {needsTruncate && (
                                <div style={{ marginTop: 4, fontSize: 12, color: "var(--semi-color-primary)" }}>
                                    {expanded ? "收起" : "展开全部"}
                                </div>
                            )}
                        </div>
                    );
                })}
                {pending.map((m) => (
                    <div
                        key={m.user_id}
                        style={{
                            padding: "8px 12px",
                            color: "var(--semi-color-text-2)",
                            fontSize: 14,
                        }}
                    >
                        {m.user_name} · 等待提交...
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

        // Build "..." menu items
        const menuItems: { node: string; key: string; onClick: () => void; danger?: boolean }[] = [];
        if (detail && canRegenerate(detail.status)) {
            menuItems.push({ node: "重新生成", key: "regenerate", onClick: this.handleRegenerate });
        }
        if (detail && canCancel(detail.status)) {
            menuItems.push({ node: "取消任务", key: "cancel", onClick: this.handleCancel, danger: true });
        }

        return (
            <div className="summary-detail-header" style={{ padding: "20px 24px 12px", display: "flex", flexDirection: "column", alignItems: "stretch", width: "100%", boxSizing: "border-box", gap: 0, marginBottom: 0 }}>
                <div className="summary-detail-header-top" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, width: "100%" }}>
                    <OverflowTooltip as="h2" className="summary-detail-title" style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 20, fontWeight: 600, lineHeight: "28px", color: "var(--semi-color-text-0)" }}>{detail?.title || "总结详情"}</OverflowTooltip>
                    <div className="summary-detail-header-actions" style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, paddingTop: 2 }}>
                        {detail && detail.status === TaskStatus.COMPLETED && detail.summary_mode === SummaryMode.BY_PERSON && detail.permissions?.can_edit && !this.state.isEditing && (
                            <Button
                                theme="borderless"
                                icon={<IconEdit />}
                                onClick={this.handleStartEdit}
                            >
                                编辑
                            </Button>
                        )}
                        {detail && detail.status === TaskStatus.COMPLETED && (
                            <Button
                                theme="borderless"
                                icon={<IconSend />}
                                onClick={this.handleForwardToChat}
                            >
                                转发到聊天
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
                                转发到 Matters
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

        return (
            <div className="summary-detail-page">
                {this.renderHeader()}

                {loading && (
                    <div className="summary-detail-loading">
                        <Spin size="large" />
                    </div>
                )}

                {error && (
                    <Banner
                        type="warning"
                        description="可能由网络波动或服务异常导致"
                        closeIcon={null}
                        style={{ marginBottom: 16 }}
                        fullMode={false}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span>{error}</span>
                            <Button size="small" onClick={() => this.loadDetail()}>重试</Button>
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
                            <span style={{ flex: 1, color: "var(--semi-color-text-0)" }}>你被邀请参与此总结任务，是否同意？</span>
                            <Button size="small" theme="solid" onClick={() => this.handleRespondToTask("accept")}>同意</Button>
                            <Button size="small" onClick={() => this.handleRespondToTask("reject")}>拒绝</Button>
                        </div>
                    ) : null;
                })()}

                {detail && !loading && (
                    <>
                        {detail.summary_mode === SummaryMode.BY_PERSON && (
                            <>
                                {this.state.isEditing && this.state.personalResult && detail.result_id ? (
                                    <div className="summary-detail-personal">
                                        <h3>我的总结</h3>
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
                                <p>任务已取消</p>
                            </div>
                        )}

                        {/* 单人时不显示"等待参与者确认"，因为creator自动接受 */}
                        {detail.status === TaskStatus.WAITING_CONFIRM && this.state.members.length > 1 && (
                            <div className="summary-detail-waiting">
                                <p>等待参与者确认中...</p>
                                <Button onClick={() => WKApp.routeLeft.push(<SummaryConfirmPage taskId={this.taskId} />)}>
                                    查看确认状态
                                </Button>
                            </div>
                        )}
                        {/* 单人 WaitingConfirm 状态显示生成中 */}
                        {detail.status === TaskStatus.WAITING_CONFIRM && this.state.members.length <= 1 && (
                            <div className="summary-detail-processing">
                                <Spin size="large" />
                                <p>正在生成中...</p>
                            </div>
                        )}

                        {detail.status === TaskStatus.COMPLETED && detail.summary_mode !== SummaryMode.BY_PERSON && (
                            this.renderCompleted()
                        )}

                        <SelectedSourcesPanel sources={detail.sources} />
                    </>
                )}

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
