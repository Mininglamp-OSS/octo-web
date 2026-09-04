import React, { useEffect, useMemo, useState } from "react";
import { DatePicker } from "@douyinfe/semi-ui";
import type { SummaryWorkbenchTimeRangeScope } from "../bridge/summaryWorkbench/protocol";
import "./TimeRangeSelector.css";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const LAST_SEVEN_DAYS = 7;
const LAST_FIFTEEN_DAYS = 15;
const LAST_THIRTY_DAYS = 30;
const LONG_RANGE_WARNING_DAYS = 31;

export interface TimeRangeSelectorLabels {
  last7Days: string;
  last15Days: string;
  last30Days: string;
  custom: string;
  clear: string;
  startPlaceholder: string;
  endPlaceholder: string;
  customRangeAriaLabel: string;
  invalidOrder: string;
  maxDaysExceeded: (maxDays: number) => string;
  longRangeWarning: string;
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
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
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

function presetDaysForValue(
  value: SummaryWorkbenchTimeRangeScope | null,
  now: Date
): number | undefined {
  const dates = scopeDates(value);
  if (!dates) return undefined;
  return [LAST_SEVEN_DAYS, LAST_FIFTEEN_DAYS, LAST_THIRTY_DAYS].find(
    (days) => {
      const expected = createLastDaysTimeRange(now, days, "");
      return (
        sameLocalDate(dates[0], new Date(expected.start)) &&
        sameLocalDate(dates[1], new Date(expected.end))
      );
    }
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
    () => value !== null && presetDaysForValue(value, referenceNow) === undefined
  );
  const [error, setError] = useState("");
  const selectedDates = scopeDates(value);
  const selectedPresetDays = presetDaysForValue(value, referenceNow);
  const isLongRange = Boolean(
    selectedDates &&
      selectedDates[1].getTime() - selectedDates[0].getTime() >
        LONG_RANGE_WARNING_DAYS * DAY_IN_MS
  );

  useEffect(() => {
    if (!value) return;
    setShowCustom(presetDaysForValue(value, referenceNow) === undefined);
  }, [referenceNow, value]);

  const selectPreset = (days: number, label: string) => {
    setShowCustom(false);
    setError("");
    onChange(createLastDaysTimeRange(referenceNow, days, label));
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
      createCustomTimeRange(start, end, labels.formatCustomRange(start, end))
    );
  };

  const datePickerValue: [Date, Date] | undefined =
    showCustom && selectedDates && selectedPresetDays === undefined
      ? selectedDates
      : undefined;

  const presets = [
    { days: LAST_SEVEN_DAYS, label: labels.last7Days },
    { days: LAST_FIFTEEN_DAYS, label: labels.last15Days },
    { days: LAST_THIRTY_DAYS, label: labels.last30Days },
  ];

  return (
    <div className="wk-time-range-selector">
      <div className="wk-time-range-selector__presets">
        {presets.map((preset) => (
          <button
            key={preset.days}
            type="button"
            className={`wk-time-range-selector__preset${
              selectedPresetDays === preset.days
                ? " wk-time-range-selector__preset--active"
                : ""
            }`}
            aria-pressed={selectedPresetDays === preset.days}
            disabled={disabled || preset.days > maxDays}
            onClick={() => selectPreset(preset.days, preset.label)}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          className={`wk-time-range-selector__preset${
            showCustom ? " wk-time-range-selector__preset--active" : ""
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
            placeholder={[labels.startPlaceholder, labels.endPlaceholder]}
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
        <output className="wk-time-range-selector__value">{value.label}</output>
      )}
      {isLongRange && !error && (
        <p className="wk-time-range-selector__warning">
          {labels.longRangeWarning}
        </p>
      )}
      {error && (
        <p className="wk-time-range-selector__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
