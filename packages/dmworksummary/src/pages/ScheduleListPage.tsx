import React, { Component } from "react";
import { Spin, Tag, Banner } from "@douyinfe/semi-ui";
import { IconArrowLeft } from "@douyinfe/semi-icons";
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
}

interface ScheduleListPageProps {
    onBack?: () => void;
}

// Legacy routes remain readable, but configuration has one owner: the summary
// detail page. Do not reintroduce standalone create/edit/source-selection forms.
export default class ScheduleListPage extends Component<ScheduleListPageProps, ScheduleListPageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: ScheduleListPageState = { schedules: [], loading: false, error: null };

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
        const { schedules, loading, error } = this.state;
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
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }
}
