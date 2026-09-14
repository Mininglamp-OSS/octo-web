import React, { Component } from "react";
import { Spin, Tag, Banner, Popconfirm, Toast } from "@douyinfe/semi-ui";
import { IconArrowLeft } from "@douyinfe/semi-icons";
import { Pause, Trash2 } from "lucide-react";
import { I18nContext, t, WKButton } from "@octo/base";
import WKApp from "@octo/base/src/App";
import * as api from "../api/summaryApi";
import type { ScheduleItem } from "../types/summary";
import {
    getModeLabel,
    describeSchedule,
    getTimeRangeTypeLabel,
} from "../utils/summaryHelpers";

interface ScheduleListPageState {
    schedules: ScheduleItem[];
    loading: boolean;
    error: string | null;
    actionPending: boolean;
}

interface ScheduleListPageProps {
    onBack?: () => void;
}

// Legacy schedules may have no detail page. Keep pause/delete recovery here,
// but configuration stays in the detail page: no standalone create/edit forms.
export default class ScheduleListPage extends Component<ScheduleListPageProps, ScheduleListPageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: ScheduleListPageState = { schedules: [], loading: false, error: null, actionPending: false };
    private actionPending = false;

    handleScheduleAction = async (scheduleId: number, action: "pause" | "delete") => {
        const item = this.state.schedules.find(schedule => schedule.schedule_id === scheduleId);
        if (this.actionPending || !item || (action === "pause" && !item.is_active)) return;
        this.actionPending = true;
        this.setState({ actionPending: true });
        try {
            if (action === "pause") {
                await api.toggleSchedule(scheduleId, false);
                this.setState(state => ({
                    schedules: state.schedules.map(schedule => schedule.schedule_id === scheduleId
                        ? { ...schedule, is_active: false } : schedule),
                }));
                Toast.success(t("summary.schedule.paused"));
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

    handleBack = () => {
        if (this.props.onBack) {
            this.props.onBack();
            return;
        }
        WKApp.routeLeft.popToRoot();
    };

    render() {
        const { schedules, loading, error, actionPending } = this.state;
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
                {error && <Banner type="danger" closeIcon={null} description={error} />}
                {!loading && !error && (
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
                                    {item.is_active && <WKButton icon={<Pause size={16} />} iconOnly size="sm" variant="ghost"
                                        title={translate("summary.schedule.pause")} aria-label={translate("summary.schedule.pause")}
                                        disabled={actionPending} onClick={() => this.handleScheduleAction(item.schedule_id, "pause")} />}
                                    <Popconfirm title={translate("summary.schedule.deleteTitle")}
                                        content={translate("summary.schedule.deleteContent")}
                                        onConfirm={() => this.handleScheduleAction(item.schedule_id, "delete")}>
                                        <WKButton icon={<Trash2 size={16} />} iconOnly size="sm" variant="danger"
                                            title={translate("summary.common.delete")} aria-label={translate("summary.common.delete")}
                                            disabled={actionPending} />
                                    </Popconfirm>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }
}
