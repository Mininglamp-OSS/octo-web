import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TimeRangeSelector, {
    createCustomTimeRange,
    createLastDaysTimeRange,
    type TimeRangeSelectorLabels,
} from "./TimeRangeSelector";

let datePickerSelection: [Date, Date] = [
    new Date(2026, 7, 1),
    new Date(2026, 7, 3),
];

vi.mock("@douyinfe/semi-ui", () => ({
    DatePicker: ({ onChange, placeholder }: any) => (
        <button
            type="button"
            aria-label={placeholder.join(" ")}
            onClick={() => onChange(datePickerSelection)}
        >
            pick-range
        </button>
    ),
}));

const labels: TimeRangeSelectorLabels = {
    last7Days: "Last 7 days",
    last15Days: "Last 15 days",
    last30Days: "Last month",
    custom: "Custom",
    clear: "Clear",
    startPlaceholder: "Start",
    endPlaceholder: "End",
    customRangeAriaLabel: "Choose custom range",
    invalidOrder: "Invalid order",
    maxDaysExceeded: (maxDays) => `Maximum ${maxDays} days`,
    longRangeWarning: "Long ranges take longer",
    formatCustomRange: (start, end) =>
        `${start.getFullYear()}-${
            start.getMonth() + 1
        }-${start.getDate()} / ${end.getFullYear()}-${
            end.getMonth() + 1
        }-${end.getDate()}`,
};

describe("TimeRangeSelector", () => {
    it("emits a full-day structured range for the last seven days", () => {
        const onChange = vi.fn();
        const now = new Date(2026, 7, 27, 10, 30);
        const view = render(
            <TimeRangeSelector
                value={null}
                onChange={onChange}
                labels={labels}
                now={now}
            />,
            { legacyRoot: true }
        );

        fireEvent.click(view.getByRole("button", { name: "Last 7 days" }));

        const nextValue = onChange.mock.calls[0][0];
        expect(new Date(nextValue.start).getDate()).toBe(21);
        expect(new Date(nextValue.start).getHours()).toBe(0);
        expect(new Date(nextValue.end).getDate()).toBe(27);
        expect(new Date(nextValue.end).getHours()).toBe(23);
        expect(nextValue.label).toBe("Last 7 days");
    });

    it.each([
        ["Last 15 days", 15, 13],
        ["Last month", 30, 29],
    ])("emits the %s preset", (label, days, expectedStartDay) => {
        const onChange = vi.fn();
        const view = render(
            <TimeRangeSelector
                value={null}
                onChange={onChange}
                labels={labels}
                now={new Date(2026, 7, 27, 10, 30)}
            />,
            { legacyRoot: true }
        );

        fireEvent.click(view.getByRole("button", { name: label }));

        const nextValue = onChange.mock.calls[0][0];
        expect(new Date(nextValue.start).getDate()).toBe(expectedStartDay);
        expect(new Date(nextValue.end).getDate()).toBe(27);
        expect(nextValue.label).toBe(label);
        expect(
            Math.round(
                (new Date(nextValue.end).getTime() -
                    new Date(nextValue.start).getTime()) /
                    (24 * 60 * 60 * 1000)
            )
        ).toBe(days);
    });

    it("opens the custom picker and emits a stable caller-formatted label", () => {
        const onChange = vi.fn();
        datePickerSelection = [new Date(2026, 7, 1), new Date(2026, 7, 3)];
        const view = render(
            <TimeRangeSelector
                value={null}
                onChange={onChange}
                labels={labels}
                now={new Date(2026, 7, 27)}
            />,
            { legacyRoot: true }
        );

        fireEvent.click(view.getByRole("button", { name: "Custom" }));
        fireEvent.click(view.getByRole("button", { name: "Start End" }));

        expect(onChange.mock.calls[0][0].label).toBe("2026-8-1 / 2026-8-3");
    });

    it("rejects a custom range longer than maxDays", () => {
        const onChange = vi.fn();
        datePickerSelection = [new Date(2026, 6, 1), new Date(2026, 7, 27)];
        const view = render(
            <TimeRangeSelector
                value={null}
                onChange={onChange}
                labels={labels}
                maxDays={31}
                now={new Date(2026, 7, 27)}
            />,
            { legacyRoot: true }
        );

        fireEvent.click(view.getByRole("button", { name: "Custom" }));
        fireEvent.click(view.getByRole("button", { name: "Start End" }));

        expect(onChange).not.toHaveBeenCalled();
        expect(view.getByRole("alert")).toHaveTextContent("Maximum 31 days");
    });

    it("accepts a range longer than 31 days when the server limit allows it", () => {
        const onChange = vi.fn();
        datePickerSelection = [new Date(2026, 5, 1), new Date(2026, 7, 27)];
        const view = render(
            <TimeRangeSelector
                value={null}
                onChange={onChange}
                labels={labels}
                maxDays={90}
                now={new Date(2026, 7, 27)}
            />,
            { legacyRoot: true }
        );

        fireEvent.click(view.getByRole("button", { name: "Custom" }));
        fireEvent.click(view.getByRole("button", { name: "Start End" }));

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("warns after a selected range exceeds 31 days", () => {
        const value = createCustomTimeRange(
            new Date(2026, 5, 1),
            new Date(2026, 7, 27),
            "Long range"
        );
        const view = render(
            <TimeRangeSelector
                value={value}
                onChange={vi.fn()}
                labels={labels}
                maxDays={90}
                now={new Date(2026, 7, 27)}
            />,
            { legacyRoot: true }
        );

        expect(view.getByText("Long ranges take longer")).toBeInTheDocument();
    });

    it("normalizes helper-created custom ranges to day boundaries", () => {
        const range = createCustomTimeRange(
            new Date(2026, 7, 1, 9),
            new Date(2026, 7, 1, 10),
            "One day"
        );
        const preset = createLastDaysTimeRange(
            new Date(2026, 7, 27, 12),
            7,
            "Seven days"
        );

        expect(new Date(range.start).getHours()).toBe(0);
        expect(new Date(range.end).getHours()).toBe(23);
        expect(new Date(preset.start).getDate()).toBe(21);
    });
});
