import React, { useCallback, useEffect, useState } from "react";
import { Typography, Input, Button, Table, Tag, Spin, Toast, Banner } from "@douyinfe/semi-ui";
import { Search, Cpu, Circle } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { RuntimeDevice, RuntimeStatus } from "../api/types";
import { listRuntimes } from "../api/runtimeApi";
import RuntimeDetailPage from "../panel/RuntimeDetailPage";

const { Title, Text } = Typography;

function relTime(iso: string | null): string {
  if (!iso) return "-";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export default function RuntimePage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<RuntimeDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    listRuntimes({ keyword })
      .then(setRows)
      .catch((e) => setError(e?.message ?? "load failed"))
      .finally(() => setLoading(false));
  }, [keyword]);
  useEffect(reload, [reload]);

  const openDetail = (id: string) => WKApp.routeRight.push(<RuntimeDetailPage runtimeId={id} />);

  const columns = [
    {
      title: t("loop.field.name"),
      dataIndex: "name",
      render: (v: string, r: RuntimeDevice) => (
        <span className="loop-cell-title" onClick={() => openDetail(r.id)}>
          <Circle size={8} style={{ marginRight: 6, color: r.status === "online" ? "#23a55a" : "#c9cdd4" }} />
          {v}
        </span>
      ),
    },
    { title: t("loop.runtime.provider"), dataIndex: "provider", width: 130 },
    { title: t("loop.runtime.mode"), dataIndex: "runtime_mode", width: 100, render: (v: string) => t(`loop.runtime.modeVal.${v}`) || v },
    { title: t("loop.field.status"), dataIndex: "status", width: 110, render: (v: RuntimeStatus) => <Tag color={v === "online" ? "green" : "grey"} size="small">{t(`loop.runtime.${v}`)}</Tag> },
    { title: t("loop.runtime.lastSeen"), dataIndex: "last_seen_at", width: 100, render: (v: string | null) => <Text type="tertiary" style={{ fontSize: 12 }}>{relTime(v)}</Text> },
  ];

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.runtime")}</Title>
        <div className="loop-page__spacer" />
        <Input prefix={<Search size={14} />} placeholder={t("loop.runtime.search")} value={keyword} onChange={setKeyword} showClear style={{ width: 220 }} />
      </div>
      <div className="loop-page__body">
        {error ? (
          <Banner type="danger" description={error} />
        ) : loading ? (
          <div className="loop-page__center"><Spin /></div>
        ) : rows.length === 0 ? (
          <div className="loop-empty">
            <Cpu size={40} className="loop-empty__icon" />
            <div className="loop-empty__title">{t("loop.runtime.empty")}</div>
          </div>
        ) : (
          <Table rowKey="id" columns={columns} dataSource={rows} pagination={false} size="small" />
        )}
      </div>
    </div>
  );
}
