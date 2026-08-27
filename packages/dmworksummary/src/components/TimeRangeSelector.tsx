import React, { useEffect, useMemo, useState } from "react";
import { DatePicker } from "@douyinfe/semi-ui";
import type { SummaryWorkbenchTimeRangeScope } from "../bridge/summaryWorkbench/protocol";
import "./TimeRangeSelector.css";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const LAST_SEVEN_DAYS = 7;

export interface TimeRangeSelectorLabels {
    last7Days: string;
    custom: string;
    clear: string;
    startPlaceholder: string;
    endPlaceholder: string;
    customRangeAriaLabel: string;
    invalidOrder: string;
    maxDaysExceeded: (maxDays: number) => string;
    formatCustomRange: (start: Date, end: Date) => string;
}

export interface TimeRangeSelectorProps {
    value: SummaryWorkbenchTimeRangeScope | null;
    onChange: (value: SummaryWorkbenchTimeRangeScope | null) => void;
    labels: TimeRangeSelectorLabels;
    maxDays?: number;
    disabled?: boolean;
    now?: Date;
}

function startOfLocalDay(value: Date): Date {
    const next = new Date(value);
    next.setHours(0, 0, 0, 0);
    return next;
}

function endOfLocalDay(value: Date): Date {
    const next = new Date(value);
    next.setHours(23, 59, 59, 999);
    return next;
}

function sameLocalDate(left: Date, right: Date): boolean {
    return (
        left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate()
    );
}

function scopeDates(
    value: SummaryWorkbenchTimeRangeScope | null
): [Date, Date] | null {
    if (!value) return null;
    const start = new Date(value.start);
    const end = new Date(value.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
        return null;
    return [start, end];
}

export function createLastDaysTimeRange(
    now: Date,
    days: number,
    label: string
): SummaryWorkbenchTimeRangeScope {
    const end = endOfLocalDay(now);
    const start = startOfLocalDay(now);
    start.setDate(start.getDate() - Math.max(0, days - 1));
    return {
        start: start.toISOString(),
        end: end.toISOString(),
        label,
    };
}

export function createCustomTimeRange(
    start: Date,
    end: Date,
    label: string
): SummaryWorkbenchTimeRangeScope {
    return {
        start: startOfLocalDay(start).toISOString(),
        end: endOfLocalDay(end).toISOString(),
        label,
    };
}

function isLastSevenDays(
    value: SummaryWorkbenchTimeRangeScope | null,
    now: Date
): boolean {
    const dates = scopeDates(value);
    if (!dates) return false;
    const expected = createLastDaysTimeRange(now, LAST_SEVEN_DAYS, "");
    return (
        sameLocalDate(dates[0], new Date(expected.start)) &&
        sameLocalDate(dates[1], new Date(expected.end))
    );
}

export default function TimeRangeSelector({
    value,
    onChange,
    labels,
    maxDays = 31,
    disabled = false,
    now,
}: TimeRangeSelectorProps) {
    const referenceNow = useMemo(
        () => new Date(now?.getTime() ?? Date.now()),
        [now]
    );
    const [showCustom, setShowCustom] = useState(
        () => value !== null && !isLastSevenDays(value, referenceNow)
    );
    const [error, setError] = useState("");
    const selectedDates = scopeDates(value);
    const lastSevenDaysSelected = isLastSevenDays(value, referenceNow);

    useEffect(() => {
        if (!value) return;
        setShowCustom(!isLastSevenDays(value, referenceNow));
    }, [referenceNow, value]);

    const selectLastSevenDays = () => {
        setShowCustom(false);
        setError("");
        onChange(
            createLastDaysTimeRange(
                referenceNow,
                LAST_SEVEN_DAYS,
                labels.last7Days
            )
        );
    };

    const selectCustom = () => {
        setShowCustom(true);
        setError("");
    };

    const handleCustomChange = (input?: Date | Date[] | string | string[]) => {
        if (!Array.isArray(input) || input.length < 2) return;
        const [rawStart, rawEnd] = input;
        if (!(rawStart instanceof Date) || !(rawEnd instanceof Date)) return;

        const start = startOfLocalDay(rawStart);
        const end = endOfLocalDay(rawEnd);
        if (end < start) {
            setError(labels.invalidOrder);
            return;
        }
        if (end.getTime() - start.getTime() > maxDays * DAY_IN_MS) {
            setError(labels.maxDaysExceeded(maxDays));
            return;
        }

        setError("");
        onChange(
            createCustomTimeRange(
                start,
                end,
                labels.formatCustomRange(start, end)
            )
        );
    };

    const datePickerValue: [Date, Date] | undefined =
        showCustom && selectedDates && !lastSevenDaysSelected
            ? selectedDates
            : undefined;

    return (
        <div className="wk-time-range-selector">
            <div className="wk-time-range-selector__presets">
                <button
                    type="button"
                    className={`wk-time-range-selector__preset${
                        lastSevenDaysSelected
                            ? " wk-time-range-selector__preset--active"
                            : ""
                    }`}
                    aria-pressed={lastSevenDaysSelected}
                    disabled={disabled}
                    onClick={selectLastSevenDays}
                >
                    {labels.last7Days}
                </button>
                <button
                    type="button"
                    className={`wk-time-range-selector__preset${
                        showCustom
                            ? " wk-time-range-selector__preset--active"
                            : ""
                    }`}
                    aria-pressed={showCustom}
                    disabled={disabled}
                    onClick={selectCustom}
                >
                    {labels.custom}
                </button>
                {value && (
                    <button
                        type="button"
                        className="wk-time-range-selector__clear"
                        disabled={disabled}
                        onClick={() => {
                            setError("");
                            onChange(null);
                        }}
                    >
                        {labels.clear}
                    </button>
                )}
            </div>

            {showCustom && (
                <div className="wk-time-range-selector__custom">
                    <DatePicker
                        className="wk-time-range-selector__picker"
                        type="dateRange"
                        value={datePickerValue}
                        disabled={disabled}
                        onChange={handleCustomChange}
                        placeholder={[
                            labels.startPlaceholder,
                            labels.endPlaceholder,
                        ]}
                        aria-label={labels.customRangeAriaLabel}
                        disabledDate={(date) =>
                            Boolean(
                                date &&
                                    endOfLocalDay(date).getTime() >
                                        endOfLocalDay(referenceNow).getTime()
                            )
                        }
                    />
                </div>
            )}

            {value && (
                <output className="wk-time-range-selector__value">
                    {value.label}
                </output>
            )}
            {error && (
                <p className="wk-time-range-selector__error" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
