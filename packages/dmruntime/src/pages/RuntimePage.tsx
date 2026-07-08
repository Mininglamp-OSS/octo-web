import React, { useEffect, useMemo, useState } from "react";
import { Typography, Input, Spin, Empty, Tag, Avatar } from "@douyinfe/semi-ui";
import { Search, Cpu, Cloud, Monitor, Circle } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { RuntimeDevice, RuntimeStatus } from "../api/types";
import { listRuntimes } from "../api/runtimeApi";
import "./RuntimePage.css";

const { Title, Text } = Typography;

type StatusFilter = "all" | RuntimeStatus;

function relTime(iso: string | null): string {
  if (!iso) return "-";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function StatusDot({ status }: { status: RuntimeStatus }) {
  return (
    <span
      className={`loop-rt-dot loop-rt-dot--${status}`}
      title={status}
      aria-label={status}
    />
  );
}

/**
 * RuntimePage — 设备/Runtime 一级面板的**左栏**（列表）。
 * 主内容（详情）通过 WKApp.routeRight 推入右侧主栏，形成三栏结构：
 * NavRail(应用导航) + 设备列表(左) + 设备详情(右主栏)。
 */
export default function RuntimePage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RuntimeDevice[]>([]);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [activeId, setActiveId] = useState<string | null>(null);

  const openDetail = (row: RuntimeDevice) => {
    setActiveId(row.id);
    WKApp.routeRight.replaceToRoot(<RuntimeDetail row={row} />);
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listRuntimes()
      .then((data) => {
        if (!alive) return;
        setRows(data);
        const first = data[0];
        if (first) {
          setActiveId(first.id);
          // 延迟到下一帧，确保右栏 route context 已挂载。
          setTimeout(() => {
            if (alive) WKApp.routeRight.replaceToRoot(<RuntimeDetail row={first} />);
          }, 0);
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!kw) return true;
      return (
        r.name.toLowerCase().includes(kw) ||
        r.provider.toLowerCase().includes(kw)
      );
    });
  }, [rows, keyword, statusFilter]);

  const groups = useMemo(() => {
    const local = filtered.filter((r) => r.runtime_mode === "local");
    const cloud = filtered.filter((r) => r.runtime_mode === "cloud");
    return [
      { key: "local", label: t("runtime.group.local"), icon: <Monitor size={14} />, rows: local },
      { key: "cloud", label: t("runtime.group.cloud"), icon: <Cloud size={14} />, rows: cloud },
    ].filter((g) => g.rows.length > 0);
  }, [filtered, t]);

  return (
    <div className="loop-rt-sidebar">
      <div className="loop-rt__head">
        <Title heading={5} style={{ margin: 0 }}>
          {t("runtime.menu.title")}
        </Title>
      </div>
      <div className="loop-rt__toolbar">
        <Input
          prefix={<Search size={14} />}
          placeholder={t("runtime.search")}
          value={keyword}
          onChange={setKeyword}
          showClear
        />
        <div className="loop-rt__filters">
          {(["all", "online", "offline"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              className={`loop-rt__chip ${statusFilter === s ? "is-active" : ""}`}
              onClick={() => setStatusFilter(s)}
            >
              {t(`runtime.filter.${s}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="loop-rt__scroll">
        {loading ? (
          <div className="loop-rt__center">
            <Spin />
          </div>
        ) : groups.length === 0 ? (
          <div className="loop-rt__center">
            <Empty description={t("runtime.empty")} />
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="loop-rt__grp">
              <div className="loop-rt__grp-title">
                {g.icon}
                <span>{g.label}</span>
                <em>{g.rows.length}</em>
              </div>
              {g.rows.map((r) => (
                <button
                  key={r.id}
                  className={`loop-rt__row ${r.id === activeId ? "is-active" : ""}`}
                  onClick={() => openDetail(r)}
                >
                  <StatusDot status={r.status} />
                  <span className="loop-rt__row-main">
                    <strong>{r.name}</strong>
                    <small>{r.provider}</small>
                  </span>
                  <time>{relTime(r.last_seen_at)}</time>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** 设备详情：渲染在右侧主栏（routeRight）。 */
function RuntimeDetail({ row }: { row: RuntimeDevice }) {
  const { t } = useI18n();
  const fields: { label: string; value: React.ReactNode }[] = [
    { label: t("runtime.field.provider"), value: row.provider },
    {
      label: t("runtime.field.mode"),
      value: t(`runtime.mode.${row.runtime_mode}`),
    },
    {
      label: t("runtime.field.status"),
      value: (
        <span className="loop-rt__status-inline">
          <StatusDot status={row.status} />
          {t(`runtime.filter.${row.status}`)}
        </span>
      ),
    },
    { label: t("runtime.field.device"), value: row.device_info },
    { label: t("runtime.field.owner"), value: row.owner_name ?? "-" },
    {
      label: t("runtime.field.visibility"),
      value: t(`runtime.visibility.${row.visibility}`),
    },
    {
      label: t("runtime.field.lastSeen"),
      value: relTime(row.last_seen_at),
    },
    {
      label: t("runtime.field.runs30d"),
      value: String(row.runs_30d),
    },
  ];

  return (
    <div className="loop-rt__detail">
      <div className="loop-rt__detail-inner">
        <header className="loop-rt__detail-head">
          <Avatar size="default" color="light-blue" shape="square">
            <Cpu size={18} />
          </Avatar>
          <div>
            <Title heading={4} style={{ margin: 0 }}>
              {row.name}
            </Title>
            <Text type="tertiary">{row.id}</Text>
          </div>
          <Tag
            color={row.status === "online" ? "green" : "grey"}
            style={{ marginLeft: "auto" }}
          >
            <Circle size={8} style={{ marginRight: 4 }} />
            {t(`runtime.filter.${row.status}`)}
          </Tag>
        </header>

        <div className="loop-rt__card">
          <div className="loop-rt__card-title">{t("runtime.detail.basic")}</div>
          <dl className="loop-rt__fields">
            {fields.map((f) => (
              <div key={f.label} className="loop-rt__field">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="loop-rt__card loop-rt__card--muted">
          <div className="loop-rt__card-title">{t("runtime.detail.usage")}</div>
          <Text type="tertiary">{t("runtime.detail.usageHint")}</Text>
        </div>
      </div>
    </div>
  );
}
