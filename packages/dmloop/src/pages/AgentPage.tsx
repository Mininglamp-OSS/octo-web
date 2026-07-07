import React, { useCallback, useEffect, useState } from "react";
import {
  Typography,
  Input,
  Button,
  Table,
  Tag,
  Select,
  Avatar,
  Spin,
  Empty,
  SideSheet,
  Toast,
  Popconfirm,
  TextArea,
} from "@douyinfe/semi-ui";
import { Search, Plus, Trash2, Bot } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Agent, AgentStatus, AgentVisibility } from "../api/types";
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
} from "../api/agentApi";
import { AGENT_STATUS_COLOR } from "../ui/meta";

const { Title, Text } = Typography;

const AGENT_STATUS: AgentStatus[] = ["idle", "working", "offline", "error"];

export default function AgentPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [active, setActive] = useState<Agent | null>(null);
  const [creating, setCreating] = useState(false);
  const [dName, setDName] = useState("");
  const [dDesc, setDDesc] = useState("");
  const [dInstr, setDInstr] = useState("");
  const [dStatus, setDStatus] = useState<AgentStatus>("idle");
  const [dModel, setDModel] = useState("");
  const [dVis, setDVis] = useState<AgentVisibility>("workspace");

  const reload = useCallback(() => {
    setLoading(true);
    listAgents({ keyword })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [keyword]);
  useEffect(reload, [reload]);

  const openDetail = async (id: string) => {
    const a = await getAgent(id);
    if (!a) return;
    setActive(a);
    setCreating(false);
    setDName(a.name);
    setDDesc(a.description);
    setDInstr(a.instructions);
    setDStatus(a.status);
    setDModel(a.model);
    setDVis(a.visibility);
  };

  const openCreate = () => {
    setActive(null);
    setCreating(true);
    setDName("");
    setDDesc("");
    setDInstr("");
    setDStatus("idle");
    setDModel("claude-opus-4");
    setDVis("workspace");
  };

  const save = async () => {
    if (!dName.trim()) {
      Toast.warning(t("loop.validate.nameRequired"));
      return;
    }
    const payload = {
      name: dName.trim(),
      description: dDesc,
      instructions: dInstr,
      status: dStatus,
      model: dModel,
      visibility: dVis,
    };
    if (creating) {
      await createAgent(payload);
      Toast.success(t("loop.toast.created"));
    } else if (active) {
      await updateAgent(active.id, payload);
      Toast.success(t("loop.toast.saved"));
    }
    setActive(null);
    setCreating(false);
    reload();
  };

  const remove = async (id: string) => {
    await deleteAgent(id);
    Toast.success(t("loop.toast.deleted"));
    reload();
  };

  const columns = [
    {
      title: t("loop.field.name"),
      dataIndex: "name",
      render: (v: string, r: Agent) => (
        <span
          className="loop-cell-title"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          onClick={() => openDetail(r.id)}
        >
          <Avatar size="extra-small" color="violet">
            <Bot size={14} />
          </Avatar>
          <span>
            <div>{v}</div>
            <Text type="tertiary" style={{ fontSize: 12 }}>
              {r.description}
            </Text>
          </span>
        </span>
      ),
    },
    {
      title: t("loop.field.status"),
      dataIndex: "status",
      width: 110,
      render: (v: AgentStatus) => (
        <Tag color={AGENT_STATUS_COLOR[v]} size="small">
          {t(`loop.agentStatus.${v}`)}
        </Tag>
      ),
    },
    {
      title: t("loop.agent.runtime"),
      dataIndex: "runtime_name",
      width: 140,
    },
    {
      title: t("loop.agent.model"),
      dataIndex: "model",
      width: 150,
    },
    {
      title: t("loop.agent.runs30d"),
      dataIndex: "runs_30d",
      width: 100,
    },
    {
      title: "",
      dataIndex: "id",
      width: 60,
      render: (v: string) => (
        <Popconfirm title={t("loop.confirm.delete")} onConfirm={() => remove(v)}>
          <Button
            theme="borderless"
            type="danger"
            size="small"
            icon={<Trash2 size={14} />}
          />
        </Popconfirm>
      ),
    },
  ];

  const editing = creating || !!active;

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.agent")}</Title>
        <div className="loop-page__spacer" />
        <Input
          prefix={<Search size={14} />}
          placeholder={t("loop.search.agent")}
          value={keyword}
          onChange={setKeyword}
          showClear
          style={{ width: 220 }}
        />
        <Button theme="solid" icon={<Plus size={14} />} onClick={openCreate}>
          {t("loop.action.newAgent")}
        </Button>
      </div>
      <div className="loop-page__body">
        {loading ? (
          <div className="loop-page__center">
            <Spin />
          </div>
        ) : rows.length === 0 ? (
          <div className="loop-page__center">
            <Empty description={t("loop.empty.agent")} />
          </div>
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={rows}
            pagination={false}
            size="small"
          />
        )}
      </div>

      <SideSheet
        title={creating ? t("loop.action.newAgent") : t("loop.detail.agentTitle")}
        visible={editing}
        onCancel={() => {
          setActive(null);
          setCreating(false);
        }}
        width={480}
        footer={
          <Button theme="solid" onClick={save}>
            {t("loop.action.save")}
          </Button>
        }
      >
        <div className="loop-detail">
          <div>
            <div className="loop-detail__section-title">
              {t("loop.field.name")}
            </div>
            <Input value={dName} onChange={setDName} />
          </div>
          <div>
            <div className="loop-detail__section-title">
              {t("loop.field.description")}
            </div>
            <Input value={dDesc} onChange={setDDesc} />
          </div>
          <div>
            <div className="loop-detail__section-title">
              {t("loop.agent.instructions")}
            </div>
            <TextArea
              value={dInstr}
              onChange={setDInstr}
              autosize={{ minRows: 3, maxRows: 8 }}
            />
          </div>
          <dl className="loop-detail__fields">
            <dt>{t("loop.field.status")}</dt>
            <dd>
              <Select
                value={dStatus}
                onChange={(v) => setDStatus(v as AgentStatus)}
                style={{ width: 180 }}
                size="small"
              >
                {AGENT_STATUS.map((s) => (
                  <Select.Option key={s} value={s}>
                    {t(`loop.agentStatus.${s}`)}
                  </Select.Option>
                ))}
              </Select>
            </dd>
            <dt>{t("loop.agent.model")}</dt>
            <dd>
              <Input value={dModel} onChange={setDModel} size="small" style={{ width: 180 }} />
            </dd>
            <dt>{t("loop.agent.visibility")}</dt>
            <dd>
              <Select
                value={dVis}
                onChange={(v) => setDVis(v as AgentVisibility)}
                style={{ width: 180 }}
                size="small"
              >
                <Select.Option value="workspace">
                  {t("loop.agent.visWorkspace")}
                </Select.Option>
                <Select.Option value="private">
                  {t("loop.agent.visPrivate")}
                </Select.Option>
              </Select>
            </dd>
          </dl>
        </div>
      </SideSheet>
    </div>
  );
}
