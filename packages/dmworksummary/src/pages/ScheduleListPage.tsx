import React, { Component } from "react";
import { Spin, Tag, Banner, Modal, Popconfirm, Toast } from "@douyinfe/semi-ui";
import { IconArrowLeft } from "@douyinfe/semi-icons";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { I18nContext, t, WKButton } from "@octo/base";
import WKApp from "@octo/base/src/App";
import * as api from "../api/summaryApi";
import type { CreateScheduleParams, ScheduleItem, UpdateScheduleParams } from "../types/summary";
import {
    getModeLabel,
    describeSchedule,
    getTimeRangeTypeLabel,
    scheduleItemToConfig,
} from "../utils/summaryHelpers";
import ScheduleForm from "../components/ScheduleForm";

interface ScheduleListPageState {
    schedules: ScheduleItem[];
    loading: boolean;
    error: string | null;
    actionPending: boolean;
    editingSchedule: ScheduleItem | null;
    formLoading: boolean;
}

interface ScheduleListPageProps {
    onBack?: () => void;
}

// Legacy schedules may have no detail page, so the list retains an edit-only
// recovery path. New schedules are still created from a summary detail page.
export default class ScheduleListPage extends Component<ScheduleListPageProps, ScheduleListPageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: ScheduleListPageState = {
        schedules: [],
        loading: false,
        error: null,
        actionPending: false,
        editingSchedule: null,
        formLoading: false,
    };
    // React state drives disabled controls; this synchronous flag closes the
    // gap before setState is committed and prevents duplicate API requests.
    private actionPending = false;

    handleScheduleAction = async (scheduleId: number, action: "pause" | "resume" | "delete") => {
        const item = this.state.schedules.find(schedule => schedule.schedule_id === scheduleId);
        if (this.actionPending || !item ||
            (action === "pause" && !item.is_active) ||
            (action === "resume" && item.is_active)) return;
        this.actionPending = true;
        this.setState({ actionPending: true });
        try {
            if (action === "pause" || action === "resume") {
                const nextActive = action === "resume";
                await api.toggleSchedule(scheduleId, nextActive);
                this.setState(state => ({
                    schedules: state.schedules.map(schedule => schedule.schedule_id === scheduleId
                        ? { ...schedule, is_active: nextActive } : schedule),
                }));
                Toast.success(t(nextActive ? "summary.schedule.resumed" : "summary.schedule.paused"));
            } else {
                await api.deleteSchedule(scheduleId);
                this.setState(state => ({
                    schedules: state.schedules.filter(schedule => schedule.schedule_id !== scheduleId),
                }));
                Toast.success(t("summary.schedule.deleted"));
            }
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        } finally {
            this.actionPending = false;
            this.setState({ actionPending: false });
        }
    };

    componentDidMount() {
        this.loadData();
    }

    async loadData() {
        this.setState({ loading: true, error: null });
        try {
            const schedules = await api.listSchedules();
            this.setState({ schedules, loading: false });
        } catch (err: any) {
            this.setState({ error: err.message || t("summary.common.loadingFailed"), loading: false });
        }
    }

    handleUpdate = async (params: CreateScheduleParams) => {
        const { editingSchedule } = this.state;
        if (!editingSchedule || this.actionPending) return;
        this.actionPending = true;
        this.setState({ actionPending: true, formLoading: true });
        try {
            const isMultiPerson = (editingSchedule.participants?.length ?? 0) > 1;
            // V5/§4.2/§6.1：编辑已有 schedule 时透传 confirm_policy，对齐后端。
            // 「多人」数据源是 editingSchedule.participants（后端透出的参与人名单）：
            // 多人则保留/透传已有值、缺省按 1；单人不传，走后端兜底。
            const updateParams: UpdateScheduleParams = {
                title: params.title,
                summary_mode: params.summary_mode,
                cron_expr: params.cron_expr,
                interval_days: params.interval_days ?? 0,
                interval_months: params.interval_months ?? 0,
                day_of_week: params.day_of_week ?? 0,
                day_of_month: params.day_of_month ?? 0,
                run_time: params.run_time ?? "",
                time_range_type: params.time_range_type,
                sources: params.sources,
                ...(isMultiPerson
                    ? { confirm_policy: editingSchedule.confirm_policy ?? 1 }
                    : {}),
            };
            await api.updateSchedule(editingSchedule.schedule_id, updateParams);
            this.setState({ editingSchedule: null });
            // The update payload intentionally omits source_name. Refetch so
            // cards and the next edit use the authoritative labels resolved by
            // the service instead of falling back to raw source IDs.
            await this.loadData();
            Toast.success(t("summary.schedule.updateSuccess"));
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.updateFailed"));
        } finally {
            this.actionPending = false;
            this.setState({ actionPending: false, formLoading: false });
        }
    };

    handleBack = () => {
        if (this.props.onBack) {
            this.props.onBack();
            return;
        }
        WKApp.routeLeft.popToRoot();
    };

    render() {
        const { schedules, loading, error, actionPending, editingSchedule, formLoading } = this.state;
        const { t: translate } = this.context;
        return (
            <div className="summary-schedule-page">
                <div className="summary-schedule-header" data-desktop-chrome="header">
                    <WKButton icon={<IconArrowLeft />} variant="ghost" onClick={this.handleBack}
                        aria-label={translate("summary.chatSummary.back")} />
                    <h2>{translate("summary.schedule.pageTitle")}</h2>
                </div>
                <Banner type="info" closeIcon={null} description={translate("summary.generation.scheduleDetailOnly")} />
                {loading && <Spin />}
                {error && (
                    <Banner type="danger" closeIcon={null} description={error}>
                        <WKButton size="sm" variant="ghost" onClick={() => this.loadData()}>
                            {translate("summary.common.retry")}
                        </WKButton>
                    </Banner>
                )}
                {!loading && !error && schedules.length === 0 && (
                    <div className="summary-schedule-empty">
                        {translate("summary.schedule.empty")}
                    </div>
                )}
                {!loading && !error && schedules.length > 0 && (
                    <div className="summary-schedule-list">
                        {schedules.map(item => (
                            <div key={item.schedule_id} className="summary-schedule-card">
                                <div className="summary-schedule-card-header">
                                    <span className="summary-schedule-card-title">
                                        {item.title || translate("summary.schedule.fallbackTitle", { values: { id: item.schedule_id } })}
                                    </span>
                                    <Tag>{translate(item.is_active ? "summary.schedule.enabled" : "summary.schedule.paused")}</Tag>
                                </div>
                                <div className="summary-schedule-card-meta">
                                    <Tag size="small" color="blue">{getModeLabel(item.summary_mode)}</Tag>
                                    <span>{describeSchedule(item.cron_expr, item.interval_days, item.interval_months,
                                        item.run_time, item.day_of_week, item.day_of_month)}</span>
                                    <span>{getTimeRangeTypeLabel(item.time_range_type)}</span>
                                </div>
                                <div className="summary-schedule-card-sources">
                                    {translate("summary.source.label")}
                                    {(item.sources ?? []).map(s => s.source_name || s.source_id).join("、") || "-"}
                                </div>
                                <div className="summary-schedule-card-actions">
                                    <WKButton icon={<Pencil size={16} />} iconOnly size="sm" variant="ghost"
                                        title={translate("summary.schedule.editModalTitle")}
                                        aria-label={translate("summary.schedule.editModalTitle")}
                                        disabled={actionPending}
                                        onClick={() => this.setState({ editingSchedule: item })} />
                                    {item.is_active
                                        ? <WKButton icon={<Pause size={16} />} iconOnly size="sm" variant="ghost"
                                            title={translate("summary.schedule.pause")} aria-label={translate("summary.schedule.pause")}
                                            disabled={actionPending} onClick={() => this.handleScheduleAction(item.schedule_id, "pause")} />
                                        : <WKButton icon={<Play size={16} />} iconOnly size="sm" variant="ghost"
                                            title={translate("summary.schedule.resume")} aria-label={translate("summary.schedule.resume")}
                                            disabled={actionPending} onClick={() => this.handleScheduleAction(item.schedule_id, "resume")} />}
                                    <Popconfirm title={translate("summary.schedule.deleteTitle")}
                                        content={translate("summary.schedule.deleteContent")}
                                        onConfirm={() => this.handleScheduleAction(item.schedule_id, "delete")}>
                                        {/* WKButton 不持有 ref，Semi Popconfirm 依赖 trigger child 的 ref
                                            定位弹层；包一层真实 DOM 防止确认框失去锚点。 */}
                                        <span style={{ display: "inline-block" }}>
                                            <WKButton icon={<Trash2 size={16} />} iconOnly size="sm" variant="danger"
                                                title={translate("summary.common.delete")} aria-label={translate("summary.common.delete")}
                                                disabled={actionPending} />
                                        </span>
                                    </Popconfirm>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                <Modal
                    title={translate("summary.schedule.editModalTitle")}
                    visible={editingSchedule !== null}
                    onCancel={() => this.setState({ editingSchedule: null })}
                    footer={null}
                    width={520}
                >
                    {editingSchedule && (
                        <>
                            {scheduleItemToConfig(editingSchedule).legacyCron && (
                                <Banner
                                    type="warning"
                                    fullMode={false}
                                    closeIcon={null}
                                    description={translate("summary.schedule.config.legacyCronWarning")}
                                />
                            )}
                            <ScheduleForm
                                initialValues={{
                                    title: editingSchedule.title,
                                    summary_mode: editingSchedule.summary_mode,
                                    cron_expr: editingSchedule.cron_expr,
                                    interval_days: editingSchedule.interval_days ?? 0,
                                    interval_months: editingSchedule.interval_months ?? 0,
                                    day_of_week: editingSchedule.day_of_week ?? 0,
                                    day_of_month: editingSchedule.day_of_month ?? 0,
                                    run_time: editingSchedule.run_time ?? "",
                                    time_range_type: editingSchedule.time_range_type,
                                    sources: editingSchedule.sources ?? [],
                                }}
                                onSubmit={this.handleUpdate}
                                onCancel={() => this.setState({ editingSchedule: null })}
                                loading={formLoading}
                            />
                        </>
                    )}
                </Modal>
            </div>
        );
    }
}
