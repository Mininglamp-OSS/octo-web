import React, { Component } from "react";
import { Modal, Select, Button, InputNumber, Toast, Banner } from "@douyinfe/semi-ui";
import { I18nContext } from "@octo/base";
import type { ScheduleConfig, ScheduleUnit } from "../types/summary";
import { validateScheduleConfig } from "../utils/summaryHelpers";

interface Props {
    visible: boolean;
    value: ScheduleConfig;
    onConfirm: (config: ScheduleConfig) => void;
    onCancel: () => void;
    /** 是否已存在（且启用的）定时：为 true 时 footer 左侧展示「关闭定时」按钮 */
    hasExisting?: boolean;
    /** 点击「关闭定时」的回调（停用，可恢复） */
    onDisable?: () => void;
    /** 「关闭定时」请求中的 loading 态 */
    disabling?: boolean;
    /** 是否展示定时生成要求；创建新定时任务入口不展示，已有结果的定时设置展示 */
    showGenerationInstruction?: boolean;
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

const DEFAULT_CONFIG: ScheduleConfig = { unit: "week", every: 1, time: "09:00" };

// 周几选项：value 1..7 对齐后端（1=周一 .. 7=周日）
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export default class ScheduleConfigModal extends Component<Props, State> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: State = {
        local: { ...DEFAULT_CONFIG },
    };

    componentDidUpdate(prevProps: Props) {
        if (this.props.visible && !prevProps.visible) {
            this.setState({ local: { ...DEFAULT_CONFIG, ...this.props.value } });
        }
    }

    handleConfirm = () => {
        const { t } = this.context;
        const err = validateScheduleConfig(this.state.local);
        if (err) {
            Toast.error(err);
            return;
        }
        // 收敛为正整数后再提交
        const local = { ...this.state.local, every: Math.max(1, Math.floor(this.state.local.every || 1)) };
        this.props.onConfirm(local);
    };

    updateLocal(patch: Partial<ScheduleConfig>) {
        // 非阻塞1：一旦用户主动改动周期相关字段，清掉 legacyCron 标记
        //（表明这是用户有意的新间隔设置，不再属于「遗留 cron 被误改」）。
        const touchesPeriod =
            "every" in patch || "unit" in patch || "dayOfWeek" in patch || "dayOfMonth" in patch;
        const next = { ...this.state.local, ...patch };
        if (touchesPeriod && next.legacyCron) {
            delete next.legacyCron;
        }
        this.setState({ local: next });
    }

    render() {
        const { visible, onCancel, showGenerationInstruction = true } = this.props;
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

        const inlineStyle: React.CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            flexWrap: "wrap",
        };

        const prefixStyle: React.CSSProperties = {
            whiteSpace: "nowrap",
            color: "var(--semi-color-text-2)",
            fontSize: 14,
        };

        const unitOptions: { value: ScheduleUnit; label: string }[] = [
            { value: "day", label: t("summary.schedule.config.unitDay") },
            { value: "week", label: t("summary.schedule.config.unitWeek") },
            { value: "month", label: t("summary.schedule.config.unitMonth") },
        ];

        // 周几下拉选项：周一..周日，value 1..7
        const weekdayOptions = WEEKDAY_KEYS.map((key, idx) => ({
            value: idx + 1,
            label: t(`summary.schedule.config.weekday.${key}`),
        }));
        // 几号下拉选项：1..31 号
        const dayOfMonthOptions = Array.from({ length: 31 }, (_, i) => ({
            value: i + 1,
            label: t("summary.schedule.config.dayOfMonthLabel", { values: { day: i + 1 } }),
        }));
        const isWeekMode = local.unit === "week";
        const isMonthMode = local.unit === "month";

        return (
            <Modal
                title={t("summary.schedule.config.title")}
                visible={visible}
                onCancel={onCancel}
                width={460}
                footer={
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <div>
                            {this.props.hasExisting && this.props.onDisable && (
                                <Button
                                    type="danger"
                                    theme="borderless"
                                    loading={this.props.disabling}
                                    disabled={this.props.disabling}
                                    onClick={this.props.onDisable}
                                >
                                    {t("summary.detail.disableSchedule")}
                                </Button>
                            )}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <Button onClick={onCancel}>{t("summary.common.cancel")}</Button>
                            <Button theme="solid" onClick={this.handleConfirm}>{t("summary.common.save")}</Button>
                        </div>
                    </div>
                }
            >
                <div style={{ color: "var(--semi-color-text-2)", fontSize: 13, marginBottom: 20 }}>
                    {t("summary.schedule.config.desc")}
                </div>

                {/* 非阻塞1：遗留 cron 定时打开时明确提示保存会转为间隔模式，避免静默误改 */}
                {local.legacyCron && (
                    <Banner
                        type="warning"
                        closeIcon={null}
                        description={t("summary.schedule.config.legacyCronWarning")}
                        style={{ marginBottom: 16 }}
                    />
                )}

                {/* 频率：每 [N] [天/周/月] */}
                <div style={rowStyle}>
                    <span style={labelStyle}>{t("summary.schedule.config.frequency")}</span>
                    <div style={inlineStyle}>
                        <span style={prefixStyle}>{t("summary.schedule.config.everyPrefix")}</span>
                        <InputNumber
                            min={1}
                            max={9999}
                            precision={0}
                            value={local.every}
                            onChange={(v) => this.updateLocal({ every: typeof v === "number" ? v : 1 })}
                            style={{ width: 96 }}
                        />
                        <Select
                            value={local.unit}
                            onChange={(v) => this.updateLocal({ unit: v as ScheduleUnit })}
                            style={{ width: 110 }}
                            optionList={unitOptions}
                        />
                    </div>
                </div>

                {/* 周模式：周几下拉；月模式：几号下拉。均置于时间（run_time）选择之前 */}
                {isWeekMode && (
                    <div style={rowStyle}>
                        <span style={labelStyle}>{t("summary.schedule.config.weekdayLabel")}</span>
                        <div style={inlineStyle}>
                            <Select
                                value={local.dayOfWeek || undefined}
                                onChange={(v) => this.updateLocal({ dayOfWeek: typeof v === "number" ? v : 0 })}
                                style={{ flex: 1, minWidth: 120 }}
                                placeholder={t("summary.schedule.config.weekdayPlaceholder")}
                                optionList={weekdayOptions}
                            />
                        </div>
                    </div>
                )}
                {isMonthMode && (
                    <div style={rowStyle}>
                        <span style={labelStyle}>{t("summary.schedule.config.dayOfMonthFieldLabel")}</span>
                        <div style={inlineStyle}>
                            <Select
                                value={local.dayOfMonth || undefined}
                                onChange={(v) => this.updateLocal({ dayOfMonth: typeof v === "number" ? v : 0 })}
                                style={{ flex: 1, minWidth: 120 }}
                                placeholder={t("summary.schedule.config.dayOfMonthPlaceholder")}
                                optionList={dayOfMonthOptions}
                            />
                        </div>
                    </div>
                )}
                {isMonthMode && (
                    <div style={{ color: "var(--semi-color-text-2)", fontSize: 12, marginTop: -8, marginBottom: 16, marginLeft: 88 }}>
                        {t("summary.schedule.config.dayOfMonthHint")}
                    </div>
                )}

                {/* 时间：在 HH:MM 跑 */}
                <div style={rowStyle}>
                    <span style={labelStyle}>{t("summary.schedule.config.time")}</span>
                    <div style={inlineStyle}>
                        <span style={prefixStyle}>{t("summary.schedule.config.atPrefix")}</span>
                        <Select
                            value={local.time}
                            onChange={(v) => this.updateLocal({ time: v as string })}
                            style={{ flex: 1, minWidth: 120 }}
                            optionList={timeOptions}
                        />
                    </div>
                </div>

                {showGenerationInstruction && (
                    <div style={{ ...rowStyle, alignItems: "flex-start", marginBottom: 0 }}>
                        <span style={{ ...labelStyle, paddingTop: 8 }}>{t("summary.detail.scheduleInstructionTitle")}</span>
                        <div style={{ flex: 1 }}>
                            <textarea
                                className="summary-schedule-config-instruction-textarea"
                                value={local.generationInstruction || ""}
                                maxLength={8000}
                                placeholder={t("summary.detail.scheduleInstructionPlaceholder")}
                                onChange={(e) => this.updateLocal({ generationInstruction: e.target.value.slice(0, 8000) })}
                            />
                            <div className="summary-schedule-config-instruction-hint">
                                {t("summary.detail.scheduleInstructionModalDesc")}
                            </div>
                        </div>
                    </div>
                )}
            </Modal>
        );
    }
}
