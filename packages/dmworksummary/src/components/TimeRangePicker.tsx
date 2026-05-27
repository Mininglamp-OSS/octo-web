import React, { useCallback } from "react";
import { DatePicker, Typography } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import { validateTimeRange } from "../utils/summaryHelpers";

const { Text } = Typography;

interface TimeRangePickerProps {
    value: { start: Date | null; end: Date | null };
    onChange: (range: { start: Date; end: Date }) => void;
    maxDays?: number;
}

const TimeRangePicker: React.FC<TimeRangePickerProps> = ({
    value,
    onChange,
    maxDays = 31,
}) => {
    const { t } = useI18n();
    const [error, setError] = React.useState<string | null>(null);

    const handleChange = useCallback(
        (dates: [Date, Date] | Date | string | undefined) => {
            if (!dates || !Array.isArray(dates) || dates.length < 2) return;
            const [start, end] = dates;
            const errMsg = validateTimeRange(start, end, maxDays);
            setError(errMsg);
            if (!errMsg) {
                onChange({ start, end });
            }
        },
        [onChange, maxDays],
    );

    const dateValue: [Date, Date] | undefined =
        value.start && value.end ? [value.start, value.end] : undefined;

    return (
        <div className="summary-time-range-picker">
            <DatePicker
                type="dateRange"
                value={dateValue}
                onChange={handleChange as any}
                style={{ width: "100%" }}
                placeholder={[t("summary.timeRange.startPlaceholder"), t("summary.timeRange.endPlaceholder")]}
                disabledDate={(date) => {
                    if (!date) return false;
                    return date.getTime() > Date.now();
                }}
            />
            {error && (
                <Text type="danger" size="small" style={{ marginTop: 4 }}>
                    {error}
                </Text>
            )}
        </div>
    );
};

export default TimeRangePicker;
