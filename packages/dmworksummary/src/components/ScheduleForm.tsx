import React, { useState, useCallback } from "react";
import { Button, Select, Input } from "@douyinfe/semi-ui";
import { SummaryMode, TimeRangeTypeLabels } from "../types/summary";
import type {
    CreateScheduleParams,
    SourceItem,
    SummaryModeType,
} from "../types/summary";
import { CRON_PRESETS } from "../utils/summaryHelpers";
import SourceSelector from "./SourceSelector";

interface ScheduleFormProps {
    initialValues?: Partial<CreateScheduleParams>;
    onSubmit: (values: CreateScheduleParams) => void;
    onCancel?: () => void;
    loading?: boolean;
}

const timeRangeTypeOptions = Object.entries(TimeRangeTypeLabels).map(([k, v]) => ({
    value: Number(k),
    label: v,
}));

const ScheduleForm: React.FC<ScheduleFormProps> = ({
    initialValues,
    onSubmit,
    onCancel,
    loading,
}) => {
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
                <label>标题</label>
                <Input
                    value={title}
                    onChange={(val) => setTitle(val.slice(0, 1000))}
                    maxLength={1000}
                    placeholder="定时总结标题"
                />
                {title.length >= 1000 && (
                    <div style={{ color: "var(--semi-color-danger)", fontSize: 12, marginTop: 4 }}>
                        已达到 1000 字符上限
                    </div>
                )}
            </div>

            <div className="summary-form-field">
                <label>总结模式</label>
                <Select value={summaryMode} onChange={(v) => setSummaryMode(v as SummaryModeType)}>
                    <Select.Option value={SummaryMode.BY_GROUP}>按群总结</Select.Option>
                    <Select.Option value={SummaryMode.BY_PERSON}>按人总结</Select.Option>
                </Select>
            </div>

            <div className="summary-form-field">
                <label>执行频率</label>
                {!useCustomCron ? (
                    <div>
                        <Select value={cronExpr} onChange={(v) => setCronExpr(v as string)} style={{ width: "100%" }}>
                            {CRON_PRESETS.map((p) => (
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
                            自定义 cron 表达式
                        </Button>
                    </div>
                ) : (
                    <div>
                        <Input
                            value={customCron}
                            onChange={setCustomCron}
                            placeholder="cron 表达式，如 0 9 * * 1-5"
                        />
                        <Button
                            size="small"
                            theme="borderless"
                            onClick={() => setUseCustomCron(false)}
                            style={{ marginTop: 4 }}
                        >
                            使用预设
                        </Button>
                    </div>
                )}
            </div>

            <div className="summary-form-field">
                <label>时间范围</label>
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
                <label>信息来源</label>
                <SourceSelector value={sources} onChange={setSources} />
            </div>

            <div className="summary-form-actions">
                {onCancel && (
                    <Button onClick={onCancel} style={{ marginRight: 8 }}>
                        取消
                    </Button>
                )}
                <Button
                    theme="solid"
                    onClick={handleSubmit}
                    loading={loading}
                    disabled={sources.length === 0}
                >
                    保存
                </Button>
            </div>
        </div>
    );
};

export default ScheduleForm;
