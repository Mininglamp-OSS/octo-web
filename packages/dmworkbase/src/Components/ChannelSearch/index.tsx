import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DatePicker, Toast, Tooltip } from "@douyinfe/semi-ui";
import {
  CalendarDays,
  ChevronDown,
  Download,
  Filter,
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
import { downloadFile } from "../../Utils/download";
import { useI18n } from "../../i18n";
import { getRichTextBlocksUI } from "../../bridge/message/useRichTextMessageUI";
import MixedContent from "../../ui/message/MixedContent";
import type { MixedContentBlock } from "../../ui/message/MixedContent";
import { channelSearchEmptyDataSource } from "./adapter";
import {
  CHANNEL_SEARCH_KEYWORD_MAX_RUNES,
  countChannelSearchKeywordRunes,
  shouldRunSearch,
  truncateChannelSearchKeyword,
} from "./apiAdapter";
import { resolveChannelSearchFileIconSrc } from "./fileIcon";
import {
  FORWARD_INNER_MESSAGE_DISPLAY_LIMIT,
  formatForwardInnerMessage,
  getForwardInnerMessageHiddenCount,
} from "./forwardInnerMessage";
import { activeChannelSearchFilterCount } from "./filterState";
import {
  canLocateChannelSearchItem,
  resolveChannelSearchLocateTarget,
} from "./locate";
import {
  isNearChannelSearchScrollBottom,
  shouldPauseAutoPaginationForEmptyPage,
  shouldStopPaginationForCursor,
} from "./pagination";
import ChannelSearchSnippetContent from "./snippetContent";
import { defaultChannelSearchFilters } from "./types";
import type {
  ChannelSearchDataSource,
  ChannelSearchFilters,
  ChannelSearchItem,
  ChannelSearchPanelState,
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
  onPreviewMedia?: (item: ChannelSearchItem) => void;
  initialState?: ChannelSearchPanelState;
  onStateChange?: (state: ChannelSearchPanelState) => void;
}

const tabs: ChannelSearchTab[] = ["all", "message", "media", "file"];
const SEARCH_DEBOUNCE_MS = 300;

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

function useOutsideDismiss(
  open: boolean,
  getContainers: () => Array<HTMLElement | null | undefined>,
  onDismiss: () => void,
  shouldIgnoreTarget?: (target: Node) => boolean
) {
  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (getContainers().some((element) => element?.contains(target))) {
        return;
      }
      if (shouldIgnoreTarget?.(target)) return;
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
  }, [getContainers, onDismiss, open, shouldIgnoreTarget]);
}

const SenderAvatar: React.FC<{
  uid: string;
  sender?: ChannelSearchSender;
  getSender: GetChannelSearchSender;
}> = ({ uid, sender, getSender }) => {
  const resolvedSender = sender || getSender(uid);
  return (
    <WKAvatar
      src={resolvedSender.avatarUrl || WKApp.shared.avatarUser(uid)}
      style={{ width: "24px", height: "24px" }}
      lazy
    />
  );
};

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

type ResultItemProps = {
  item: ChannelSearchItem;
  keyword: string;
  getSender: GetChannelSearchSender;
  onLocate: (item: ChannelSearchItem) => void;
  onPreviewMedia?: (item: ChannelSearchItem) => void;
};

type LocateToChatIconProps = {
  size?: number;
};

const LocateToChatIcon = React.memo(function LocateToChatIcon({
  size = 16,
}: LocateToChatIconProps) {
  return (
    <svg
      aria-hidden="true"
      className="wk-channel-search-locate-icon"
      fill="none"
      focusable="false"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        clipRule="evenodd"
        d="M14.3333 1.66675H3.66658V3.00008H12.9999V13.0001H3.66659V14.3334H14.3333V1.66675Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path
        d="M6.88572 11.496L5.94291 10.5532L7.82889 8.66726L1.39062 8.66726L1.39062 7.33393L7.82817 7.33393L5.94291 5.44867L6.88572 4.50586L10.3808 8.00095L6.88572 11.496Z"
        fill="currentColor"
      />
    </svg>
  );
});

type LocateIconButtonProps = {
  className: string;
  iconSize?: number;
  onClick: () => void;
};

const LocateIconButton = React.memo(function LocateIconButton({
  className,
  iconSize,
  onClick,
}: LocateIconButtonProps) {
  const { t } = useI18n();
  const label = t("base.channelSearch.locateToChatPosition");

  return (
    <Tooltip content={label} position="top">
      <button
        aria-label={label}
        className={className}
        type="button"
        onClick={onClick}
      >
        <LocateToChatIcon size={iconSize} />
      </button>
    </Tooltip>
  );
});

const RichTextResultContent = React.memo(function RichTextResultContent({
  item,
  keyword,
}: {
  item: ChannelSearchItem;
  keyword: string;
}) {
  const { t } = useI18n();
  const richText = item.richText;
  const blocks = useMemo(() => {
    return getRichTextBlocksUI(richText?.content || [], {
      entities: richText?.mention?.entities || [],
      syntheticMentions: [],
    });
  }, [richText]);
  const showMatchReason =
    !!keyword.trim() &&
    !!item.matchReason &&
    item.matchReason !== richText?.plain;

  const handleFileDownload = useCallback(
    async (block: Extract<MixedContentBlock, { type: "file" }>) => {
      if (!block.url) {
        Toast.warning(t("base.channelSearch.downloadUnavailable"));
        return;
      }
      try {
        await downloadFile(block.url, block.name);
      } catch (_) {
        Toast.error(t("base.channelSearch.downloadFailed"));
      }
    },
    [t]
  );

  if (blocks.length === 0) {
    return (
      <div className="wk-channel-search-result-text">
        <ChannelSearchSnippetContent text={item.text} keyword={keyword} />
      </div>
    );
  }

  return (
    <>
      {showMatchReason && (
        <div className="wk-channel-search-match-reason">
          <ChannelSearchSnippetContent
            text={item.matchReason}
            keyword={keyword}
          />
        </div>
      )}
      <div className="wk-channel-search-richtext-preview">
        <MixedContent blocks={blocks} onFileDownload={handleFileDownload} />
      </div>
    </>
  );
});

const MessageResultItem = React.memo(function MessageResultItem({
  item,
  keyword,
  getSender,
  onLocate,
}: ResultItemProps) {
  const { format, t } = useI18n();
  const sender = resolveSender(item, getSender);
  const isForward = item.kind === "merge_forward";
  const forwardInnerMessages = item.forward?.innerMessages || [];
  const visibleForwardInnerMessages = forwardInnerMessages.slice(
    0,
    FORWARD_INNER_MESSAGE_DISPLAY_LIMIT
  );
  const hiddenForwardInnerMessageCount = getForwardInnerMessageHiddenCount(
    forwardInnerMessages.length,
    visibleForwardInnerMessages.length,
    item.forward?.childCount
  );
  const forwardMatchReason =
    isForward && keyword.trim()
      ? t("base.channelSearch.forward.matchReason", {
          values: { keyword: keyword.trim() },
        })
      : item.matchReason;

  return (
    <div className="wk-channel-search-result wk-channel-search-message-result">
      <SenderAvatar
        uid={item.senderUid}
        sender={item.sender}
        getSender={getSender}
      />
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
              <ChannelSearchSnippetContent
                text={forwardMatchReason}
                keyword={keyword}
              />
            </div>
            <div className="wk-channel-search-forward-card">
              <div className="wk-channel-search-forward-title">
                <ChannelSearchSnippetContent
                  text={
                    item.forward?.title ||
                    t("base.channelSearch.forward.defaultTitle")
                  }
                  keyword={keyword}
                />
              </div>
              {visibleForwardInnerMessages.map((message, index) => (
                <div
                  key={`${message.messageId || "inner"}-${index}`}
                  className="wk-channel-search-forward-snippet"
                >
                  <ChannelSearchSnippetContent
                    text={formatForwardInnerMessage(message, getSender, t)}
                    keyword={keyword}
                  />
                </div>
              ))}
              {hiddenForwardInnerMessageCount > 0 && (
                <div className="wk-channel-search-forward-snippet">
                  {t("base.channelSearch.forward.more", {
                    values: { count: hiddenForwardInnerMessageCount },
                  })}
                </div>
              )}
              {visibleForwardInnerMessages.length === 0 &&
                item.forward?.snippets.map((snippet) => (
                  <div
                    key={snippet}
                    className="wk-channel-search-forward-snippet"
                  >
                    <ChannelSearchSnippetContent
                      text={snippet}
                      keyword={keyword}
                    />
                  </div>
                ))}
              {visibleForwardInnerMessages.length === 0 &&
                item.forward?.snippets.length === 0 &&
                !!item.forward?.childCount && (
                  <div className="wk-channel-search-forward-snippet">
                    {t("base.channelSearch.forward.childCount", {
                      values: { count: item.forward.childCount },
                    })}
                  </div>
                )}
            </div>
          </>
        ) : (
          <RichTextResultContent item={item} keyword={keyword} />
        )}
      </div>
      {canLocateChannelSearchItem(item) && (
        <button
          className="wk-channel-search-locate-action"
          type="button"
          onClick={() => onLocate(item)}
        >
          {t("base.channelSearch.locateToChat")}
        </button>
      )}
    </div>
  );
});

const MixedResultItem = React.memo(function MixedResultItem({
  item,
  keyword,
  getSender,
  onLocate,
  onPreviewMedia,
}: ResultItemProps) {
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
        onPreviewMedia={onPreviewMedia}
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
});

const MediaInlineResult = React.memo(function MediaInlineResult({
  item,
  keyword,
  getSender,
  onLocate,
  onPreviewMedia,
}: ResultItemProps) {
  const { format, t } = useI18n();
  const sender = resolveSender(item, getSender);
  return (
    <div className="wk-channel-search-result wk-channel-search-media-inline">
      <SenderAvatar
        uid={item.senderUid}
        sender={item.sender}
        getSender={getSender}
      />
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
          <ChannelSearchSnippetContent
            text={item.matchReason}
            keyword={keyword}
          />
        </div>
        <MediaThumb
          item={item}
          onLocate={onLocate}
          onPreviewMedia={onPreviewMedia}
          compact
        />
      </div>
      {canLocateChannelSearchItem(item) && (
        <button
          className="wk-channel-search-locate-action"
          type="button"
          onClick={() => onLocate(item)}
        >
          {t("base.channelSearch.locateToChat")}
        </button>
      )}
    </div>
  );
});

type MediaThumbProps = {
  item: ChannelSearchItem;
  onLocate: (item: ChannelSearchItem) => void;
  onPreviewMedia?: (item: ChannelSearchItem) => void;
  compact?: boolean;
};

const MediaThumb = React.memo(function MediaThumb({
  item,
  onLocate,
  onPreviewMedia,
  compact = false,
}: MediaThumbProps) {
  const { t } = useI18n();
  const thumbUrl = compact
    ? item.media?.inlineThumbUrl || item.media?.thumbUrl
    : item.media?.thumbUrl;
  const previewLabel = t("base.filePreview.preview");
  const canPreviewMedia =
    !!onPreviewMedia &&
    !!(
      item.media?.previewUrl ||
      item.media?.url ||
      item.media?.downloadUrl ||
      (item.kind === "image" && item.media?.thumbUrl)
    );

  return (
    <div
      className={[
        "wk-channel-search-media-thumb",
        `wk-channel-search-media-thumb--${item.media?.tone || "warm"}`,
        thumbUrl ? "wk-channel-search-media-thumb--image" : "",
        canPreviewMedia ? "wk-channel-search-media-thumb--previewable" : "",
        compact ? "wk-channel-search-media-thumb--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {thumbUrl && (
        <img
          alt=""
          className="wk-channel-search-media-thumb-img"
          draggable={false}
          src={thumbUrl}
        />
      )}
      {canPreviewMedia && (
        <button
          aria-label={previewLabel}
          className="wk-channel-search-media-preview-trigger"
          title={previewLabel}
          type="button"
          onClick={() => onPreviewMedia(item)}
        />
      )}
      {item.kind === "video" && (
        <div className="wk-channel-search-media-play">
          <Play size={18} fill="currentColor" />
        </div>
      )}
      {canLocateChannelSearchItem(item) && (
        <LocateIconButton
          className="wk-channel-search-media-locate"
          iconSize={16}
          onClick={() => onLocate(item)}
        />
      )}
    </div>
  );
});

const FileInlineResult = React.memo(function FileInlineResult({
  item,
  keyword,
  getSender,
  onLocate,
}: ResultItemProps) {
  const { format, t } = useI18n();
  const sender = resolveSender(item, getSender);
  const fileName = item.file?.name || t("base.conversation.file.unknown");
  const inlineFileName = fileName.replace(/\.[^.]+$/, "");
  const fileIconSrc = resolveChannelSearchFileIconSrc(
    fileName,
    item.file?.extension
  );

  return (
    <div className="wk-channel-search-result wk-channel-search-file-inline">
      <SenderAvatar
        uid={item.senderUid}
        sender={item.sender}
        getSender={getSender}
      />
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
            <img src={fileIconSrc} alt="" />
          </div>
          <div className="wk-channel-search-inline-file-body">
            <div className="wk-channel-search-inline-file-name">
              <ChannelSearchSnippetContent
                text={inlineFileName}
                keyword={keyword}
              />
            </div>
            <div className="wk-channel-search-inline-file-size">
              {compactFileSize(item.file?.size || 0)}
            </div>
          </div>
        </div>
      </div>
      {canLocateChannelSearchItem(item) && (
        <button
          className="wk-channel-search-locate-action"
          type="button"
          onClick={() => onLocate(item)}
        >
          {t("base.channelSearch.locateToChat")}
        </button>
      )}
    </div>
  );
});

type MediaResultGridProps = {
  items: ChannelSearchItem[];
  onLocate: (item: ChannelSearchItem) => void;
  onPreviewMedia?: (item: ChannelSearchItem) => void;
};

const MediaResultGrid = React.memo(function MediaResultGrid({
  items,
  onLocate,
  onPreviewMedia,
}: MediaResultGridProps) {
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
              <MediaThumb
                key={item.id}
                item={item}
                onLocate={onLocate}
                onPreviewMedia={onPreviewMedia}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
});

type FileResultItemProps = {
  item: ChannelSearchItem;
  keyword: string;
  getSender: GetChannelSearchSender;
  menuOpen: boolean;
  onMenuOpenChange: (itemId: string, open: boolean) => void;
  onLocate: (item: ChannelSearchItem) => void;
  onPreviewFile?: (item: ChannelSearchItem) => void;
};

const FileResultItem = React.memo(function FileResultItem({
  item,
  keyword,
  getSender,
  menuOpen,
  onMenuOpenChange,
  onLocate,
  onPreviewFile,
}: FileResultItemProps) {
  const { format, t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const sender = resolveSender(item, getSender);
  const fileName = item.file?.name || t("base.conversation.file.unknown");
  const fileIconSrc = resolveChannelSearchFileIconSrc(
    fileName,
    item.file?.extension
  );

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

  const getFileMenuDismissContainers = useCallback(() => [menuRef.current], []);
  const closeFileMenu = useCallback(() => {
    onMenuOpenChange(item.id, false);
  }, [item.id, onMenuOpenChange]);
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
      <div className="wk-channel-search-file-icon">
        <img src={fileIconSrc} alt="" />
      </div>
      <div className="wk-channel-search-file-body">
        <div className="wk-channel-search-file-name">
          <ChannelSearchSnippetContent text={fileName} keyword={keyword} />
        </div>
        <div className="wk-channel-search-file-meta">
          <span>{sender.name}</span>
          <span>{compactFileSize(item.file?.size || 0)}</span>
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
          onClick={() => onMenuOpenChange(item.id, !menuOpen)}
        />
        {menuOpen && (
          <div className="wk-channel-search-file-menu">
            {canLocateChannelSearchItem(item) && (
              <button
                type="button"
                onClick={() => {
                  onMenuOpenChange(item.id, false);
                  onLocate(item);
                }}
              >
                <LocateToChatIcon size={14} />
                {t("base.channelSearch.locateToChatPosition")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onMenuOpenChange(item.id, false);
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
});

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
  onPreviewMedia,
  initialState,
  onStateChange,
}) => {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState(() =>
    truncateChannelSearchKeyword(initialState?.keyword || "")
  );
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
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const [autoPaginationPaused, setAutoPaginationPaused] = useState(false);
  const requestIdRef = useRef(0);
  const loadingMoreCursorRef = useRef<string | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const keywordLimitToastShownRef = useRef(false);
  const isComposingRef = useRef(false);
  const [isComposing, setIsComposing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const filterWrapRef = useRef<HTMLDivElement>(null);

  const filterCount = activeChannelSearchFilterCount(filters);
  const keywordRuneCount = countChannelSearchKeywordRunes(keyword);
  const keywordAtLimit =
    !isComposing && keywordRuneCount >= CHANNEL_SEARCH_KEYWORD_MAX_RUNES;
  const canSearch = shouldRunSearch({ keyword, filters, tab: activeTab });
  const getSender = useCallback(
    (uid: string) => dataSource.getSender(uid),
    [dataSource]
  );
  const getFilterDismissContainers = useCallback(
    () => [filterWrapRef.current],
    []
  );
  const closeFilterPopover = useCallback(() => {
    setFilterOpen(false);
  }, []);
  const updateKeyword = useCallback(
    (value: string) => {
      const runeCount = countChannelSearchKeywordRunes(value);
      const exceedsLimit = runeCount > CHANNEL_SEARCH_KEYWORD_MAX_RUNES;

      if (exceedsLimit && !keywordLimitToastShownRef.current) {
        Toast.warning(
          t("base.channelSearch.keywordLimitToast", {
            values: { count: CHANNEL_SEARCH_KEYWORD_MAX_RUNES },
          })
        );
        keywordLimitToastShownRef.current = true;
      }
      if (!exceedsLimit && runeCount < CHANNEL_SEARCH_KEYWORD_MAX_RUNES) {
        keywordLimitToastShownRef.current = false;
      }

      setKeyword(truncateChannelSearchKeyword(value));
    },
    [t]
  );
  const shouldKeepSemiPopupOpen = useCallback((target: Node) => {
    return (
      target instanceof Element &&
      !!target.closest(".semi-datepicker, .semi-popover, .semi-portal")
    );
  }, []);

  useOutsideDismiss(
    filterOpen,
    getFilterDismissContainers,
    closeFilterPopover,
    shouldKeepSemiPopupOpen
  );

  useEffect(() => {
    onStateChange?.({
      activeTab,
      filterOpen,
      filters,
      keyword,
    });
  }, [activeTab, filterOpen, filters, keyword, onStateChange]);

  const runSearch = useCallback(
    async (cursor?: string) => {
      if (isComposing) {
        return;
      }
      if (cursor && loadingMoreCursorRef.current === cursor) {
        return;
      }

      // Empty all/message searches are only sent once keyword or filters exist.
      // Media/file tabs browse without a keyword, which shouldRunSearch encodes.
      if (!shouldRunSearch({ keyword, filters, tab: activeTab })) {
        return;
      }

      loadingMoreCursorRef.current = cursor || null;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setQueryStarted(true);
      if (cursor) {
        setPaginationError(null);
        setLoadingMore(true);
      } else {
        setError(null);
        setPaginationError(null);
        setAutoPaginationPaused(false);
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
        const stopPagination = shouldStopPaginationForCursor({
          hasMore: next.hasMore,
          nextCursor: next.nextCursor,
          requestedCursor: cursor,
        });
        const pauseAutoPagination = shouldPauseAutoPaginationForEmptyPage({
          hasMore: next.hasMore,
          itemCount: next.items.length,
          nextCursor: next.nextCursor,
          requestedCursor: cursor,
        });
        setAutoPaginationPaused(pauseAutoPagination);
        setResponse((prev) => ({
          items: cursor ? [...prev.items, ...next.items] : next.items,
          nextCursor: stopPagination ? undefined : next.nextCursor,
          hasMore: stopPagination ? false : next.hasMore,
        }));
      } catch (_) {
        if (requestIdRef.current === requestId) {
          const message = t("base.channelSearch.searchFailed");
          if (cursor) {
            setPaginationError(message);
          } else {
            setError(message);
          }
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
          if (loadingMoreCursorRef.current === cursor) {
            loadingMoreCursorRef.current = null;
          }
        }
      }
    },
    [activeTab, channel, dataSource, filters, isComposing, keyword, t]
  );

  const loadNextPage = useCallback(
    (force = false) => {
      if (loading || loadingMore || !response.hasMore || !response.nextCursor) {
        return;
      }
      if ((paginationError || autoPaginationPaused) && !force) {
        return;
      }
      void runSearch(response.nextCursor);
    },
    [
      autoPaginationPaused,
      loading,
      loadingMore,
      paginationError,
      response.hasMore,
      response.nextCursor,
      runSearch,
    ]
  );

  const maybeLoadNextPageFromScroll = useCallback(
    (content: HTMLElement) => {
      if (isNearChannelSearchScrollBottom(content)) {
        loadNextPage();
      }
    },
    [loadNextPage]
  );

  const handleContentScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const content = event.currentTarget;
      if (typeof window.requestAnimationFrame !== "function") {
        maybeLoadNextPageFromScroll(content);
        return;
      }
      if (scrollFrameRef.current !== null) {
        return;
      }
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        maybeLoadNextPageFromScroll(content);
      });
    },
    [maybeLoadNextPageFromScroll]
  );

  useEffect(() => {
    return () => {
      if (
        scrollFrameRef.current !== null &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isComposing) return;
    requestIdRef.current += 1;
    loadingMoreCursorRef.current = null;
    setResponse({ items: [], hasMore: false });
    setLoadingMore(false);
    setError(null);
    setPaginationError(null);
    setAutoPaginationPaused(false);

    // Keep the initial prompt until an all/message search has a keyword or a
    // real filter. Media/file tabs can browse immediately.
    if (!canSearch) {
      setQueryStarted(false);
      setLoading(false);
      return;
    }

    setQueryStarted(true);
    setLoading(true);

    const timer = window.setTimeout(() => {
      void runSearch();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [canSearch, isComposing, runSearch]);

  // User scrolls and this first-screen top-up effect share the same load guard.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    maybeLoadNextPageFromScroll(content);
  }, [activeTab, maybeLoadNextPageFromScroll, response.items.length]);

  const handleLocate = useCallback(
    (item: ChannelSearchItem) => {
      const locateTarget = resolveChannelSearchLocateTarget(item, channel);
      if (!locateTarget) {
        return;
      }
      if (onLocateMessage) {
        onLocateMessage(item);
        return;
      }
      if (!locateTarget.isCurrentChannel || !conversationContext) {
        WKApp.endpoints.showConversation(locateTarget.channel, {
          initLocateMessageSeq: locateTarget.messageSeq,
        });
        return;
      }
      conversationContext.locateMessage(locateTarget.messageSeq);
    },
    [channel, conversationContext, onLocateMessage]
  );

  const toggleFilterOpen = () => {
    setOpenFileMenuId(null);
    setFilterOpen((open) => !open);
  };
  const handleFileMenuOpenChange = useCallback(
    (itemId: string, open: boolean) => {
      if (open) {
        setFilterOpen(false);
      }
      setOpenFileMenuId(open ? itemId : null);
    },
    []
  );

  const renderResults = () => {
    if (loading) {
      return (
        <div className="wk-channel-search-loading">
          {t("base.channelSearch.loading")}
        </div>
      );
    }
    if (error && response.items.length === 0) {
      return <div className="wk-channel-search-error">{error}</div>;
    }
    if (!queryStarted || response.items.length === 0) {
      return <SearchEmpty queryStarted={queryStarted} />;
    }
    if (activeTab === "media") {
      return (
        <MediaResultGrid
          items={response.items}
          onLocate={handleLocate}
          onPreviewMedia={onPreviewMedia}
        />
      );
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
              onMenuOpenChange={handleFileMenuOpenChange}
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
            onPreviewMedia={onPreviewMedia}
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
              isComposingRef.current = true;
              setIsComposing(true);
            }}
            onCompositionEnd={(event) => {
              isComposingRef.current = false;
              setIsComposing(false);
              updateKeyword(event.currentTarget.value);
            }}
            onChange={(event) => {
              const nextKeyword = event.currentTarget.value;
              if (isComposingRef.current) {
                setKeyword(nextKeyword);
                return;
              }
              updateKeyword(nextKeyword);
            }}
          />
        </div>
        {keywordAtLimit && (
          <div
            className="wk-channel-search-keyword-limit"
            role="status"
            aria-live="polite"
          >
            {t("base.channelSearch.keywordLimitHint", {
              values: { count: CHANNEL_SEARCH_KEYWORD_MAX_RUNES },
            })}
          </div>
        )}
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
        <div className="wk-channel-search-filter-wrap" ref={filterWrapRef}>
          <button
            className="wk-channel-search-filter-trigger"
            type="button"
            onClick={toggleFilterOpen}
          >
            <Filter size={16} />
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

      <div
        className="wk-channel-search-content"
        ref={contentRef}
        onScroll={handleContentScroll}
      >
        {activeTab === "media" && (
          <div className="wk-channel-search-media-tip">
            {t("base.channelSearch.mediaKeywordTip")}
          </div>
        )}
        {renderResults()}
        {loadingMore && (
          <div className="wk-channel-search-load-more" role="status">
            {t("base.channelSearch.loading")}
          </div>
        )}
        {paginationError && response.items.length > 0 && (
          <div className="wk-channel-search-load-more wk-channel-search-load-more--error">
            <span>{paginationError}</span>
            <button type="button" onClick={() => loadNextPage(true)}>
              {t("base.channelSearch.loadMore")}
            </button>
          </div>
        )}
        {autoPaginationPaused &&
          !paginationError &&
          !loadingMore &&
          response.hasMore && (
            <div className="wk-channel-search-load-more">
              <button type="button" onClick={() => loadNextPage(true)}>
                {t("base.channelSearch.loadMore")}
              </button>
            </div>
          )}
      </div>
    </div>
  );
};

export default ChannelSearchPanel;
export {
  ChannelSearchPanel,
  MixedResultItem,
  FileResultItem,
  MediaResultGrid,
  SearchEmpty as ChannelSearchEmpty,
};
