import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DatePicker, Toast } from "@douyinfe/semi-ui";
import {
  CalendarDays,
  ChevronDown,
  Download,
  Filter,
  LocateFixed,
  MoreHorizontal,
  Play,
  X,
  Zap,
} from "lucide-react";
import { Channel } from "wukongimjssdk";
import WKAvatar from "../WKAvatar";
import WKButton from "../WKButton";
import IconClick from "../IconClick";
import ConversationContext from "../Conversation/context";
import FileHelper from "../../Utils/filehelper";
import { downloadFile } from "../../Utils/download";
import { useI18n } from "../../i18n";
import { channelSearchEmptyDataSource } from "./adapter";
import { defaultChannelSearchFilters } from "./types";
import type {
  ChannelSearchDataSource,
  ChannelSearchFilters,
  ChannelSearchItem,
  ChannelSearchResponse,
  ChannelSearchSender,
  ChannelSearchTab,
} from "./types";
import WKApp from "../../App";
import "./index.css";

interface ChannelSearchPanelProps {
  channel: Channel;
  conversationContext?: ConversationContext;
  onClose: () => void;
  dataSource?: ChannelSearchDataSource;
  onLocateMessage?: (item: ChannelSearchItem) => void;
  onPreviewFile?: (item: ChannelSearchItem) => void;
  initialState?: {
    activeTab?: ChannelSearchTab;
    filterOpen?: boolean;
    filters?: ChannelSearchFilters;
    keyword?: string;
  };
}

const tabs: ChannelSearchTab[] = ["all", "message", "media", "file"];

const tabI18nKey: Record<ChannelSearchTab, string> = {
  all: "base.channelSearch.tabs.all",
  message: "base.channelSearch.tabs.message",
  media: "base.channelSearch.tabs.media",
  file: "base.channelSearch.tabs.file",
};

const emptySearchImage = new URL(
  "./assets/figma-empty-search.png",
  import.meta.url
).href;

type GetChannelSearchSender = ChannelSearchDataSource["getSender"];

function resolveSender(
  item: ChannelSearchItem,
  getSender: GetChannelSearchSender
): ChannelSearchSender {
  return item.sender || getSender(item.senderUid);
}

function activeFilterCount(filters: ChannelSearchFilters) {
  return (
    filters.senderUids.length +
    (filters.sort !== "time_desc" ? 1 : 0) +
    (filters.datePreset || filters.startAt || filters.endAt ? 1 : 0)
  );
}

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

function dateDisplayValue(seconds?: number) {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
  }).format(date);
  return `${year}/${month}/${day} ${weekday}`;
}

function monthLabel(timestamp: number) {
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

function compactFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")}KB`;
  }
  return `${bytes}B`;
}

function assetUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "default" in value) {
    return assetUrl((value as { default?: unknown }).default);
  }
  return undefined;
}

function useOutsideDismiss(
  open: boolean,
  getContainers: () => Array<HTMLElement | null | undefined>,
  onDismiss: () => void
) {
  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (getContainers().some((element) => element?.contains(target))) {
        return;
      }
      onDismiss();
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener(
        "pointerdown",
        closeOnOutsidePointerDown,
        true
      );
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [getContainers, onDismiss, open]);
}

const HighlightText: React.FC<{ text?: string; keyword: string }> = ({
  text = "",
  keyword,
}) => {
  if (/<\/?mark>/i.test(text)) {
    const parts: React.ReactNode[] = [];
    const pattern = /<mark>(.*?)<\/mark>/gi;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) {
        parts.push(text.slice(cursor, match.index));
      }
      parts.push(
        <mark
          key={`${match.index}-${pattern.lastIndex}`}
          className="wk-channel-search-highlight"
        >
          {match[1]}
        </mark>
      );
      cursor = pattern.lastIndex;
    }
    if (cursor < text.length) {
      parts.push(text.slice(cursor));
    }
    return <>{parts}</>;
  }

  const needle = keyword.trim();
  if (!needle) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let index = lowerText.indexOf(lowerNeedle);

  while (index !== -1) {
    if (index > cursor) {
      parts.push(text.slice(cursor, index));
    }
    const end = index + needle.length;
    parts.push(
      <mark key={`${index}-${end}`} className="wk-channel-search-highlight">
        {text.slice(index, end)}
      </mark>
    );
    cursor = end;
    index = lowerText.indexOf(lowerNeedle, cursor);
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return <>{parts}</>;
};

const SenderAvatar: React.FC<{
  uid: string;
  getSender: GetChannelSearchSender;
}> = ({ uid, getSender }) => (
  <WKAvatar
    src={getSender(uid).avatarUrl || WKApp.shared.avatarUser(uid)}
    style={{ width: "24px", height: "24px" }}
    lazy
  />
);

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
  const { t } = useI18n();
  const senders = dataSource.getSenders();
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
    const source = senderOptions.length > 0 ? senderOptions : senders;
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
            onClick={() => setSenderOpen(true)}
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
            <div className="wk-channel-search-filter-senders">
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
                  ? dateDisplayValue(draft.startAt)
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
                  ? dateDisplayValue(draft.endAt)
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

const MessageResultItem: React.FC<{
  item: ChannelSearchItem;
  keyword: string;
  getSender: GetChannelSearchSender;
  onLocate: (item: ChannelSearchItem) => void;
}> = ({ item, keyword, getSender, onLocate }) => {
  const { format, t } = useI18n();
  const sender = resolveSender(item, getSender);
  const isForward = item.kind === "merge_forward";

  return (
    <div className="wk-channel-search-result wk-channel-search-message-result">
      <SenderAvatar uid={item.senderUid} getSender={getSender} />
      <div className="wk-channel-search-result-body">
        <div className="wk-channel-search-result-meta">
          <span>{sender.name}</span>
          <span>
            {format.dateTime(item.timestamp * 1000, {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        {isForward ? (
          <>
            <div className="wk-channel-search-match-reason">
              <HighlightText text={item.matchReason} keyword={keyword} />
            </div>
            <div className="wk-channel-search-forward-card">
              <div className="wk-channel-search-forward-title">
                <HighlightText text={item.forward?.title} keyword={keyword} />
              </div>
              {item.forward?.snippets.map((snippet) => (
                <div
                  key={snippet}
                  className="wk-channel-search-forward-snippet"
                >
                  <HighlightText text={snippet} keyword={keyword} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="wk-channel-search-result-text">
            <HighlightText text={item.text} keyword={keyword} />
          </div>
        )}
      </div>
      <button
        className="wk-channel-search-locate-action"
        type="button"
        onClick={() => onLocate(item)}
      >
        {t("base.channelSearch.locateToChat")}
      </button>
    </div>
  );
};

const MixedResultItem: React.FC<{
  item: ChannelSearchItem;
  keyword: string;
  getSender: GetChannelSearchSender;
  onLocate: (item: ChannelSearchItem) => void;
}> = ({ item, keyword, getSender, onLocate }) => {
  if (item.kind === "file") {
    return (
      <FileInlineResult
        item={item}
        keyword={keyword}
        getSender={getSender}
        onLocate={onLocate}
      />
    );
  }
  if (item.kind === "image" || item.kind === "video") {
    return (
      <MediaInlineResult
        item={item}
        keyword={keyword}
        getSender={getSender}
        onLocate={onLocate}
      />
    );
  }
  return (
    <MessageResultItem
      item={item}
      keyword={keyword}
      getSender={getSender}
      onLocate={onLocate}
    />
  );
};

const MediaInlineResult: React.FC<{
  item: ChannelSearchItem;
  keyword: string;
  getSender: GetChannelSearchSender;
  onLocate: (item: ChannelSearchItem) => void;
}> = ({ item, keyword, getSender, onLocate }) => {
  const { format, t } = useI18n();
  const sender = resolveSender(item, getSender);
  return (
    <div className="wk-channel-search-result wk-channel-search-media-inline">
      <SenderAvatar uid={item.senderUid} getSender={getSender} />
      <div className="wk-channel-search-result-body">
        <div className="wk-channel-search-result-meta">
          <span>{sender.name}</span>
          <span>
            {format.dateTime(item.timestamp * 1000, {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="wk-channel-search-match-reason">
          <HighlightText text={item.matchReason} keyword={keyword} />
        </div>
        <MediaThumb item={item} onLocate={onLocate} compact />
      </div>
      <button
        className="wk-channel-search-locate-action"
        type="button"
        onClick={() => onLocate(item)}
      >
        {t("base.channelSearch.locateToChat")}
      </button>
    </div>
  );
};

const MediaThumb: React.FC<{
  item: ChannelSearchItem;
  onLocate: (item: ChannelSearchItem) => void;
  compact?: boolean;
}> = ({ item, onLocate, compact = false }) => {
  const thumbUrl = compact
    ? item.media?.inlineThumbUrl || item.media?.thumbUrl
    : item.media?.thumbUrl;

  return (
    <div
      className={[
        "wk-channel-search-media-thumb",
        `wk-channel-search-media-thumb--${item.media?.tone || "warm"}`,
        thumbUrl ? "wk-channel-search-media-thumb--image" : "",
        compact ? "wk-channel-search-media-thumb--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={thumbUrl ? { backgroundImage: `url(${thumbUrl})` } : undefined}
    >
      {item.kind === "video" && (
        <div className="wk-channel-search-media-play">
          <Play size={18} fill="currentColor" />
        </div>
      )}
      <button
        className="wk-channel-search-media-locate"
        type="button"
        onClick={() => onLocate(item)}
      >
        <LocateFixed size={16} />
      </button>
    </div>
  );
};

const FileInlineResult: React.FC<{
  item: ChannelSearchItem;
  keyword: string;
  getSender: GetChannelSearchSender;
  onLocate: (item: ChannelSearchItem) => void;
}> = ({ item, keyword, getSender, onLocate }) => {
  const { format, t } = useI18n();
  const sender = resolveSender(item, getSender);
  const fileName = item.file?.name || t("base.conversation.file.unknown");
  const inlineFileName = fileName.replace(/\.[^.]+$/, "");
  const fileIconInfo = FileHelper.getFileIconInfo(fileName);
  const fileIconSrc = item.file?.iconUrl || assetUrl(fileIconInfo?.icon);

  return (
    <div className="wk-channel-search-result wk-channel-search-file-inline">
      <SenderAvatar uid={item.senderUid} getSender={getSender} />
      <div className="wk-channel-search-result-body">
        <div className="wk-channel-search-result-meta">
          <span>{sender.name}</span>
          <span>
            {format.dateTime(item.timestamp * 1000, {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="wk-channel-search-inline-file-card">
          <div className="wk-channel-search-inline-file-icon">
            {fileIconSrc && <img src={fileIconSrc} alt="" />}
          </div>
          <div className="wk-channel-search-inline-file-body">
            <div className="wk-channel-search-inline-file-name">
              <HighlightText text={inlineFileName} keyword={keyword} />
            </div>
            <div className="wk-channel-search-inline-file-size">
              {compactFileSize(item.file?.size || 0)}
            </div>
          </div>
        </div>
      </div>
      <button
        className="wk-channel-search-locate-action"
        type="button"
        onClick={() => onLocate(item)}
      >
        {t("base.channelSearch.locateToChat")}
      </button>
    </div>
  );
};

const MediaResultGrid: React.FC<{
  items: ChannelSearchItem[];
  onLocate: (item: ChannelSearchItem) => void;
}> = ({ items, onLocate }) => {
  const grouped = useMemo(() => {
    return items.reduce<Record<string, ChannelSearchItem[]>>((acc, item) => {
      const label = item.media?.monthBucket || monthLabel(item.timestamp);
      acc[label] = acc[label] || [];
      acc[label].push(item);
      return acc;
    }, {});
  }, [items]);

  return (
    <div className="wk-channel-search-media-groups">
      {Object.entries(grouped).map(([label, groupItems]) => (
        <section key={label} className="wk-channel-search-media-group">
          <div className="wk-channel-search-media-month">{label}</div>
          <div className="wk-channel-search-media-grid">
            {groupItems.map((item) => (
              <MediaThumb key={item.id} item={item} onLocate={onLocate} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

const FileResultItem: React.FC<{
  item: ChannelSearchItem;
  keyword: string;
  getSender: GetChannelSearchSender;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onLocate: (item: ChannelSearchItem) => void;
  onPreviewFile?: (item: ChannelSearchItem) => void;
}> = ({
  item,
  keyword,
  getSender,
  menuOpen,
  onMenuOpenChange,
  onLocate,
  onPreviewFile,
}) => {
  const { format, t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const sender = resolveSender(item, getSender);
  const fileName = item.file?.name || t("base.conversation.file.unknown");
  const fileIconInfo = FileHelper.getFileIconInfo(fileName);
  const fileIconSrc = item.file?.iconUrl || assetUrl(fileIconInfo?.icon);
  const hasFigmaIcon = !!item.file?.iconUrl;

  const handleDownload = async () => {
    const url = item.file?.downloadUrl || item.file?.url;
    if (!url) {
      Toast.warning(t("base.channelSearch.downloadUnavailable"));
      return;
    }
    try {
      await downloadFile(url, fileName);
    } catch (_) {
      Toast.error(t("base.channelSearch.downloadFailed"));
    }
  };

  const getFileMenuDismissContainers = useCallback(
    () => [menuRef.current],
    []
  );
  const closeFileMenu = useCallback(() => {
    onMenuOpenChange(false);
  }, [onMenuOpenChange]);
  useOutsideDismiss(menuOpen, getFileMenuDismissContainers, closeFileMenu);

  return (
    <div
      className="wk-channel-search-file-result"
      role="button"
      tabIndex={0}
      onClick={() => onPreviewFile?.(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPreviewFile?.(item);
        }
      }}
    >
      <div
        className={[
          "wk-channel-search-file-icon",
          hasFigmaIcon ? "wk-channel-search-file-icon--figma" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          backgroundColor: hasFigmaIcon ? undefined : fileIconInfo?.color,
        }}
      >
        {fileIconSrc && <img src={fileIconSrc} alt="" />}
      </div>
      <div className="wk-channel-search-file-body">
        <div className="wk-channel-search-file-name">
          <HighlightText text={fileName} keyword={keyword} />
        </div>
        <div className="wk-channel-search-file-meta">
          <span>{sender.name}</span>
          <span>{FileHelper.getFileSizeFormat(item.file?.size || 0)}</span>
          <span>
            {format.date(item.timestamp * 1000, {
              month: "2-digit",
              day: "2-digit",
            })}
          </span>
        </div>
      </div>
      <div
        ref={menuRef}
        className={[
          "wk-channel-search-file-menu-wrap",
          menuOpen ? "is-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={(event) => event.stopPropagation()}
      >
        <IconClick
          size="sm"
          icon={<MoreHorizontal size={16} />}
          title={t("base.channelSearch.fileMore")}
          onClick={() => onMenuOpenChange(!menuOpen)}
        />
        {menuOpen && (
          <div className="wk-channel-search-file-menu">
            <button
              type="button"
              onClick={() => {
                onMenuOpenChange(false);
                onLocate(item);
              }}
            >
              <LocateFixed size={14} />
              {t("base.channelSearch.locateToChatPosition")}
            </button>
            <button
              type="button"
              onClick={() => {
                onMenuOpenChange(false);
                void handleDownload();
              }}
            >
              <Download size={14} />
              {t("base.filePreview.downloadFile")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const SearchEmpty: React.FC<{ queryStarted: boolean }> = ({ queryStarted }) => {
  const { t } = useI18n();
  return (
    <div className="wk-channel-search-empty">
      <div className="wk-channel-search-empty-illustration">
        <img src={emptySearchImage} alt="" />
      </div>
      <div>
        {queryStarted
          ? t("base.channelSearch.noResults")
          : t("base.channelSearch.emptyHint")}
      </div>
    </div>
  );
};

const ChannelSearchPanel: React.FC<ChannelSearchPanelProps> = ({
  channel,
  conversationContext,
  onClose,
  dataSource = channelSearchEmptyDataSource,
  onLocateMessage,
  onPreviewFile,
  initialState,
}) => {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState(initialState?.keyword || "");
  const [activeTab, setActiveTab] = useState<ChannelSearchTab>(
    initialState?.activeTab || "all"
  );
  const [filters, setFilters] = useState<ChannelSearchFilters>(
    () => initialState?.filters || defaultChannelSearchFilters()
  );
  const [filterOpen, setFilterOpen] = useState(!!initialState?.filterOpen);
  const [openFileMenuId, setOpenFileMenuId] = useState<string | null>(null);
  const [response, setResponse] = useState<ChannelSearchResponse>({
    items: [],
    hasMore: false,
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [queryStarted, setQueryStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const [isComposing, setIsComposing] = useState(false);

  const filterCount = activeFilterCount(filters);
  const getSender = useCallback(
    (uid: string) => dataSource.getSender(uid),
    [dataSource]
  );

  const runSearch = useCallback(
    async (cursor?: string) => {
      if (isComposing) {
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setQueryStarted(true);
      setError(null);
      if (cursor) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const next = await dataSource.searchMessages({
          channelId: channel.channelID,
          channelType: channel.channelType,
          keyword,
          tab: activeTab,
          filters,
          cursor,
          limit: 20,
        });
        if (requestIdRef.current !== requestId) return;
        setResponse((prev) => ({
          items: cursor ? [...prev.items, ...next.items] : next.items,
          nextCursor: next.nextCursor,
          hasMore: next.hasMore,
        }));
      } catch (_) {
        if (requestIdRef.current === requestId) {
          setError(t("base.channelSearch.searchFailed"));
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [
      activeTab,
      channel,
      dataSource,
      filters,
      isComposing,
      keyword,
      t,
    ]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void runSearch();
    }, 250);
    return () => clearTimeout(timer);
  }, [runSearch]);

  const handleLocate = (item: ChannelSearchItem) => {
    if (onLocateMessage) {
      onLocateMessage(item);
      return;
    }
    conversationContext?.locateMessage(item.messageSeq);
  };

  const toggleFilterOpen = () => {
    setOpenFileMenuId(null);
    setFilterOpen((open) => !open);
  };

  const renderResults = () => {
    if (loading) {
      return (
        <div className="wk-channel-search-loading">
          {t("base.channelSearch.loading")}
        </div>
      );
    }
    if (error) {
      return <div className="wk-channel-search-error">{error}</div>;
    }
    if (!queryStarted || response.items.length === 0) {
      return <SearchEmpty queryStarted={queryStarted} />;
    }
    if (activeTab === "media") {
      return <MediaResultGrid items={response.items} onLocate={handleLocate} />;
    }
    if (activeTab === "file") {
      return (
        <div className="wk-channel-search-file-list">
          {response.items.map((item) => (
            <FileResultItem
              key={item.id}
              item={item}
              keyword={keyword}
              getSender={getSender}
              menuOpen={openFileMenuId === item.id}
              onMenuOpenChange={(open) => {
                if (open) {
                  setFilterOpen(false);
                }
                setOpenFileMenuId(open ? item.id : null);
              }}
              onLocate={handleLocate}
              onPreviewFile={onPreviewFile}
            />
          ))}
        </div>
      );
    }
    return (
      <div className="wk-channel-search-result-list">
        {response.items.map((item) => (
          <MixedResultItem
            key={item.id}
            item={item}
            keyword={keyword}
            getSender={getSender}
            onLocate={handleLocate}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="wk-channel-search-panel">
      <div className="wk-channel-search-header">
        <div className="wk-channel-search-input-wrap">
          <Zap
            className="wk-channel-search-zap"
            size={18}
            fill="currentColor"
          />
          <input
            value={keyword}
            placeholder={t("base.channelSearch.placeholder")}
            autoFocus
            onCompositionStart={() => {
              setIsComposing(true);
            }}
            onCompositionEnd={(event) => {
              setIsComposing(false);
              setKeyword(event.currentTarget.value);
            }}
            onChange={(event) => {
              setKeyword(event.currentTarget.value);
            }}
          />
        </div>
        <IconClick
          size="sm"
          icon={<X size={18} />}
          title={t("base.channelSearch.close")}
          onClick={onClose}
        />
      </div>

      <div className="wk-channel-search-tabs-row">
        <div className="wk-channel-search-tabs">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? "is-active" : undefined}
              onClick={() => setActiveTab(tab)}
            >
              {t(tabI18nKey[tab])}
            </button>
          ))}
        </div>
        <div className="wk-channel-search-filter-wrap">
          <button
            className="wk-channel-search-filter-trigger"
            type="button"
            onClick={toggleFilterOpen}
          >
            <Filter size={16} fill="currentColor" />
            {t("base.channelSearch.filter.title")}
            {filterCount > 0 && <span>{filterCount}</span>}
          </button>
          <FilterPopover
            open={filterOpen}
            filters={filters}
            dataSource={dataSource}
            onApply={setFilters}
            onClose={() => setFilterOpen(false)}
          />
        </div>
      </div>

      <div className="wk-channel-search-content">
        {activeTab === "media" && (
          <div className="wk-channel-search-media-tip">
            {t("base.channelSearch.mediaKeywordTip")}
          </div>
        )}
        {renderResults()}
        {response.hasMore && !loading && (
          <div className="wk-channel-search-load-more">
            <WKButton
              size="sm"
              variant="secondary"
              loading={loadingMore}
              onClick={() => void runSearch(response.nextCursor)}
            >
              {t("base.channelSearch.loadMore")}
            </WKButton>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChannelSearchPanel;
export { ChannelSearchPanel };
