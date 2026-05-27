import React, { Component } from "react";
import { Modal, Select, Button } from "@douyinfe/semi-ui";
import { I18nContext } from "@octo/base";
import type { ScheduleConfig } from "../types/summary";
import { getDayOfMonthLabel, getWeekdayName } from "../utils/summaryHelpers";

interface Props {
    visible: boolean;
    value: ScheduleConfig;
    onConfirm: (config: ScheduleConfig) => void;
    onCancel: () => void;
}

interface State {
    local: ScheduleConfig;
}

const timeOptions = Array.from({ length: 48 }, (_, i) => {
    const h = Math.floor(i / 2);
    const m = i % 2 === 0 ? "00" : "30";
    const val = `${String(h).padStart(2, "0")}:${m}`;
    return { value: val, label: val };
});

const weekDayValues = [1, 2, 3, 4, 5, 6, 7];

const dayOfMonthValues = Array.from({ length: 28 }, (_, i) => i + 1);

export default class ScheduleConfigModal extends Component<Props, State> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: State = {
        local: { period: "daily", time: "09:00" },
    };

    componentDidUpdate(prevProps: Props) {
        if (this.props.visible && !prevProps.visible) {
            this.setState({ local: { ...this.props.value } });
        }
    }

    handleConfirm = () => {
        this.props.onConfirm(this.state.local);
    };

    updateLocal(patch: Partial<ScheduleConfig>) {
        this.setState({ local: { ...this.state.local, ...patch } });
    }

    handlePeriodChange = (v: string | number | any[] | Record<string, any>) => {
        const period = v as ScheduleConfig["period"];
        const next: ScheduleConfig = { period, time: this.state.local.time };
        if (period === "weekly") {
            next.dayOfWeek = this.state.local.dayOfWeek ?? 1;
        } else if (period === "monthly") {
            next.dayOfMonth = this.state.local.dayOfMonth ?? 1;
        }
        this.setState({ local: next });
    };

    renderTimeRow() {
        const { local } = this.state;
        const { t } = this.context;
        const weekDayOptions = weekDayValues.map((value) => ({
            value,
            label: getWeekdayName(value),
        }));
        const dayOfMonthOptions = dayOfMonthValues.map((value) => ({
            value,
            label: getDayOfMonthLabel(value),
        }));

        const rowStyle: React.CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
        };

        const prefixStyle: React.CSSProperties = {
            whiteSpace: "nowrap",
            color: "var(--semi-color-text-2)",
            fontSize: 14,
        };

        if (local.period === "daily") {
            return (
                <div style={rowStyle}>
                    <span style={prefixStyle}>{t("summary.cron.everyDay")}</span>
                    <Select
                        value={local.time}
                        onChange={(v) => this.updateLocal({ time: v as string })}
                        style={{ flex: 1 }}
                        optionList={timeOptions}
                    />
                </div>
            );
        }

        if (local.period === "weekly") {
            return (
                <div style={rowStyle}>
                    <span style={prefixStyle}>{t("summary.cron.everyWeek")}</span>
                    <Select
                        value={local.dayOfWeek ?? 1}
                        onChange={(v) => this.updateLocal({ dayOfWeek: v as number })}
                        style={{ flex: 1 }}
                        optionList={weekDayOptions}
                    />
                    <Select
                        value={local.time}
                        onChange={(v) => this.updateLocal({ time: v as string })}
                        style={{ flex: 1 }}
                        optionList={timeOptions}
                    />
                </div>
            );
        }

        // monthly
        return (
            <div style={rowStyle}>
                <span style={prefixStyle}>{t("summary.cron.everyMonth")}</span>
                <Select
                    value={local.dayOfMonth ?? 1}
                    onChange={(v) => this.updateLocal({ dayOfMonth: v as number })}
                    style={{ flex: 1 }}
                    optionList={dayOfMonthOptions}
                />
                <Select
                    value={local.time}
                    onChange={(v) => this.updateLocal({ time: v as string })}
                    style={{ flex: 1 }}
                    optionList={timeOptions}
                />
            </div>
        );
    }

    render() {
        const { visible, onCancel } = this.props;
        const { local } = this.state;
        const { t } = this.context;

        const labelStyle: React.CSSProperties = {
            width: 88,
            flexShrink: 0,
            color: "var(--semi-color-text-1)",
            fontSize: 14,
        };

        const rowStyle: React.CSSProperties = {
            display: "flex",
            alignItems: "center",
            marginBottom: 16,
        };

        return (
            <Modal
                title={t("summary.schedule.config.title")}
                visible={visible}
                onCancel={onCancel}
                width={420}
                footer={
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        <Button onClick={onCancel}>{t("summary.common.cancel")}</Button>
                        <Button theme="solid" onClick={this.handleConfirm}>{t("summary.common.save")}</Button>
                    </div>
                }
            >
                <div style={{ color: "var(--semi-color-text-2)", fontSize: 13, marginBottom: 20 }}>
                    {t("summary.schedule.config.desc")}
                </div>

                {/* 频率 */}
                <div style={rowStyle}>
                    <span style={labelStyle}>{t("summary.schedule.config.frequency")}</span>
                    <Select
                        value={local.period}
                        onChange={this.handlePeriodChange}
                        style={{ flex: 1 }}
                        optionList={[
                            { value: "daily", label: t("summary.schedule.config.daily") },
                            { value: "weekly", label: t("summary.schedule.config.weekly") },
                            { value: "monthly", label: t("summary.schedule.config.monthly") },
                        ]}
                    />
                </div>

                {/* 时间 */}
                <div style={{ ...rowStyle, marginBottom: 0 }}>
                    <span style={labelStyle}>{t("summary.schedule.config.time")}</span>
                    {this.renderTimeRow()}
                </div>
            </Modal>
        );
    }
}
