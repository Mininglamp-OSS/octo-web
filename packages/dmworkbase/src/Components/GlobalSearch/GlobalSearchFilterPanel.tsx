import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DatePicker } from "@douyinfe/semi-ui";
import { CalendarDays } from "lucide-react";
import { useI18n } from "../../i18n";
import WKButton from "../WKButton";
import FilterSearchSelect from "./FilterSearchSelect";
import type { FilterSearchOption } from "./FilterSearchSelect";
import type { ChannelSearchSender } from "../ChannelSearch/types";
import type {
  GlobalContentTab,
  GlobalSearchChannelOption,
  GlobalSearchDataSource,
  GlobalSearchFileTypeCategory,
  GlobalSearchFilters,
} from "./types";
import { cnDatePresetRange } from "./apiAdapter";

interface Props {
  tab: GlobalContentTab;
  keyword: string;
  filters: GlobalSearchFilters;
  dataSource: GlobalSearchDataSource;
  onApply: (filters: GlobalSearchFilters) => void;
  onClose: () => void;
}

// Day-boundary helpers for the DatePicker widget (custom range only). They
// use the browser tz so the picker matches the user's visual expectation.
// The datePreset ("today" / "last_7_days" / "last_30_days") path uses the
// CN-tz-aware `cnDatePresetRange` helper from apiAdapter.ts, since the
// backend day boundaries are anchored to Asia/Shanghai (§11).
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

// Mirror of ChannelSearch's date label ("2026/07/10 周四") so the global-search
// date trigger reads identically to the in-conversation one. Copied verbatim
// from ChannelSearch/index.tsx to keep the two surfaces visually in lock-step.
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
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState<GlobalSearchFilters>(filters);
  const [senderQuery, setSenderQuery] = useState("");
  const [senderOptions, setSenderOptions] = useState<ChannelSearchSender[]>(
    () =>
      dataSource.getSenders().filter((s) => s.uid !== dataSource.getSelfUid())
  );
  const [channelQuery, setChannelQuery] = useState("");
  const [channelOptions, setChannelOptions] = useState<
    GlobalSearchChannelOption[]
  >([]);
  // Keeps every channel option we've ever loaded so a picked chip can resolve
  // its display name even after the query narrows past it (draft.channels only
  // stores {channelId, channelType}).
  const channelCatalog = useRef<Map<string, GlobalSearchChannelOption>>(
    new Map()
  );
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

  // Task 3 (footer truncation): the popover is `position: absolute` under the
  // filter trigger and its natural height (~600px) exceeds the space between
  // its top and the bottom of the enclosing Semi modal, so the 「发送时间」
  // section + Apply/Clear footer render below the fold — and because the footer
  // lives OUTSIDE the scrollable body, body-scroll alone can't reach it. This is
  // what #592's pure-CSS `max-height` cap missed on two counts: CSS can't read
  // the panel's own viewport top (it shifts with the vertically-centered modal),
  // and the true clipping edge is the Semi `.semi-modal-content` (which has
  // `overflow: hidden`), NOT the viewport. Measure the panel's top on open (and
  // on resize) and cap max-height to `min(clippingAncestorsBottom, viewport) -
  // top - gutter` so the whole panel — footer included — always fits inside the
  // modal while the body scrolls internally. useLayoutEffect runs before paint,
  // so the oversized frame is never shown.
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | undefined>(
    undefined
  );
  useLayoutEffect(() => {
    const measure = () => {
      const el = panelRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const gutter = 16; // keep the panel clear of the clipping bottom edge
      // The visible bottom is bounded by the viewport AND by every clipping
      // ancestor (overflow != visible) — the Semi modal content clips with
      // overflow:hidden. Take the tightest.
      let boundBottom = window.innerHeight;
      let anc: HTMLElement | null = el.parentElement;
      while (anc) {
        const cs = window.getComputedStyle(anc);
        if (cs.overflowY !== "visible" || cs.overflowX !== "visible") {
          boundBottom = Math.min(boundBottom, anc.getBoundingClientRect().bottom);
        }
        anc = anc.parentElement;
      }
      const avail = boundBottom - top - gutter;
      // Floor guards degenerate/tiny containers; when the content is shorter
      // than `avail` the panel keeps its natural (smaller) height regardless.
      setPanelMaxHeight(Math.max(160, Math.round(avail)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

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
        list.forEach((o) =>
          channelCatalog.current.set(`${o.channelType}:${o.channelId}`, o)
        );
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
        (c) =>
          c.channelId === opt.channelId && c.channelType === opt.channelType
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

  // Composite key used by the FilterSearchSelect option ids (channelId can be
  // shared across channel types, so both parts are needed to be unique).
  const channelKey = (ref: { channelId: string; channelType: number }) =>
    `${ref.channelType}:${ref.channelId}`;

  const toggleChannelById = (id: string) => {
    const known =
      channelCatalog.current.get(id) ??
      channelOptions.find((o) => channelKey(o) === id);
    if (known) {
      toggleChannel(known);
      return;
    }
    // Chip whose option is no longer in the loaded pool (removal only needs
    // channelId + channelType). Split on the first ":" — channelType is numeric.
    const sep = id.indexOf(":");
    const channelType = Number(id.slice(0, sep));
    const channelId = id.slice(sep + 1);
    toggleChannel({ channelId, channelType, name: channelId });
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
      const allActive = category.exts.every((e) => set.has(e.toLowerCase()));
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
    // §11 tz contract: preset day boundaries are anchored to Asia/Shanghai,
    // not the browser tz. Otherwise a non-CN user's "today" wire window can
    // straddle two CN calendar days once secondsToDateOnlyCN serializes it.
    const nDays =
      preset === "last_7_days" ? 7 : preset === "last_30_days" ? 30 : 1;
    const { startAt, endAt } = cnDatePresetRange(nDays, new Date());
    setDraft((cur) => ({
      ...cur,
      datePreset: preset,
      startAt,
      endAt,
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
  const fileCategoryIsActive = useCallback(
    (cat: GlobalSearchFileTypeCategory) =>
      cat.exts.every((e) => draft.fileExts.includes(e.toLowerCase())),
    [draft.fileExts]
  );

  // Options + picked chips for the three select-style filters. Each maps the
  // filter's native shape onto the generic { id, name, avatarUrl } row that
  // FilterSearchSelect renders.
  const senderSelectOptions = useMemo<FilterSearchOption[]>(
    () =>
      senderOptions.map((s) => ({
        id: s.uid,
        name: s.name,
        avatarUrl: s.avatarUrl,
      })),
    [senderOptions]
  );
  const senderSelected = useMemo<FilterSearchOption[]>(
    () =>
      draft.senderUids.map((uid) => {
        const s = dataSource.getSender(uid);
        return { id: uid, name: s.name, avatarUrl: s.avatarUrl };
      }),
    [draft.senderUids, dataSource]
  );

  const channelSelectOptions = useMemo<FilterSearchOption[]>(
    () =>
      channelOptions.map((o) => ({
        id: channelKey(o),
        name: o.name,
        avatarUrl: o.avatarUrl,
      })),
    [channelOptions]
  );
  const channelSelected = useMemo<FilterSearchOption[]>(
    () =>
      draft.channels.map((c) => {
        const key = channelKey(c);
        const known = channelCatalog.current.get(key);
        return {
          id: key,
          name: known?.name ?? c.channelId,
          avatarUrl: known?.avatarUrl,
        };
      }),
    [draft.channels]
  );
  const channelIsSelectedById = useCallback(
    (id: string) => draft.channels.some((c) => channelKey(c) === id),
    [draft.channels]
  );

  const memberSelectOptions = useMemo<FilterSearchOption[]>(
    () =>
      memberOptions.map((m) => ({
        id: m.uid,
        name: m.name,
        avatarUrl: m.avatarUrl,
      })),
    [memberOptions]
  );
  const memberSelected = useMemo<FilterSearchOption[]>(() => {
    if (!draft.memberUid) return [];
    const s = dataSource.getSender(draft.memberUid);
    return [{ id: draft.memberUid, name: s.name, avatarUrl: s.avatarUrl }];
  }, [draft.memberUid, dataSource]);
  const memberIsSelected = useCallback(
    (id: string) => draft.memberUid === id,
    [draft.memberUid]
  );
  const toggleMemberById = (id: string) =>
    setMemberUid(draft.memberUid === id ? undefined : id);

  return (
    <div
      ref={panelRef}
      className="wk-channel-search-filter-popover wk-global-search-filter-panel"
      style={panelMaxHeight ? { maxHeight: `${panelMaxHeight}px` } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="wk-global-search-filter-body">
      <FilterSearchSelect
        title={t("base.channelSearch.filter.sender")}
        placeholder={t("base.channelSearch.filter.senderPlaceholder")}
        query={senderQuery}
        onQueryChange={setSenderQuery}
        options={senderSelectOptions}
        selected={senderSelected}
        isSelected={senderIsSelected}
        onToggle={toggleSender}
        emptyHint={t("base.channelSearch.filter.senderPlaceholder")}
        listboxId="wk-global-search-sender-list"
      />

      {/*
        「所在群聊」narrowing (channel_ids). v1 scope, YUJ-15:

        The candidate pool exposed here is populated by
        dataSource.searchChannels — currently backed by conversation history
        + groupSaveList, so a thread (channelType=5) does NOT get its own
        selectable chip. This is intentional for v1: adding a per-thread
        picker needs a thread-list source keyed by group + a UX pass on
        thread hierarchy, both out of scope.

        This does NOT silently drop thread coverage. Thread hits still
        surface in the result stream when the caller selects the 群聊 chip
        below — that maps to channel_types=[2,5] on the wire (§6, `GLOBAL_
        CHANNEL_TYPES_GROUP`), which the backend fail-open expands to every
        active thread under the caller's joined groups. In short: v1 pool =
        groups only for narrowing, thread hits = fail-open via [2,5]. See
        packages/dmworkbase/src/Components/GlobalSearch/dataSource.ts
        (loadReadableChannelOptions) for the pool source.
      */}
      <FilterSearchSelect
        title={t("base.globalSearch.filter.channels")}
        query={channelQuery}
        onQueryChange={setChannelQuery}
        options={channelSelectOptions}
        selected={channelSelected}
        isSelected={channelIsSelectedById}
        onToggle={toggleChannelById}
        listboxId="wk-global-search-channel-list"
      />

      <FilterSearchSelect
        title={t("base.globalSearch.filter.memberUid")}
        query={memberQuery}
        onQueryChange={setMemberQuery}
        options={memberSelectOptions}
        selected={memberSelected}
        isSelected={memberIsSelected}
        onToggle={toggleMemberById}
        listboxId="wk-global-search-member-list"
      />

      <div className="wk-channel-search-filter-section">
        <div className="wk-channel-search-filter-title">
          {t("base.globalSearch.filter.channelTypes")}
        </div>
        <div className="wk-global-search-filter-chip-row">
          <button
            type="button"
            className={`wk-channel-search-filter-chip${
              channelTypesDMActive ? " is-active" : ""
            }`}
            onClick={() => toggleChannelTypeGroup([1])}
          >
            {t("base.globalSearch.filter.channelTypeDm")}
          </button>
          <button
            type="button"
            className={`wk-channel-search-filter-chip${
              channelTypesGroupActive ? " is-active" : ""
            }`}
            onClick={() => toggleChannelTypeGroup([2, 5])}
          >
            {t("base.globalSearch.filter.channelTypeGroup")}
          </button>
        </div>
      </div>

      {tab === "messages" && (
        <div className="wk-channel-search-filter-section">
          <div className="wk-channel-search-filter-title">
            {t("base.globalSearch.filter.contentTypes")}
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
                  className={`wk-channel-search-filter-chip${
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
          <div className="wk-channel-search-filter-section">
            <div className="wk-channel-search-filter-title">
              {t("base.globalSearch.filter.fileTypes")}
            </div>
            <div className="wk-global-search-filter-chip-row">
              {fileCategories.map((cat) => {
                const active = fileCategoryIsActive(cat);
                return (
                  <button
                    key={cat.key}
                    type="button"
                    className={`wk-channel-search-filter-chip${
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

          <div className="wk-channel-search-filter-section">
            <div className="wk-channel-search-filter-title">
              {t("base.globalSearch.filter.fileSize")}
            </div>
            <div className="wk-global-search-filter-size-row">
              <input
                type="number"
                min={0}
                value={fileSizeMinInput}
                onChange={(e) => setFileSizeMinInput(e.target.value)}
                placeholder={t("base.globalSearch.filter.fileSizeMin")}
              />
              <span>-</span>
              <input
                type="number"
                min={0}
                value={fileSizeMaxInput}
                onChange={(e) => setFileSizeMaxInput(e.target.value)}
                placeholder={t("base.globalSearch.filter.fileSizeMax")}
              />
            </div>
          </div>
        </>
      )}

      <div className="wk-channel-search-filter-section">
        <div className="wk-channel-search-filter-title">
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
                className={`wk-channel-search-filter-chip${
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
          className="wk-channel-search-date-picker"
          value={dateFromSeconds(draft.startAt)}
          onChange={(v) => setCustomDate("startAt", v)}
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
          onChange={(v) => setCustomDate("endAt", v)}
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

      </div>

      <div className="wk-channel-search-filter-actions">
        <WKButton size="sm" variant="secondary" onClick={clearAll}>
          {t("base.channelSearch.filter.clear")}
        </WKButton>
        <WKButton size="sm" variant="primary" onClick={apply}>
          {t("base.globalSearch.filter.apply")}
        </WKButton>
      </div>
    </div>
  );
};

export default GlobalSearchFilterPanel;
