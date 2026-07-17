import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DatePicker } from "@douyinfe/semi-ui";
import { CalendarDays, ChevronDown, X } from "lucide-react";
import WKButton from "../../Components/WKButton";
import { useI18n } from "../../i18n";
import type {
  ChannelSearchDataSource,
  ChannelSearchFilters,
  ChannelSearchSender,
} from "../../Service/SearchTypes";
import WKApp from "../../App";
import { useOutsideDismiss } from "./useOutsideDismiss";

type GetChannelSearchSender = ChannelSearchDataSource["getSender"];

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function toSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

function dateFromSeconds(seconds?: number) {
  if (!seconds) return undefined;
  return new Date(seconds * 1000);
}

function datePickerValueToDate(
  value?: Date | Date[] | string | string[] | null
) {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateDisplayValue(seconds?: number, locale?: string) {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: "short",
  }).format(date);
  return `${year}/${month}/${day} ${weekday}`;
}

const FilterSenderAvatar: React.FC<{
  uid: string;
  getSender: GetChannelSearchSender;
}> = ({ uid, getSender }) => {
  const sender = getSender(uid);
  return (
    <img
      className="wk-channel-search-filter-avatar"
      src={sender.avatarUrl || WKApp.shared.avatarUser(uid)}
      alt=""
    />
  );
};

const FilterPopover: React.FC<{
  open: boolean;
  filters: ChannelSearchFilters;
  dataSource: ChannelSearchDataSource;
  onApply: (filters: ChannelSearchFilters) => void;
  onClose: () => void;
}> = ({ open, filters, dataSource, onApply, onClose }) => {
  const { t, locale } = useI18n();
  const senders = dataSource.getSenders();
  const senderListId = "wk-channel-search-sender-list";
  const getSender = useCallback(
    (uid: string) => dataSource.getSender(uid),
    [dataSource]
  );
  const [draft, setDraft] = useState<ChannelSearchFilters>(filters);
  const [senderKeyword, setSenderKeyword] = useState("");
  const [senderOptions, setSenderOptions] = useState<ChannelSearchSender[]>([]);
  const [senderOpen, setSenderOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const senderFieldRef = useRef<HTMLDivElement>(null);
  const sortFieldRef = useRef<HTMLDivElement>(null);

  const getSenderDismissContainers = useCallback(
    () => [senderFieldRef.current],
    []
  );
  const getSortDismissContainers = useCallback(
    () => [sortFieldRef.current],
    []
  );
  const closeSenderDropdown = useCallback(() => {
    setSenderOpen(false);
  }, []);
  const closeSortDropdown = useCallback(() => {
    setSortOpen(false);
  }, []);

  useEffect(() => {
    if (open) {
      setDraft(filters);
      setSenderKeyword("");
      setSenderOptions(dataSource.getSenders());
      setSenderOpen(false);
      setSortOpen(false);
    }
  }, [filters, open]);

  useOutsideDismiss(
    senderOpen,
    getSenderDismissContainers,
    closeSenderDropdown
  );
  useOutsideDismiss(sortOpen, getSortDismissContainers, closeSortDropdown);

  useEffect(() => {
    if (!open || !senderOpen || !dataSource.searchSenders) {
      setSenderOptions(dataSource.getSenders());
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      dataSource
        .searchSenders?.(senderKeyword)
        .then((senders) => {
          if (!cancelled) {
            setSenderOptions(senders);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSenderOptions(dataSource.getSenders());
          }
        });
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dataSource, open, senderKeyword, senderOpen]);

  const filteredSenders = useMemo(() => {
    const shouldUseSenderOptions =
      !!dataSource.searchSenders || senderOptions.length > 0;
    const source = shouldUseSenderOptions ? senderOptions : senders;
    const keyword = senderKeyword.trim().toLowerCase();
    if (!keyword || dataSource.searchSenders) return source;
    return source.filter((sender) =>
      `${sender.name}${sender.uid}`.toLowerCase().includes(keyword)
    );
  }, [dataSource.searchSenders, senderKeyword, senderOptions, senders]);

  const setDatePreset = (preset: ChannelSearchFilters["datePreset"]) => {
    const now = new Date();
    let start = startOfDay(now);
    if (preset === "last_7_days") {
      start = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
    } else if (preset === "last_30_days") {
      start = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
    }
    setDraft({
      ...draft,
      datePreset: preset,
      startAt: toSeconds(start),
      endAt: toSeconds(endOfDay(now)),
    });
  };

  const setCustomDate = (
    field: "startAt" | "endAt",
    value?: Date | Date[] | string | string[] | null
  ) => {
    const date = datePickerValueToDate(value);
    const nextSeconds = date
      ? toSeconds(field === "startAt" ? startOfDay(date) : endOfDay(date))
      : undefined;

    setDraft((current) => {
      const next = {
        ...current,
        datePreset: undefined,
        [field]: nextSeconds,
      };
      if (field === "startAt" && next.startAt && next.endAt) {
        next.endAt = next.startAt > next.endAt ? undefined : next.endAt;
      }
      if (field === "endAt" && next.startAt && next.endAt) {
        next.startAt = next.startAt > next.endAt ? undefined : next.startAt;
      }
      return next;
    });
  };

  const toggleSender = (uid: string, checked: boolean) => {
    setDraft({
      ...draft,
      senderUids: checked
        ? [...draft.senderUids, uid]
        : draft.senderUids.filter((item) => item !== uid),
    });
  };

  const chooseSender = (uid: string, checked: boolean) => {
    toggleSender(uid, checked);
    setSenderKeyword("");
    setSenderOpen(true);
  };

  const clearSenders = () => {
    setDraft({ ...draft, senderUids: [] });
    setSenderKeyword("");
  };

  const clearSort = () => {
    setDraft({ ...draft, sort: "time_desc" });
    setSortOpen(false);
  };

  const clearDate = () => {
    setDraft({
      ...draft,
      datePreset: undefined,
      startAt: undefined,
      endAt: undefined,
    });
  };

  const hasSenderFilter = draft.senderUids.length > 0;
  const hasSortFilter = draft.sort !== "time_desc";
  const hasDateFilter = !!(draft.datePreset || draft.startAt || draft.endAt);

  if (!open) return null;

  return (
    <div className="wk-channel-search-filter-popover">
      <div className="wk-channel-search-filter-section">
        <div className="wk-channel-search-filter-title-row">
          <div className="wk-channel-search-filter-title">
            {t("base.channelSearch.filter.sender")}
          </div>
          {hasSenderFilter && (
            <button
              className="wk-channel-search-filter-clear-section"
              type="button"
              onClick={clearSenders}
            >
              {t("base.channelSearch.filter.clear")}
            </button>
          )}
        </div>

        <div className="wk-channel-search-sender-wrap" ref={senderFieldRef}>
          <div
            className={[
              "wk-channel-search-sender-field",
              hasSenderFilter ? "has-values" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="combobox"
            aria-expanded={senderOpen}
            aria-controls={senderListId}
            aria-haspopup="listbox"
            tabIndex={0}
            onClick={() => setSenderOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "ArrowDown") {
                event.preventDefault();
                setSenderOpen(true);
              }
            }}
          >
            {draft.senderUids.map((uid) => {
              const sender = getSender(uid);
              return (
                <button
                  key={uid}
                  className="wk-channel-search-filter-chip"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSender(uid, false);
                  }}
                >
                  <FilterSenderAvatar uid={uid} getSender={getSender} />
                  {sender.name}
                  <X size={12} />
                </button>
              );
            })}
            <input
              value={senderKeyword}
              onChange={(event) => {
                setSenderKeyword(event.target.value);
                setSenderOpen(true);
              }}
              onFocus={() => setSenderOpen(true)}
              placeholder={
                hasSenderFilter
                  ? ""
                  : t("base.channelSearch.filter.senderPlaceholder")
              }
            />
            <ChevronDown size={16} />
          </div>
          {senderOpen && (
            <div
              className="wk-channel-search-filter-senders"
              id={senderListId}
              role="listbox"
            >
              {filteredSenders.map((sender) => {
                const selected = draft.senderUids.includes(sender.uid);
                return (
                  <button
                    key={sender.uid}
                    className={selected ? "is-selected" : undefined}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => chooseSender(sender.uid, !selected)}
                  >
                    <span className="wk-channel-search-filter-check" />
                    <FilterSenderAvatar
                      uid={sender.uid}
                      getSender={getSender}
                    />
                    <span className="wk-channel-search-filter-option-name">
                      {sender.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="wk-channel-search-filter-section">
        <div className="wk-channel-search-filter-title-row">
          <div className="wk-channel-search-filter-title">
            {t("base.channelSearch.filter.sort")}
          </div>
          {hasSortFilter && (
            <button
              className="wk-channel-search-filter-clear-section"
              type="button"
              onClick={clearSort}
            >
              {t("base.channelSearch.filter.clear")}
            </button>
          )}
        </div>
        <div className="wk-channel-search-select-wrap" ref={sortFieldRef}>
          <button
            type="button"
            className="wk-channel-search-select-field"
            onClick={() => setSortOpen(!sortOpen)}
          >
            <span>
              {draft.sort === "time_desc"
                ? t("base.channelSearch.filter.timeDesc")
                : t("base.channelSearch.filter.timeAsc")}
            </span>
            <ChevronDown size={16} />
          </button>
          {sortOpen && (
            <div className="wk-channel-search-select-menu">
              <button
                type="button"
                className={draft.sort === "time_desc" ? "is-active" : undefined}
                onClick={() => {
                  setDraft({ ...draft, sort: "time_desc" });
                  setSortOpen(false);
                }}
              >
                {t("base.channelSearch.filter.timeDesc")}
              </button>
              <button
                type="button"
                className={draft.sort === "time_asc" ? "is-active" : undefined}
                onClick={() => {
                  setDraft({ ...draft, sort: "time_asc" });
                  setSortOpen(false);
                }}
              >
                {t("base.channelSearch.filter.timeAsc")}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="wk-channel-search-filter-section">
        <div className="wk-channel-search-filter-title-row">
          <div className="wk-channel-search-filter-title">
            {t("base.channelSearch.filter.sendTime")}
          </div>
          {hasDateFilter && (
            <button
              className="wk-channel-search-filter-clear-section"
              type="button"
              onClick={clearDate}
            >
              {t("base.channelSearch.filter.clear")}
            </button>
          )}
        </div>
        <div className="wk-channel-search-radio-list">
          {(
            [
              ["today", "base.channelSearch.filter.today"],
              ["last_7_days", "base.channelSearch.filter.last7Days"],
              ["last_30_days", "base.channelSearch.filter.last30Days"],
            ] as const
          ).map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              className={draft.datePreset === preset ? "is-active" : undefined}
              onClick={() => setDatePreset(preset)}
            >
              <span />
              {t(label)}
            </button>
          ))}
        </div>
        <DatePicker
          className="wk-channel-search-date-picker"
          value={dateFromSeconds(draft.startAt)}
          onChange={(value) => setCustomDate("startAt", value)}
          density="compact"
          position="bottomLeft"
          autoSwitchDate={false}
          disabledDate={(date) => {
            if (!date || !draft.endAt) return false;
            return toSeconds(startOfDay(date)) > draft.endAt;
          }}
          triggerRender={() => (
            <button className="wk-channel-search-date-input" type="button">
              <span className={draft.startAt ? undefined : "is-placeholder"}>
                {draft.startAt
                  ? dateDisplayValue(draft.startAt, locale)
                  : t("base.channelSearch.filter.startDate")}
              </span>
              <CalendarDays size={16} />
            </button>
          )}
        />
        <DatePicker
          className="wk-channel-search-date-picker"
          value={dateFromSeconds(draft.endAt)}
          onChange={(value) => setCustomDate("endAt", value)}
          density="compact"
          position="bottomLeft"
          autoSwitchDate={false}
          disabledDate={(date) => {
            if (!date || !draft.startAt) return false;
            return toSeconds(endOfDay(date)) < draft.startAt;
          }}
          triggerRender={() => (
            <button className="wk-channel-search-date-input" type="button">
              <span className={draft.endAt ? undefined : "is-placeholder"}>
                {draft.endAt
                  ? dateDisplayValue(draft.endAt, locale)
                  : t("base.channelSearch.filter.endDate")}
              </span>
              <CalendarDays size={16} />
            </button>
          )}
        />
      </div>

      <div className="wk-channel-search-filter-actions">
        <WKButton size="sm" variant="secondary" onClick={onClose}>
          {t("base.common.cancel")}
        </WKButton>
        <WKButton
          size="sm"
          variant="primary"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          {t("base.common.ok")}
        </WKButton>
      </div>
    </div>
  );
};

export { FilterPopover as ChannelSearchFilterPopover };
