import React, { useEffect, useState } from "react";
import { Typography, Button, Spin, Tag, Avatar, Banner } from "@douyinfe/semi-ui";
import { ArrowLeft, Cpu, Circle } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { RuntimeDevice } from "../api/types";
import { getRuntime } from "../api/runtimeApi";
import "./sideDetail.css";

const { Title, Text } = Typography;

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

/** Runtime 设备只读详情页（Loop 二级栏目）。 */
export default function RuntimeDetailPage({ runtimeId }: { runtimeId: string }) {
  const { t } = useI18n();
  const [row, setRow] = useState<RuntimeDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getRuntime(runtimeId)
      .then(setRow)
      .catch((e) => setError(e?.message ?? "load failed"))
      .finally(() => setLoading(false));
  }, [runtimeId]);

  const back = () => WKApp.routeRight.pop();

  if (loading) return <div className="loop-sd"><div className="loop-sd__center"><Spin /></div></div>;
  if (error || !row)
    return (
      <div className="loop-sd">
        <div className="loop-sd__topbar"><Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button></div>
        <div className="loop-sd__center">{error ? <Banner type="danger" description={error} /> : <Text type="tertiary">{t("loop.detail.notFound")}</Text>}</div>
      </div>
    );

  const fields: Array<[string, React.ReactNode]> = [
    [t("loop.runtime.provider"), row.provider],
    [t("loop.runtime.mode"), t(`loop.runtime.modeVal.${row.runtime_mode}`) || row.runtime_mode],
    [t("loop.field.status"), <Tag color={row.status === "online" ? "green" : "grey"} size="small">{t(`loop.runtime.${row.status}`)}</Tag>],
    [t("loop.runtime.device"), row.device_info],
    [t("loop.runtime.launchHeader"), row.launch_header ?? "—"],
    [t("loop.runtime.visibility"), row.visibility],
    [t("loop.runtime.lastSeen"), relTime(row.last_seen_at)],
  ];

  return (
    <div className="loop-sd">
      <div className="loop-sd__topbar">
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button>
        <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.nav.runtime")}</Text>
      </div>
      <div className="loop-sd__body" style={{ gridTemplateColumns: "1fr" }}>
        <section className="loop-sd__main">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <Avatar color="light-blue" shape="square"><Cpu size={18} /></Avatar>
            <div>
              <Title heading={4} style={{ margin: 0 }}>
                <Circle size={9} style={{ marginRight: 6, color: row.status === "online" ? "#23a55a" : "#c9cdd4" }} />
                {row.name}
              </Title>
              <Text type="tertiary" style={{ fontSize: 12 }}>{row.id}</Text>
            </div>
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "10px", maxWidth: 620, margin: 0 }}>
            {fields.map(([k, v], i) => (
              <React.Fragment key={i}>
                <dt style={{ fontSize: 12, color: "var(--semi-color-text-2)" }}>{k}</dt>
                <dd style={{ margin: 0 }}>{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
