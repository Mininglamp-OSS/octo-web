import React, { useCallback, useEffect, useState } from "react";
import { Typography, Input, Button, Table, Tag, Select, Avatar, Spin, Modal, Toast, Popconfirm, TextArea, Banner } from "@douyinfe/semi-ui";
import { Search, Plus, Trash2, Bot } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Agent, AgentStatus, AgentVisibility, RuntimeDevice } from "../api/types";
import { listAgents, createAgent, archiveAgent, listRuntimesForAgent } from "../api/agentApi";
import AgentDetailPage from "../panel/AgentDetailPage";
import { AGENT_STATUS_COLOR } from "../ui/meta";

const { Title, Text } = Typography;

export default function AgentPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [nName, setNName] = useState("");
  const [nDesc, setNDesc] = useState("");
  const [nModel, setNModel] = useState("");
  const [nVis, setNVis] = useState<AgentVisibility>("workspace");
  const [nRuntimeId, setNRuntimeId] = useState<string | undefined>();
  const [runtimes, setRuntimes] = useState<RuntimeDevice[]>([]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    listAgents({ keyword }).then(setRows).catch((e) => setError(e?.message ?? "load failed")).finally(() => setLoading(false));
  }, [keyword]);
  useEffect(reload, [reload]);

  const openDetail = (id: string) => WKApp.routeRight.push(<AgentDetailPage agentId={id} onChanged={reload} />);

  const openCreate = () => {
    setCreateOpen(true);
    listRuntimesForAgent().then((rs) => { setRuntimes(rs); if (rs[0]) setNRuntimeId(rs[0].id); }).catch(() => setRuntimes([]));
  };

  const doCreate = async () => {
    if (!nName.trim()) { Toast.warning(t("loop.validate.nameRequired")); return; }
    if (!nRuntimeId) { Toast.warning(t("loop.agent.runtimeRequired")); return; }
    try {
      await createAgent({ name: nName.trim(), description: nDesc, runtime_id: nRuntimeId, model: nModel || undefined, visibility: nVis });
      setCreateOpen(false); setNName(""); setNDesc("");
      Toast.success(t("loop.toast.created")); reload();
    } catch (e) { Toast.error((e as Error)?.message ?? "create failed"); }
  };

  const remove = async (id: string) => {
    try { await archiveAgent(id); Toast.success(t("loop.toast.archived")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "archive failed"); }
  };

  const columns = [
    { title: t("loop.field.name"), dataIndex: "name", render: (v: string, r: Agent) => (
      <span className="loop-cell-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }} onClick={() => openDetail(r.id)}>
        <Avatar size="extra-small" color="violet"><Bot size={14} /></Avatar>
        <span><div>{v}</div><Text type="tertiary" style={{ fontSize: 12 }}>{r.description}</Text></span>
      </span>) },
    { title: t("loop.field.status"), dataIndex: "status", width: 110, render: (v: AgentStatus) => <Tag color={AGENT_STATUS_COLOR[v as keyof typeof AGENT_STATUS_COLOR] ?? "grey"} size="small">{t(`loop.agentStatus.${v}`)}</Tag> },
    { title: t("loop.agent.runtime"), dataIndex: "runtime_name", width: 160, render: (v: string | null) => <Text>{v ?? "—"}</Text> },
    { title: t("loop.agent.model"), dataIndex: "model", width: 160 },
    { title: "", dataIndex: "id", width: 60, render: (v: string) => <Popconfirm title={t("loop.confirm.delete")} onConfirm={() => remove(v)}><Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} /></Popconfirm> },
  ];

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.agent")}</Title>
        <div className="loop-page__spacer" />
        <Input prefix={<Search size={14} />} placeholder={t("loop.search.agent")} value={keyword} onChange={setKeyword} showClear style={{ width: 220 }} />
        <Button theme="solid" icon={<Plus size={14} />} onClick={openCreate}>{t("loop.action.newAgent")}</Button>
      </div>
      <div className="loop-page__body">
        {error ? <Banner type="danger" description={error} />
          : loading ? <div className="loop-page__center"><Spin /></div>
          : rows.length === 0 ? (
            <div className="loop-empty">
              <Bot size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.empty.agentTitle")}</div>
              <div className="loop-empty__desc">{t("loop.empty.agentDesc")}</div>
              <Button theme="solid" icon={<Plus size={14} />} onClick={openCreate} style={{ marginTop: 12 }}>{t("loop.action.newAgent")}</Button>
            </div>
          ) : <Table rowKey="id" columns={columns} dataSource={rows} pagination={false} size="small" />}
      </div>

      <Modal title={t("loop.action.newAgent")} visible={createOpen} onOk={doCreate} onCancel={() => setCreateOpen(false)} okText={t("loop.action.create")} cancelText={t("loop.action.cancel")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><div className="loop-detail__section-title">{t("loop.field.name")}</div><Input autoFocus value={nName} onChange={setNName} /></div>
          <div><div className="loop-detail__section-title">{t("loop.field.description")}</div><TextArea value={nDesc} onChange={setNDesc} autosize={{ minRows: 2, maxRows: 4 }} /></div>
          <div><div className="loop-detail__section-title">{t("loop.agent.runtime")}</div>
            <Select value={nRuntimeId} onChange={(v) => setNRuntimeId(v as string)} style={{ width: "100%" }} placeholder={t("loop.agent.runtime")}>
              {runtimes.map((r) => <Select.Option key={r.id} value={r.id}>{r.name}（{r.provider}）</Select.Option>)}
            </Select>
          </div>
          <div><div className="loop-detail__section-title">{t("loop.agent.model")}</div><Input value={nModel} onChange={setNModel} placeholder="claude-opus-4 / codex-latest…" /></div>
          <div><div className="loop-detail__section-title">{t("loop.agent.visibility")}</div>
            <Select value={nVis} onChange={(v) => setNVis(v as AgentVisibility)} style={{ width: "100%" }}>
              <Select.Option value="workspace">{t("loop.agent.visWorkspace")}</Select.Option>
              <Select.Option value="private">{t("loop.agent.visPrivate")}</Select.Option>
            </Select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
