import React, { useState, useCallback } from "react";
import { Button, Select, Input, InputNumber } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import { SummaryMode } from "../types/summary";
import type {
    CreateScheduleParams,
    SourceItem,
    SummaryModeType,
    ScheduleUnit,
} from "../types/summary";
import {
    getTimeRangeTypeOptions,
    scheduleToParams,
    scheduleItemToConfig,
    validateScheduleConfig,
} from "../utils/summaryHelpers";
import SourceSelector from "./SourceSelector";

interface ScheduleFormProps {
    initialValues?: Partial<CreateScheduleParams>;
    onSubmit: (values: CreateScheduleParams) => void;
    onCancel?: () => void;
    loading?: boolean;
}

const timeOptions = Array.from({ length: 48 }, (_, i) => {
    const h = Math.floor(i / 2);
    const m = i % 2 === 0 ? "00" : "30";
    const val = `${String(h).padStart(2, "0")}:${m}`;
    return { value: val, label: val };
});

// 周几选项：value 1..7 对齐后端（1=周一 .. 7=周日）
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const ScheduleForm: React.FC<ScheduleFormProps> = ({
    initialValues,
    onSubmit,
    onCancel,
    loading,
}) => {
    const { t } = useI18n();
    const [title, setTitle] = useState(initialValues?.title || "");
    const [summaryMode, setSummaryMode] = useState<SummaryModeType>(
        initialValues?.summary_mode || SummaryMode.BY_GROUP,
    );

    // 通用「数量 × 单位 + 时间」配置；从既有值回填（interval 优先，cron 降级）
    const initialConfig = scheduleItemToConfig({
        cron_expr: initialValues?.cron_expr || "",
        interval_days: initialValues?.interval_days,
        interval_months: initialValues?.interval_months,
        run_time: initialValues?.run_time,
    });
    const [every, setEvery] = useState<number>(initialConfig.every);
    const [unit, setUnit] = useState<ScheduleUnit>(initialConfig.unit);
    const [runTime, setRunTime] = useState<string>(initialConfig.time);
    // 周模式：周几（1..7，0=不限）；月模式：几号（1..31，0=不限）
    const [dayOfWeek, setDayOfWeek] = useState<number>(initialValues?.day_of_week || 0);
    const [dayOfMonth, setDayOfMonth] = useState<number>(initialValues?.day_of_month || 0);

    const [timeRangeType, setTimeRangeType] = useState<1 | 2 | 3 | 4>(
        initialValues?.time_range_type || 2,
    );
    const [sources, setSources] = useState<SourceItem[]>(initialValues?.sources || []);
    const [errMsg, setErrMsg] = useState<string | null>(null);
    const timeRangeTypeOptions = getTimeRangeTypeOptions();

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

    const isWeekMode = unit === "week";
    const isMonthMode = unit === "month";

    const handleSubmit = useCallback(() => {
        if (sources.length === 0) return;
        const config = { unit, every: Math.max(1, Math.floor(every || 1)), time: runTime };
        const verr = validateScheduleConfig(config);
        if (verr) {
            setErrMsg(verr);
            return;
        }
        setErrMsg(null);
        const { cron_expr, interval_days, interval_months, run_time } = scheduleToParams(config);

        // 根据当前模式决定提交哪个字段，另一个置 0（不限）
        const day_of_week = unit === "week" ? dayOfWeek || 0 : 0;
        const day_of_month = unit === "month" ? dayOfMonth || 0 : 0;

        // 强剥 source_name：与即时总结路一致，提交时不带 name，
        // 让后端按 source_id 现查 IM 库最新群名（带类型后缀）。
        // 这样定时管理 UI 也不会把原始 group_no/thread id 当名写进库。
        const cleanSources = sources.map(({ source_type, source_id }) => ({
            source_type,
            source_id,
        }));

        onSubmit({
            title: title.trim(),
            summary_mode: summaryMode,
            cron_expr,
            interval_days,
            interval_months,
            day_of_week,
            day_of_month,
            run_time,
            time_range_type: timeRangeType,
            sources: cleanSources,
        });
    }, [title, summaryMode, unit, every, runTime, dayOfWeek, dayOfMonth, timeRangeType, sources, onSubmit]);

    return (
        <div className="summary-schedule-form">
            <div className="summary-form-field">
                <label>{t("summary.schedule.form.title")}</label>
                <Input
                    value={title}
                    onChange={(val) => setTitle(val.slice(0, 1000))}
                    maxLength={1000}
                    placeholder={t("summary.schedule.form.titlePlaceholder")}
                />
                {title.length >= 1000 && (
                    <div style={{ color: "var(--semi-color-danger)", fontSize: 12, marginTop: 4 }}>
                        {t("summary.common.charLimitReached", { values: { count: 1000 } })}
                    </div>
                )}
            </div>

            <div className="summary-form-field">
                <label>{t("summary.schedule.form.mode")}</label>
                <Select value={summaryMode} onChange={(v) => setSummaryMode(v as SummaryModeType)}>
                    <Select.Option value={SummaryMode.BY_GROUP}>{t("summary.mode.byGroup")}</Select.Option>
                    <Select.Option value={SummaryMode.BY_PERSON}>{t("summary.mode.byPerson")}</Select.Option>
                </Select>
            </div>

            <div className="summary-form-field">
                <label>{t("summary.schedule.form.frequency")}</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--semi-color-text-2)", fontSize: 14 }}>
                        {t("summary.schedule.config.everyPrefix")}
                    </span>
                    <InputNumber
                        min={1}
                        max={9999}
                        precision={0}
                        value={every}
                        onChange={(v) => setEvery(typeof v === "number" ? v : 1)}
                        style={{ width: 96 }}
                    />
                    <Select
                        value={unit}
                        onChange={(v) => setUnit(v as ScheduleUnit)}
                        style={{ width: 110 }}
                        optionList={unitOptions}
                    />
                    {/* 周模式：周几下拉，置于时间（run_time）选择之前 */}
                    {isWeekMode && (
                        <>
                            <span style={{ color: "var(--semi-color-text-2)", fontSize: 14 }}>
                                {t("summary.schedule.config.onWeekdayPrefix")}
                            </span>
                            <Select
                                value={dayOfWeek || undefined}
                                onChange={(v) => setDayOfWeek(typeof v === "number" ? v : 0)}
                                style={{ width: 110 }}
                                placeholder={t("summary.schedule.config.weekdayPlaceholder")}
                                optionList={weekdayOptions}
                            />
                        </>
                    )}
                    {/* 月模式：几号下拉，置于时间（run_time）选择之前 */}
                    {isMonthMode && (
                        <>
                            <span style={{ color: "var(--semi-color-text-2)", fontSize: 14 }}>
                                {t("summary.schedule.config.onDayOfMonthPrefix")}
                            </span>
                            <Select
                                value={dayOfMonth || undefined}
                                onChange={(v) => setDayOfMonth(typeof v === "number" ? v : 0)}
                                style={{ width: 110 }}
                                placeholder={t("summary.schedule.config.dayOfMonthPlaceholder")}
                                optionList={dayOfMonthOptions}
                            />
                        </>
                    )}
                    <span style={{ color: "var(--semi-color-text-2)", fontSize: 14 }}>
                        {t("summary.schedule.config.atPrefix")}
                    </span>
                    <Select
                        value={runTime}
                        onChange={(v) => setRunTime(v as string)}
                        style={{ width: 120 }}
                        optionList={timeOptions}
                    />
                </div>
                {isMonthMode && (
                    <div style={{ color: "var(--semi-color-text-2)", fontSize: 12, marginTop: 4 }}>
                        {t("summary.schedule.config.dayOfMonthHint")}
                    </div>
                )}
                {errMsg && (
                    <div style={{ color: "var(--semi-color-danger)", fontSize: 12, marginTop: 4 }}>
                        {errMsg}
                    </div>
                )}
            </div>

            <div className="summary-form-field">
                <label>{t("summary.schedule.form.timeRange")}</label>
                <Select
                    value={timeRangeType}
                    onChange={(v) => setTimeRangeType(v as 1 | 2 | 3 | 4)}
                    style={{ width: "100%" }}
                >
                    {timeRangeTypeOptions.map((opt) => (
                        <Select.Option key={opt.value} value={opt.value}>
                            {opt.label}
                        </Select.Option>
                    ))}
                </Select>
            </div>

            <div className="summary-form-field">
                <label>{t("summary.schedule.form.source")}</label>
                <SourceSelector value={sources} onChange={setSources} />
            </div>

            <div className="summary-form-actions">
                {onCancel && (
                    <Button onClick={onCancel} style={{ marginRight: 8 }}>
                        {t("summary.common.cancel")}
                    </Button>
                )}
                <Button
                    theme="solid"
                    onClick={handleSubmit}
                    loading={loading}
                    disabled={sources.length === 0}
                >
                    {t("summary.common.save")}
                </Button>
            </div>
        </div>
    );
};

export default ScheduleForm;
