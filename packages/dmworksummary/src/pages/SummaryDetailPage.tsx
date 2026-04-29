import React, { Component } from "react";
import {
    Button,
    Spin,
    Toast,
    Banner,
    Dropdown,
} from "@douyinfe/semi-ui";
import { IconMore, IconSend } from "@douyinfe/semi-icons";
import { Channel, ChannelTypeGroup, ChannelTypePerson, MessageText, WKSDK } from "wukongimjssdk";
import WKApp from "@octo/base/src/App";
import { splitSummaryText } from "../utils/splitMessage";
import SummaryConfirmPage from "./SummaryConfirmPage";
import * as api from "../api/summaryApi";
import type {
    SummaryDetail,
    PersonalResult,
    MemberStatus,
    ScheduleItem,
    ScheduleConfig,
} from "../types/summary";
import { TaskStatus, SummaryMode, ParticipantStatus, SourceType } from "../types/summary";
import {
    formatDate,
    canCancel,
    canRegenerate,
    cronToScheduleConfig,
    scheduleToCron,
} from "../utils/summaryHelpers";
import SummaryContent from "../components/SummaryContent";
import CitationText from "../components/CitationText";
import ScheduleConfigModal from "../components/ScheduleConfigModal";

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
}

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
    };

    private personalPollTimer: ReturnType<typeof setInterval> | null = null;
    private statusPollTimer: ReturnType<typeof setInterval> | null = null;
    private isStatusPolling = false;
    private isPersonalPolling = false;

    componentDidMount() {
        this.loadDetail();
    }

    componentDidUpdate(prevProps: any) {
        const prevTaskId = prevProps.taskId;
        const currentTaskId = this.taskId;
        if (prevTaskId !== currentTaskId && currentTaskId != null) {
            this.clearAllTimers();
            this.loadDetail();
        }
    }

    componentWillUnmount() {
        this.clearAllTimers();
    }

    private clearAllTimers() {
        if (this.personalPollTimer) {
            clearInterval(this.personalPollTimer);
            this.personalPollTimer = null;
        }
        if (this.statusPollTimer) {
            clearInterval(this.statusPollTimer);
            this.statusPollTimer = null;
        }
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

            // Start polling if task is in progress
            if (
                detail.status === TaskStatus.PROCESSING ||
                detail.status === TaskStatus.PENDING ||
                detail.status === TaskStatus.WAITING_CONFIRM
            ) {
                this.startStatusPolling();
            } else {
                this.stopStatusPolling();
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

    /** Re-fetch task detail every 3s when task is in progress */
    startStatusPolling() {
        if (this.statusPollTimer) return;
        this.statusPollTimer = setInterval(async () => {
            if (this.taskId == null) return;
            if (this.isStatusPolling) return;
            this.isStatusPolling = true;
            try {
                const detail = await api.getSummaryDetail(this.taskId);
                const prevStatus = this.state.lastKnownStatus;
                const newStatus = detail.status;

                if (prevStatus !== undefined && prevStatus !== newStatus) {
                    window.dispatchEvent(new CustomEvent("summary-status-change"));
                }

                if (
                    newStatus === TaskStatus.COMPLETED ||
                    newStatus === TaskStatus.FAILED ||
                    newStatus === TaskStatus.CANCELLED
                ) {
                    this.stopStatusPolling();
                    this.setState({ detail, lastKnownStatus: newStatus });
                    if (detail.summary_mode === SummaryMode.BY_PERSON) {
                        this.loadPersonalResult();
                        this.loadMembers();
                    }
                } else {
                    this.setState({ detail, lastKnownStatus: newStatus });
                }
            } catch {
                // ignore polling errors
            } finally {
                this.isStatusPolling = false;
            }
        }, 3000);
    }

    stopStatusPolling() {
        if (this.statusPollTimer) {
            clearInterval(this.statusPollTimer);
            this.statusPollTimer = null;
        }
    }

    handleRegenerate = async () => {
        if (this.taskId == null) return;
        try {
            await api.regenerateSummary(this.taskId);
            Toast.success("已开始重新生成");
            this.loadDetail();
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
            try {
                const chunks = splitSummaryText(detail.result!.content);
                for (const ch of channels) {
                    for (let i = 0; i < chunks.length; i++) {
                        WKSDK.shared().chatManager.send(new MessageText(chunks[i]), ch);
                        if (i < chunks.length - 1) {
                            await new Promise((r) => setTimeout(r, 200));
                        }
                    }
                }
                Toast.success("已转发");
            } catch {
                Toast.error("转发失败");
            }
        }, "转发到聊天");
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
                {detail.sources && detail.sources.length > 0 && (
                    <div style={{ marginTop: 12, fontSize: 12, color: "var(--semi-color-text-2)" }}>
                        <div style={{ marginBottom: 4 }}>信息来源：</div>
                        {detail.sources.map((s: any, idx: number) => {
                            const channelType = s.source_type === SourceType.DIRECT_MESSAGE
                                ? ChannelTypePerson
                                : ChannelTypeGroup;
                            return (
                                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                                    <span>{s.source_name}</span>
                                    <span
                                        style={{ color: "var(--semi-color-primary)", cursor: "pointer", fontSize: 12 }}
                                        onClick={() => {
                                            const channel = new Channel(s.source_id, channelType);
                                            WKApp.endpoints.showConversation(channel);
                                        }}
                                    >
                                        进入聊天
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
                <div className="summary-detail-result-meta">
                    <span>版本 {detail.result.version}</span>
                    <span>·</span>
                    <span>{detail.result.total_msg_count} 条消息</span>
                    <span>·</span>
                    <span>{formatDate(detail.result.generated_at)}</span>
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
                    <h2 className="summary-detail-title" style={{ margin: 0, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 20, fontWeight: 600, lineHeight: "28px", color: "var(--semi-color-text-0)" }}>{detail?.title || "总结详情"}</h2>
                    <div className="summary-detail-header-actions" style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, paddingTop: 2 }}>
                        {detail && detail.status === TaskStatus.COMPLETED && (
                            <Button
                                theme="borderless"
                                icon={<IconSend />}
                                onClick={this.handleForwardToChat}
                            >
                                转发到聊天
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
                                {this.renderPersonalSummary()}
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

                        {detail.status === TaskStatus.COMPLETED && detail.summary_mode !== SummaryMode.BY_PERSON && this.renderCompleted()}
                    </>
                )}

                <ScheduleConfigModal
                    visible={showScheduleConfig}
                    value={scheduleConfig || { period: "daily", time: "09:00" }}
                    onConfirm={this.handleScheduleSave}
                    onCancel={() => this.setState({ showScheduleConfig: false })}
                />
            </div>
        );
    }
}
