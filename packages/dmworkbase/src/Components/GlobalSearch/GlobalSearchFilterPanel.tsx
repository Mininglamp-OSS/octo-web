import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DatePicker } from "@douyinfe/semi-ui";
import { CalendarDays, X } from "lucide-react";
import { useI18n } from "../../i18n";
import type { ChannelSearchSender } from "../ChannelSearch/types";
import type {
  GlobalContentTab,
  GlobalSearchChannelOption,
  GlobalSearchDataSource,
  GlobalSearchFileTypeCategory,
  GlobalSearchFilters,
} from "./types";

interface Props {
  tab: GlobalContentTab;
  keyword: string;
  filters: GlobalSearchFilters;
  dataSource: GlobalSearchDataSource;
  onApply: (filters: GlobalSearchFilters) => void;
  onClose: () => void;
}

// Day-boundary helpers use the browser tz for the picker widget itself;
// serialization back to the wire is CN-tz-aware in apiAdapter.ts.
function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
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

const MESSAGE_TYPE_OPTIONS: {
  value: number;
  labelKey: string;
  browseOnly?: boolean;
}[] = [
  { value: 1, labelKey: "base.globalSearch.filter.contentType.text" },
  { value: 14, labelKey: "base.globalSearch.filter.contentType.richText" },
  { value: 8, labelKey: "base.globalSearch.filter.contentType.file" },
  { value: 11, labelKey: "base.globalSearch.filter.contentType.mergeForward" },
  {
    value: 2,
    labelKey: "base.globalSearch.filter.contentType.image",
    browseOnly: true,
  },
  {
    value: 5,
    labelKey: "base.globalSearch.filter.contentType.video",
    browseOnly: true,
  },
];

const GlobalSearchFilterPanel: React.FC<Props> = ({
  tab,
  keyword,
  filters,
  dataSource,
  onApply,
  onClose,
}) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState<GlobalSearchFilters>(filters);
  const [senderQuery, setSenderQuery] = useState("");
  const [senderOptions, setSenderOptions] = useState<ChannelSearchSender[]>(
    () => dataSource.getSenders().filter((s) => s.uid !== dataSource.getSelfUid())
  );
  const [channelQuery, setChannelQuery] = useState("");
  const [channelOptions, setChannelOptions] = useState<
    GlobalSearchChannelOption[]
  >([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberOptions, setMemberOptions] = useState<ChannelSearchSender[]>([]);
  const [fileCategories, setFileCategories] = useState<
    GlobalSearchFileTypeCategory[]
  >([]);
  const [fileSizeMinInput, setFileSizeMinInput] = useState(
    filters.fileSizeMin ? String(Math.round(filters.fileSizeMin / 1024)) : ""
  );
  const [fileSizeMaxInput, setFileSizeMaxInput] = useState(
    filters.fileSizeMax ? String(Math.round(filters.fileSizeMax / 1024)) : ""
  );

  const keywordActive = keyword.trim().length > 0;
  const selfUid = dataSource.getSelfUid();

  // Load sender candidates on open + when query changes (debounced light).
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const list = (await dataSource.searchSenders?.(senderQuery)) ?? [];
        if (cancelled) return;
        setSenderOptions(list.filter((s) => s.uid !== selfUid));
      } catch (_) {
        if (!cancelled) setSenderOptions([]);
      }
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [dataSource, senderQuery, selfUid]);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const list = (await dataSource.searchChannels?.(channelQuery)) ?? [];
        if (cancelled) return;
        setChannelOptions(list);
      } catch (_) {
        if (!cancelled) setChannelOptions([]);
      }
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [dataSource, channelQuery]);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const list = (await dataSource.searchSenders?.(memberQuery)) ?? [];
        if (cancelled) return;
        setMemberOptions(list.filter((s) => s.uid !== selfUid));
      } catch (_) {
        if (!cancelled) setMemberOptions([]);
      }
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [dataSource, memberQuery, selfUid]);

  useEffect(() => {
    if (tab !== "files") return;
    let cancelled = false;
    dataSource
      .getFileTypeCategories()
      .then((list) => {
        if (!cancelled) setFileCategories(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dataSource, tab]);

  const toggleSender = (uid: string) => {
    setDraft((cur) => {
      const has = cur.senderUids.includes(uid);
      return {
        ...cur,
        senderUids: has
          ? cur.senderUids.filter((x) => x !== uid)
          : [...cur.senderUids, uid],
      };
    });
  };

  const toggleChannel = (opt: GlobalSearchChannelOption) => {
    setDraft((cur) => {
      const has = cur.channels.some(
        (c) => c.channelId === opt.channelId && c.channelType === opt.channelType
      );
      return {
        ...cur,
        channels: has
          ? cur.channels.filter(
              (c) =>
                !(
                  c.channelId === opt.channelId &&
                  c.channelType === opt.channelType
                )
            )
          : [
              ...cur.channels,
              { channelId: opt.channelId, channelType: opt.channelType },
            ],
      };
    });
  };

  const toggleChannelTypeGroup = (values: number[]) => {
    setDraft((cur) => {
      const activeSet = new Set(cur.channelTypes);
      const allActive = values.every((v) => activeSet.has(v));
      const next = allActive
        ? cur.channelTypes.filter((x) => !values.includes(x))
        : Array.from(new Set([...cur.channelTypes, ...values]));
      return { ...cur, channelTypes: next };
    });
  };

  const toggleContentType = (value: number) => {
    setDraft((cur) => {
      const has = cur.contentTypes.includes(value);
      return {
        ...cur,
        contentTypes: has
          ? cur.contentTypes.filter((x) => x !== value)
          : [...cur.contentTypes, value],
      };
    });
  };

  const toggleFileExts = (category: GlobalSearchFileTypeCategory) => {
    setDraft((cur) => {
      const set = new Set(cur.fileExts);
      const allActive = category.exts.every((e) =>
        set.has(e.toLowerCase())
      );
      if (allActive) {
        category.exts.forEach((e) => set.delete(e.toLowerCase()));
      } else {
        category.exts.forEach((e) => set.add(e.toLowerCase()));
      }
      return { ...cur, fileExts: Array.from(set) };
    });
  };

  const setDatePreset = (
    preset: GlobalSearchFilters["datePreset"] | undefined
  ) => {
    if (!preset) {
      setDraft((cur) => ({
        ...cur,
        datePreset: undefined,
        startAt: undefined,
        endAt: undefined,
      }));
      return;
    }
    const now = new Date();
    let start = startOfDay(now);
    if (preset === "last_7_days") {
      start = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
    } else if (preset === "last_30_days") {
      start = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
    }
    setDraft((cur) => ({
      ...cur,
      datePreset: preset,
      startAt: toSeconds(start),
      endAt: toSeconds(endOfDay(now)),
    }));
  };

  const setCustomDate = (
    field: "startAt" | "endAt",
    value?: Date | Date[] | string | string[] | null
  ) => {
    const date = datePickerValueToDate(value);
    const nextSeconds = date
      ? toSeconds(field === "startAt" ? startOfDay(date) : endOfDay(date))
      : undefined;
    setDraft((cur) => ({
      ...cur,
      datePreset: undefined,
      [field]: nextSeconds,
    }));
  };

  const setMemberUid = (uid?: string) => {
    if (uid === selfUid) return;
    setDraft((cur) => ({ ...cur, memberUid: uid || undefined }));
  };

  const clearAll = () => {
    setDraft({
      senderUids: [],
      channels: [],
      channelTypes: [],
      contentTypes: [],
      fileExts: [],
      sort: "time_desc",
    });
    setFileSizeMinInput("");
    setFileSizeMaxInput("");
  };

  const apply = () => {
    // KB inputs -> bytes for the wire.
    const minKb = parseInt(fileSizeMinInput, 10);
    const maxKb = parseInt(fileSizeMaxInput, 10);
    const next: GlobalSearchFilters = {
      ...draft,
      fileSizeMin:
        Number.isFinite(minKb) && minKb > 0 ? minKb * 1024 : undefined,
      fileSizeMax:
        Number.isFinite(maxKb) && maxKb > 0 ? maxKb * 1024 : undefined,
    };
    onApply(next);
    onClose();
  };

  const channelTypesDMActive = useMemo(
    () => draft.channelTypes.includes(1),
    [draft.channelTypes]
  );
  const channelTypesGroupActive = useMemo(
    () => draft.channelTypes.includes(2) || draft.channelTypes.includes(5),
    [draft.channelTypes]
  );

  const senderIsSelected = useCallback(
    (uid: string) => draft.senderUids.includes(uid),
    [draft.senderUids]
  );
  const channelIsSelected = useCallback(
    (opt: GlobalSearchChannelOption) =>
      draft.channels.some(
        (c) => c.channelId === opt.channelId && c.channelType === opt.channelType
      ),
    [draft.channels]
  );
  const fileCategoryIsActive = useCallback(
    (cat: GlobalSearchFileTypeCategory) =>
      cat.exts.every((e) => draft.fileExts.includes(e.toLowerCase())),
    [draft.fileExts]
  );

  return (
    <div
      className="wk-global-search-filter-panel"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="wk-global-search-filter-section">
        <div className="wk-global-search-filter-title">
          {t("base.channelSearch.filter.sender")}
        </div>
        <input
          className="wk-global-search-filter-search"
          value={senderQuery}
          onChange={(e) => setSenderQuery(e.target.value)}
          placeholder={t("base.channelSearch.filter.senderPlaceholder")}
        />
        <div className="wk-global-search-filter-chip-row">
          {senderOptions.slice(0, 30).map((sender) => {
            const active = senderIsSelected(sender.uid);
            return (
              <button
                key={sender.uid}
                type="button"
                className={`wk-global-search-filter-chip${
                  active ? " is-active" : ""
                }`}
                onClick={() => toggleSender(sender.uid)}
              >
                {sender.name}
                {active && <X size={12} />}
              </button>
            );
          })}
          {senderOptions.length === 0 && (
            <span className="wk-global-search-filter-help">
              {t("base.channelSearch.filter.senderPlaceholder")}
            </span>
          )}
        </div>
      </div>

      <div className="wk-global-search-filter-section">
        <div className="wk-global-search-filter-title">
          {t("base.globalSearch.filter.channels") || "所在群聊"}
        </div>
        <input
          className="wk-global-search-filter-search"
          value={channelQuery}
          onChange={(e) => setChannelQuery(e.target.value)}
          placeholder=""
        />
        <div className="wk-global-search-filter-chip-row">
          {channelOptions.slice(0, 30).map((opt) => {
            const active = channelIsSelected(opt);
            return (
              <button
                key={`${opt.channelType}:${opt.channelId}`}
                type="button"
                className={`wk-global-search-filter-chip${
                  active ? " is-active" : ""
                }`}
                onClick={() => toggleChannel(opt)}
              >
                {opt.name}
                {active && <X size={12} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="wk-global-search-filter-section">
        <div className="wk-global-search-filter-title">
          {t("base.globalSearch.filter.memberUid") || "包含成员"}
        </div>
        <input
          className="wk-global-search-filter-search"
          value={memberQuery}
          onChange={(e) => setMemberQuery(e.target.value)}
          placeholder=""
        />
        <div className="wk-global-search-filter-chip-row">
          {memberOptions.slice(0, 30).map((m) => {
            const active = draft.memberUid === m.uid;
            return (
              <button
                key={m.uid}
                type="button"
                className={`wk-global-search-filter-chip${
                  active ? " is-active" : ""
                }`}
                onClick={() => setMemberUid(active ? undefined : m.uid)}
              >
                {m.name}
                {active && <X size={12} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="wk-global-search-filter-section">
        <div className="wk-global-search-filter-title">
          {t("base.globalSearch.filter.channelTypes") || "聊天类型"}
        </div>
        <div className="wk-global-search-filter-chip-row">
          <button
            type="button"
            className={`wk-global-search-filter-chip${
              channelTypesDMActive ? " is-active" : ""
            }`}
            onClick={() => toggleChannelTypeGroup([1])}
          >
            {t("base.globalSearch.filter.channelTypeDm") || "单聊"}
          </button>
          <button
            type="button"
            className={`wk-global-search-filter-chip${
              channelTypesGroupActive ? " is-active" : ""
            }`}
            onClick={() => toggleChannelTypeGroup([2, 5])}
          >
            {t("base.globalSearch.filter.channelTypeGroup") || "群聊"}
          </button>
        </div>
      </div>

      {tab === "messages" && (
        <div className="wk-global-search-filter-section">
          <div className="wk-global-search-filter-title">
            {t("base.globalSearch.filter.contentTypes") || "消息类型"}
          </div>
          <div className="wk-global-search-filter-chip-row">
            {MESSAGE_TYPE_OPTIONS.map((opt) => {
              const active = draft.contentTypes.includes(opt.value);
              // Image (2) / video (5) can only match in browse mode. When a
              // keyword is present, gray them out so users don't build a
              // filter that returns nothing (§6).
              const disabled = keywordActive && opt.browseOnly;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={disabled}
                  className={`wk-global-search-filter-chip${
                    active ? " is-active" : ""
                  }${disabled ? " is-disabled" : ""}`}
                  onClick={() => !disabled && toggleContentType(opt.value)}
                >
                  {t(opt.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tab === "files" && (
        <>
          <div className="wk-global-search-filter-section">
            <div className="wk-global-search-filter-title">
              {t("base.globalSearch.filter.fileTypes") || "文件类型"}
            </div>
            <div className="wk-global-search-filter-chip-row">
              {fileCategories.map((cat) => {
                const active = fileCategoryIsActive(cat);
                return (
                  <button
                    key={cat.key}
                    type="button"
                    className={`wk-global-search-filter-chip${
                      active ? " is-active" : ""
                    }`}
                    onClick={() => toggleFileExts(cat)}
                  >
                    {cat.label}
                  </button>
                );
              })}
              {fileCategories.length === 0 && (
                <span className="wk-global-search-filter-help">
                  {t("base.channelSearch.loading")}
                </span>
              )}
            </div>
          </div>

          <div className="wk-global-search-filter-section">
            <div className="wk-global-search-filter-title">
              {t("base.globalSearch.filter.fileSize") || "文件大小 (KB)"}
            </div>
            <div className="wk-global-search-filter-size-row">
              <input
                type="number"
                min={0}
                value={fileSizeMinInput}
                onChange={(e) => setFileSizeMinInput(e.target.value)}
                placeholder={t("base.globalSearch.filter.fileSizeMin") || "最小"}
              />
              <span>-</span>
              <input
                type="number"
                min={0}
                value={fileSizeMaxInput}
                onChange={(e) => setFileSizeMaxInput(e.target.value)}
                placeholder={t("base.globalSearch.filter.fileSizeMax") || "最大"}
              />
            </div>
          </div>
        </>
      )}

      <div className="wk-global-search-filter-section">
        <div className="wk-global-search-filter-title">
          <CalendarDays
            size={14}
            style={{ verticalAlign: "middle", marginRight: 4 }}
          />
          {t("base.channelSearch.filter.sendTime")}
        </div>
        <div className="wk-global-search-filter-chip-row">
          {(
            [
              ["today", "base.channelSearch.filter.today"],
              ["last_7_days", "base.channelSearch.filter.last7Days"],
              ["last_30_days", "base.channelSearch.filter.last30Days"],
            ] as const
          ).map(([preset, labelKey]) => {
            const active = draft.datePreset === preset;
            return (
              <button
                key={preset}
                type="button"
                className={`wk-global-search-filter-chip${
                  active ? " is-active" : ""
                }`}
                onClick={() =>
                  active ? setDatePreset(undefined) : setDatePreset(preset)
                }
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>
        <DatePicker
          density="compact"
          type="date"
          value={dateFromSeconds(draft.startAt)}
          onChange={(v) => setCustomDate("startAt", v)}
        />
        <DatePicker
          density="compact"
          type="date"
          value={dateFromSeconds(draft.endAt)}
          onChange={(v) => setCustomDate("endAt", v)}
        />
      </div>

      <div className="wk-global-search-filter-actions">
        <button type="button" onClick={clearAll}>
          {t("base.channelSearch.filter.clear")}
        </button>
        <button type="button" className="is-primary" onClick={apply}>
          {t("base.channelSearch.filter.apply") || "确定"}
        </button>
      </div>
    </div>
  );
};

export default GlobalSearchFilterPanel;
