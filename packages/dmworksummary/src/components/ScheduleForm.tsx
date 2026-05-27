import React, { useState, useCallback } from "react";
import { Button, Select, Input } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import { SummaryMode } from "../types/summary";
import type {
    CreateScheduleParams,
    SourceItem,
    SummaryModeType,
} from "../types/summary";
import { getCronPresetOptions, getTimeRangeTypeOptions } from "../utils/summaryHelpers";
import SourceSelector from "./SourceSelector";

interface ScheduleFormProps {
    initialValues?: Partial<CreateScheduleParams>;
    onSubmit: (values: CreateScheduleParams) => void;
    onCancel?: () => void;
    loading?: boolean;
}

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
    const [cronExpr, setCronExpr] = useState(initialValues?.cron_expr || "0 9 * * 1");
    const [customCron, setCustomCron] = useState("");
    const [useCustomCron, setUseCustomCron] = useState(false);
    const [timeRangeType, setTimeRangeType] = useState<1 | 2 | 3 | 4>(
        initialValues?.time_range_type || 2,
    );
    const [sources, setSources] = useState<SourceItem[]>(initialValues?.sources || []);
    const cronPresets = getCronPresetOptions();
    const timeRangeTypeOptions = getTimeRangeTypeOptions();

    const handleSubmit = useCallback(() => {
        const finalCron = useCustomCron ? customCron : cronExpr;
        if (!finalCron.trim()) return;
        if (sources.length === 0) return;

        onSubmit({
            title: title.trim(),
            summary_mode: summaryMode,
            cron_expr: finalCron.trim(),
            time_range_type: timeRangeType,
            sources,
        });
    }, [title, summaryMode, cronExpr, customCron, useCustomCron, timeRangeType, sources, onSubmit]);

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
                {!useCustomCron ? (
                    <div>
                        <Select value={cronExpr} onChange={(v) => setCronExpr(v as string)} style={{ width: "100%" }}>
                            {cronPresets.map((p) => (
                                <Select.Option key={p.value} value={p.value}>
                                    {p.label}
                                </Select.Option>
                            ))}
                        </Select>
                        <Button
                            size="small"
                            theme="borderless"
                            onClick={() => setUseCustomCron(true)}
                            style={{ marginTop: 4 }}
                        >
                            {t("summary.schedule.form.customCron")}
                        </Button>
                    </div>
                ) : (
                    <div>
                        <Input
                            value={customCron}
                            onChange={setCustomCron}
                            placeholder={t("summary.schedule.form.customCronPlaceholder")}
                        />
                        <Button
                            size="small"
                            theme="borderless"
                            onClick={() => setUseCustomCron(false)}
                            style={{ marginTop: 4 }}
                        >
                            {t("summary.schedule.form.usePreset")}
                        </Button>
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
