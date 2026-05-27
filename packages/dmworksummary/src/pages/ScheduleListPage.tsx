import React, { Component } from "react";
import {
    Button,
    Spin,
    Toast,
    Modal,
    Switch,
    Popconfirm,
    Tag,
    Banner,
} from "@douyinfe/semi-ui";
import {
    IconArrowLeft,
    IconPlus,
    IconDelete,
    IconEdit,
} from "@douyinfe/semi-icons";
import { I18nContext, t } from "@octo/base";
import WKApp from "@octo/base/src/App";
import * as api from "../api/summaryApi";
import type {
    ScheduleItem,
    CreateScheduleParams,
    UpdateScheduleParams,
} from "../types/summary";
import {
    getModeLabel,
    describeCron,
    getTimeRangeTypeLabel,
} from "../utils/summaryHelpers";
import ScheduleForm from "../components/ScheduleForm";

interface ScheduleListPageState {
    schedules: ScheduleItem[];
    loading: boolean;
    error: string | null;
    showCreateModal: boolean;
    showEditModal: boolean;
    editingSchedule: ScheduleItem | null;
    formLoading: boolean;
}

export default class ScheduleListPage extends Component<{}, ScheduleListPageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: ScheduleListPageState = {
        schedules: [],
        loading: false,
        error: null,
        showCreateModal: false,
        showEditModal: false,
        editingSchedule: null,
        formLoading: false,
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
        WKApp.routeLeft.popToRoot();
    };

    handleCreate = async (params: CreateScheduleParams) => {
        this.setState({ formLoading: true });
        try {
            await api.createSchedule(params);
            Toast.success(t("summary.schedule.createSuccess"));
            this.setState({ showCreateModal: false, formLoading: false });
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.createFailed"));
            this.setState({ formLoading: false });
        }
    };

    handleUpdate = async (params: CreateScheduleParams) => {
        const { editingSchedule } = this.state;
        if (!editingSchedule) return;
        this.setState({ formLoading: true });
        try {
            const updateParams: UpdateScheduleParams = {
                title: params.title,
                summary_mode: params.summary_mode,
                cron_expr: params.cron_expr,
                time_range_type: params.time_range_type,
                sources: params.sources,
            };
            await api.updateSchedule(editingSchedule.schedule_id, updateParams);
            Toast.success(t("summary.schedule.updateSuccess"));
            this.setState({ showEditModal: false, editingSchedule: null, formLoading: false });
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.updateFailed"));
            this.setState({ formLoading: false });
        }
    };

    handleDelete = async (id: number) => {
        try {
            await api.deleteSchedule(id);
            Toast.success(t("summary.schedule.deleted"));
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.deleteFailed"));
        }
    };

    handleToggle = async (id: number, isActive: boolean) => {
        try {
            await api.toggleSchedule(id, isActive);
            Toast.success(isActive ? t("summary.schedule.enabled") : t("summary.schedule.paused"));
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    render() {
        const { schedules, loading, error, showCreateModal, showEditModal, editingSchedule, formLoading } = this.state;
        const { t: translate } = this.context;

        return (
            <div className="summary-schedule-page">
                <div className="summary-schedule-header">
                    <Button icon={<IconArrowLeft />} theme="borderless" onClick={this.handleBack} />
                    <h2>{translate("summary.schedule.pageTitle")}</h2>
                    <Button
                        icon={<IconPlus />}
                        theme="solid"
                        onClick={() => this.setState({ showCreateModal: true })}
                    >
                        {translate("summary.schedule.new")}
                    </Button>
                </div>

                {error && (
                    <Banner
                        type="warning"
                        description={error}
                        closeIcon={null}
                        style={{ marginBottom: 16 }}
                        fullMode={false}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span>{translate("summary.common.loadingFailed")}</span>
                            <Button size="small" onClick={() => this.loadData()}>{translate("summary.common.retry")}</Button>
                        </div>
                    </Banner>
                )}

                {loading && (
                    <div className="summary-schedule-loading">
                        <Spin size="large" />
                    </div>
                )}

                {!loading && schedules.length === 0 && !error && (
                    <div className="summary-schedule-empty">
                        <p>{translate("summary.schedule.empty")}</p>
                        <Button theme="solid" onClick={() => this.setState({ showCreateModal: true })}>
                            {translate("summary.schedule.createFirst")}
                        </Button>
                    </div>
                )}

                {!loading && schedules.length > 0 && (
                    <div className="summary-schedule-list">
                        {schedules.map((item) => (
                            <div key={item.schedule_id} className="summary-schedule-card">
                                <div className="summary-schedule-card-header">
                                    <span className="summary-schedule-card-title">
                                        {item.title || translate("summary.schedule.fallbackTitle", { values: { id: item.schedule_id } })}
                                    </span>
                                    <Switch
                                        checked={item.is_active}
                                        onChange={(checked) => this.handleToggle(item.schedule_id, checked)}
                                        size="small"
                                    />
                                </div>
                                <div className="summary-schedule-card-meta">
                                    <Tag size="small" color="blue">{getModeLabel(item.summary_mode)}</Tag>
                                    <span style={{ marginLeft: 8 }}>{describeCron(item.cron_expr)}</span>
                                    <span style={{ marginLeft: 8, color: "var(--semi-color-text-2)" }}>
                                        {getTimeRangeTypeLabel(item.time_range_type)}
                                    </span>
                                </div>
                                <div className="summary-schedule-card-sources">
                                    {translate("summary.source.label")}{item.sources.map((s) => s.source_name || s.source_id).join("、") || "-"}
                                </div>
                                <div className="summary-schedule-card-actions">
                                    <Button
                                        icon={<IconEdit />}
                                        size="small"
                                        theme="borderless"
                                        onClick={() => this.setState({
                                            showEditModal: true,
                                            editingSchedule: item,
                                        })}
                                    />
                                    <Popconfirm
                                        title={translate("summary.schedule.deleteTitle")}
                                        content={translate("summary.schedule.deleteContent")}
                                        onConfirm={() => this.handleDelete(item.schedule_id)}
                                    >
                                        <Button
                                            icon={<IconDelete />}
                                            size="small"
                                            theme="borderless"
                                            type="danger"
                                        />
                                    </Popconfirm>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <Modal
                    title={translate("summary.schedule.createModalTitle")}
                    visible={showCreateModal}
                    onCancel={() => this.setState({ showCreateModal: false })}
                    footer={null}
                    width={520}
                >
                    <ScheduleForm
                        onSubmit={this.handleCreate}
                        onCancel={() => this.setState({ showCreateModal: false })}
                        loading={formLoading}
                    />
                </Modal>

                <Modal
                    title={translate("summary.schedule.editModalTitle")}
                    visible={showEditModal}
                    onCancel={() => this.setState({ showEditModal: false, editingSchedule: null })}
                    footer={null}
                    width={520}
                >
                    {editingSchedule && (
                        <ScheduleForm
                            initialValues={{
                                title: editingSchedule.title,
                                summary_mode: editingSchedule.summary_mode,
                                cron_expr: editingSchedule.cron_expr,
                                time_range_type: editingSchedule.time_range_type,
                                sources: editingSchedule.sources,
                            }}
                            onSubmit={this.handleUpdate}
                            onCancel={() => this.setState({ showEditModal: false, editingSchedule: null })}
                            loading={formLoading}
                        />
                    )}
                </Modal>
            </div>
        );
    }
}
