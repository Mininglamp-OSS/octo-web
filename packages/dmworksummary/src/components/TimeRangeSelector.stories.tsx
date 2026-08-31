import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import TimeRangeSelector, {
    type TimeRangeSelectorLabels,
} from "./TimeRangeSelector";
import type { SummaryWorkbenchTimeRangeScope } from "../bridge/summaryWorkbench/protocol";

const labels: TimeRangeSelectorLabels = {
    last7Days: "最近 7 天",
    custom: "自定义日期",
    clear: "清除",
    startPlaceholder: "开始日期",
    endPlaceholder: "结束日期",
    customRangeAriaLabel: "选择自定义总结日期范围",
    invalidOrder: "结束日期不能早于开始日期",
    maxDaysExceeded: (maxDays) => `日期范围不能超过 ${maxDays} 天`,
    longRangeWarning: "当前时间范围超过 31 天，生成时间可能更长。",
    formatCustomRange: (start, end) =>
        `${start.toLocaleDateString("zh-CN")} 至 ${end.toLocaleDateString(
            "zh-CN"
        )}`,
};

function ControlledTimeRangeSelector() {
    const [value, setValue] = useState<SummaryWorkbenchTimeRangeScope | null>(
        null
    );
    return (
        <div style={{ width: 520, padding: "var(--wk-sp-6)" }}>
            <TimeRangeSelector
                value={value}
                onChange={setValue}
                labels={labels}
                maxDays={90}
            />
        </div>
    );
}

const meta: Meta<typeof TimeRangeSelector> = {
    title: "Summary/Workbench/TimeRangeSelector",
    component: TimeRangeSelector,
};

export default meta;
type Story = StoryObj<typeof TimeRangeSelector>;

export const Default: Story = {
    render: () => <ControlledTimeRangeSelector />,
};
