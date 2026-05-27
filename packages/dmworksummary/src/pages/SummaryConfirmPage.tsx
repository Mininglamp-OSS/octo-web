import React, { Component } from "react";
import {
    Button,
    Spin,
    Toast,
    Banner,
} from "@douyinfe/semi-ui";
import { IconArrowLeft } from "@douyinfe/semi-icons";
import { I18nContext, t } from "@octo/base";
import WKApp from "@octo/base/src/App";
import SummaryDetailPage from "./SummaryDetailPage";
import * as api from "../api/summaryApi";
import type { SummaryDetail, SourceItem, Participant } from "../types/summary";
import { TaskStatus } from "../types/summary";
import { formatDate } from "../utils/summaryHelpers";
import SourceSelector from "../components/SourceSelector";
import ConfirmParticipantList from "../components/ConfirmParticipantList";

interface SummaryConfirmPageProps {
    taskId?: number;
}

interface SummaryConfirmPageState {
    detail: SummaryDetail | null;
    participants: Participant[];
    selectedSources: SourceItem[];
    loading: boolean;
    submitting: boolean;
    error: string | null;
}

export default class SummaryConfirmPage extends Component<SummaryConfirmPageProps, SummaryConfirmPageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: SummaryConfirmPageState = {
        detail: null,
        participants: [],
        selectedSources: [],
        loading: false,
        submitting: false,
        error: null,
    };

    componentDidMount() {
        this.loadData();
    }

    get taskId(): number | null {
        return this.props.taskId ?? null;
    }

    async loadData() {
        if (this.taskId == null) return;
        this.setState({ loading: true, error: null });
        try {
            const [detail, participants] = await Promise.all([
                api.getSummaryDetail(this.taskId),
                api.getParticipants(this.taskId),
            ]);
            this.setState({
                detail,
                participants: participants || [],
                selectedSources: detail.sources.map((s) => ({ ...s })),
                loading: false,
            });
        } catch (err: any) {
            this.setState({ error: err.message || t("summary.common.loadingFailed"), loading: false });
        }
    }

    handleBack = () => {
        WKApp.routeLeft.push(<SummaryDetailPage taskId={this.taskId} />);
    };

    handleConfirm = async () => {
        if (this.taskId == null) return;
        const { selectedSources } = this.state;
        if (selectedSources.length === 0) {
            Toast.warning(t("summary.confirmPage.sourceRequired"));
            return;
        }
        this.setState({ submitting: true });
        try {
            await api.confirmParticipation(this.taskId, selectedSources);
            Toast.success(t("summary.confirmPage.confirmed"));
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.confirmPage.confirmFailed"));
        } finally {
            this.setState({ submitting: false });
        }
    };

    handleDecline = async () => {
        if (this.taskId == null) return;
        this.setState({ submitting: true });
        try {
            await api.declineParticipation(this.taskId);
            Toast.success(t("summary.confirmPage.declined"));
            WKApp.routeLeft.popToRoot();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        } finally {
            this.setState({ submitting: false });
        }
    };

    render() {
        const { detail, participants, selectedSources, loading, submitting, error } = this.state;
        const { t: translate } = this.context;

        return (
            <div className="summary-confirm-page">
                <div className="summary-confirm-header">
                    <Button icon={<IconArrowLeft />} theme="borderless" onClick={this.handleBack} />
                    <h2>{translate("summary.confirmPage.title")}</h2>
                </div>

                {loading && (
                    <div className="summary-confirm-loading">
                        <Spin size="large" />
                    </div>
                )}

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

                {detail && !loading && (
                    <div className="summary-confirm-body">
                        <div className="summary-confirm-invite">
                            <p>{translate("summary.confirmPage.inviteTitle")}</p>
                            <p className="summary-confirm-time">
                                {translate("summary.confirmPage.timeRange")}{formatDate(detail.time_range_start)} ~ {formatDate(detail.time_range_end)}
                            </p>
                        </div>

                        <div className="summary-confirm-sources">
                            <h4>{translate("summary.confirmPage.sourcePrompt")}</h4>
                            <SourceSelector
                                value={selectedSources}
                                onChange={(sources) => this.setState({ selectedSources: sources })}
                            />
                        </div>

                        <div className="summary-confirm-participants">
                            <h4>{translate("summary.participant.statusTitleWithColon")}</h4>
                            <ConfirmParticipantList participants={participants} />
                        </div>

                        {detail.status === TaskStatus.WAITING_CONFIRM && (
                            <div className="summary-confirm-actions">
                                <Button
                                    type="danger"
                                    theme="borderless"
                                    onClick={this.handleDecline}
                                    loading={submitting}
                                >
                                    {translate("summary.action.reject")}
                                </Button>
                                <Button
                                    theme="solid"
                                    onClick={this.handleConfirm}
                                    loading={submitting}
                                    disabled={selectedSources.length === 0}
                                    style={{ marginLeft: 8 }}
                                >
                                    {translate("summary.confirmPage.submit")}
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }
}
