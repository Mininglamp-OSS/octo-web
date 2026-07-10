import React, { useEffect, useState } from "react";
import {
  Typography,
  Input,
  Select,
  Button,
  Avatar,
  Tag,
  Spin,
  Toast,
  InputNumber,
  Tabs,
  TabPane,
  TextArea,
} from "@douyinfe/semi-ui";
import { ArrowLeft, Bot, Trash2, Plus, Eye, EyeOff, Save } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Agent, AgentStatus, AgentVisibility } from "../api/types";
import {
  getAgent,
  updateAgent,
  getAgentEnv,
  updateAgentEnv,
} from "../api/agentApi";
import { AGENT_STATUS_COLOR } from "../ui/meta";
import "./agentDetail.css";

const { Title, Text } = Typography;

const AGENT_STATUS: AgentStatus[] = ["idle", "working", "offline", "error"];
const THINKING = ["none", "light", "medium", "deep"];

interface EnvEntry {
  key: string;
  value: string;
  visible: boolean;
}

/**
 * Agent 独立详情/编辑页（对齐产品设计）：
 * 左侧 Inspector（身份 + 属性）+ 右侧 Tabs（指令 / 技能 / 环境变量 / 自定义参数）。
 * 渲染在右主栏（routeRight.push），顶部返回 pop。
 */
export default function AgentDetailPage({
  agentId,
  onChanged,
}: {
  agentId: string;
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  // inspector drafts
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  // tab drafts
  const [instr, setInstr] = useState("");
  const [instrDirty, setInstrDirty] = useState(false);
  const [args, setArgs] = useState<string[]>([]);
  const [argsDirty, setArgsDirty] = useState(false);
  const [env, setEnv] = useState<EnvEntry[]>([]);
  const [envRevealed, setEnvRevealed] = useState(false);
  const [envDirty, setEnvDirty] = useState(false);

  const reload = () => {
    setLoading(true);
    getAgent(agentId)
      .then((a) => {
        setAgent(a);
        setName(a.name);
        setDesc(a.description);
        setInstr(a.instructions);
        setArgs(a.custom_args ?? []);
        setInstrDirty(false);
        setArgsDirty(false);
      })
      .catch(() => Toast.error(t("loop.detail.notFound")))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [agentId]);

  const patch = async (p: Parameters<typeof updateAgent>[1]) => {
    if (!agent) return;
    const next = await updateAgent(agent.id, { name: p.name ?? agent.name, ...p });
    setAgent(next);
    onChanged?.();
  };

  const revealEnv = async () => {
    const map = await getAgentEnv(agentId);
    setEnv(Object.entries(map).map(([key, value]) => ({ key, value, visible: false })));
    setEnvRevealed(true);
    setEnvDirty(false);
  };

  const saveEnv = async () => {
    const map: Record<string, string> = {};
    for (const e of env) if (e.key.trim()) map[e.key.trim()] = e.value;
    await updateAgentEnv(agentId, map);
    setEnvDirty(false);
    Toast.success(t("loop.toast.saved"));
  };

  const back = () => WKApp.routeRight.pop();

  if (loading && !agent) {
    return (
      <div className="loop-adp">
        <div className="loop-adp__center"><Spin /></div>
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="loop-adp">
        <div className="loop-adp__topbar">
          <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button>
        </div>
        <div className="loop-adp__center"><Text type="tertiary">{t("loop.detail.notFound")}</Text></div>
      </div>
    );
  }

  return (
    <div className="loop-adp">
      <div className="loop-adp__topbar">
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button>
        <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.nav.agent")}</Text>
      </div>

      <div className="loop-adp__body">
        {/* Inspector */}
        <aside className="loop-adp__inspector">
          <div className="loop-adp__identity">
            <Avatar size="large" color="violet" shape="square"><Bot size={22} /></Avatar>
            <Input
              value={name}
              onChange={setName}
              onBlur={() => name.trim() && name !== agent.name && patch({ name: name.trim() })}
              style={{ fontWeight: 600, marginTop: 8 }}
            />
            <TextArea
              value={desc}
              onChange={setDesc}
              onBlur={() => desc !== agent.description && patch({ name: agent.name, description: desc })}
              autosize={{ minRows: 1, maxRows: 4 }}
              placeholder={t("loop.field.description")}
              style={{ marginTop: 6 }}
            />
            <Tag color={AGENT_STATUS_COLOR[agent.status]} size="small" style={{ marginTop: 8 }}>
              {t(`loop.agentStatus.${agent.status}`)}
            </Tag>
          </div>

          <div className="loop-detail__section-title">{t("loop.detail.properties")}</div>
          <dl className="loop-adp__props">
            <dt>{t("loop.agent.runtime")}</dt>
            <dd><Text>{agent.runtime_name}</Text></dd>

            <dt>{t("loop.agent.model")}</dt>
            <dd>
              <Input size="small" value={agent.model} onChange={(v) => patch({ name: agent.name, model: v })} />
            </dd>

            <dt>{t("loop.agent.thinking")}</dt>
            <dd>
              <Select size="small" style={{ width: "100%" }} value={agent.thinking_level}
                onChange={(v) => patch({ name: agent.name, thinking_level: v as string })}>
                {THINKING.map((x) => <Select.Option key={x} value={x}>{t(`loop.agent.thinkingLevel.${x}`)}</Select.Option>)}
              </Select>
            </dd>

            <dt>{t("loop.agent.visibility")}</dt>
            <dd>
              <Select size="small" style={{ width: "100%" }} value={agent.visibility}
                onChange={(v) => patch({ name: agent.name, visibility: v as AgentVisibility })}>
                <Select.Option value="workspace">{t("loop.agent.visWorkspace")}</Select.Option>
                <Select.Option value="private">{t("loop.agent.visPrivate")}</Select.Option>
              </Select>
            </dd>

            <dt>{t("loop.field.status")}</dt>
            <dd>
              <Select size="small" style={{ width: "100%" }} value={agent.status}
                onChange={(v) => patch({ name: agent.name, status: v as AgentStatus })}>
                {AGENT_STATUS.map((s) => <Select.Option key={s} value={s}>{t(`loop.agentStatus.${s}`)}</Select.Option>)}
              </Select>
            </dd>

            <dt>{t("loop.agent.concurrency")}</dt>
            <dd>
              <InputNumber size="small" min={1} max={10} value={agent.max_concurrent_tasks}
                onChange={(v) => patch({ name: agent.name, max_concurrent_tasks: Number(v) })} style={{ width: "100%" }} />
            </dd>

            <dt>{t("loop.field.creator")}</dt>
            <dd><Text>{agent.owner_name}</Text></dd>
          </dl>
        </aside>

        {/* Tabs */}
        <section className="loop-adp__tabs">
          <Tabs type="line">
            <TabPane tab={t("loop.agent.instructions")} itemKey="instructions">
              <div className="loop-adp__tabpane">
                <TextArea
                  value={instr}
                  onChange={(v) => { setInstr(v); setInstrDirty(true); }}
                  autosize={{ minRows: 10, maxRows: 24 }}
                  placeholder={t("loop.agent.instructionsPlaceholder")}
                />
                <div className="loop-adp__tabfoot">
                  {instrDirty && <Text type="warning" style={{ fontSize: 12 }}>{t("loop.agent.unsaved")}</Text>}
                  <Button theme="solid" icon={<Save size={14} />} disabled={!instrDirty}
                    onClick={async () => { await patch({ name: agent.name, instructions: instr }); setInstrDirty(false); Toast.success(t("loop.toast.saved")); }}>
                    {t("loop.action.save")}
                  </Button>
                </div>
              </div>
            </TabPane>

            <TabPane tab={`${t("loop.agent.skills")} (${(agent.skills ?? []).length})`} itemKey="skills">
              <div className="loop-adp__tabpane">
                {(agent.skills ?? []).length === 0 ? (
                  <Text type="tertiary">{t("loop.agent.noSkills")}</Text>
                ) : (
                  <div className="loop-adp__chips">
                    {(agent.skills ?? []).map((s) => <Tag key={s.id} size="large" color="cyan">{s.name}</Tag>)}
                  </div>
                )}
              </div>
            </TabPane>

            <TabPane tab={t("loop.agent.env")} itemKey="env">
              <div className="loop-adp__tabpane">
                {!envRevealed ? (
                  <Button onClick={revealEnv}>{t("loop.agent.revealEnv")}</Button>
                ) : (
                  <>
                    {env.map((e, i) => (
                      <div key={i} className="loop-adp__envrow">
                        <Input placeholder="KEY" value={e.key} style={{ width: 160 }}
                          onChange={(v) => { const n = [...env]; n[i] = { ...e, key: v }; setEnv(n); setEnvDirty(true); }} />
                        <Input placeholder="VALUE" mode={e.visible ? undefined : "password"} value={e.value} style={{ flex: 1 }}
                          onChange={(v) => { const n = [...env]; n[i] = { ...e, value: v }; setEnv(n); setEnvDirty(true); }}
                          suffix={
                            <Button theme="borderless" size="small" icon={e.visible ? <EyeOff size={13} /> : <Eye size={13} />}
                              onClick={() => { const n = [...env]; n[i] = { ...e, visible: !e.visible }; setEnv(n); }} />
                          } />
                        <Button theme="borderless" type="danger" icon={<Trash2 size={14} />}
                          onClick={() => { setEnv(env.filter((_, j) => j !== i)); setEnvDirty(true); }} />
                      </div>
                    ))}
                    <div className="loop-adp__tabfoot">
                      <Button icon={<Plus size={14} />} onClick={() => { setEnv([...env, { key: "", value: "", visible: true }]); setEnvDirty(true); }}>
                        {t("loop.squad.add")}
                      </Button>
                      <Button theme="solid" icon={<Save size={14} />} disabled={!envDirty} onClick={saveEnv}>{t("loop.action.save")}</Button>
                    </div>
                  </>
                )}
              </div>
            </TabPane>

            <TabPane tab={t("loop.agent.customArgs")} itemKey="args">
              <div className="loop-adp__tabpane">
                {args.map((a, i) => (
                  <div key={i} className="loop-adp__envrow">
                    <Input value={a} className="loop-mono" placeholder="--flag value"
                      onChange={(v) => { const n = [...args]; n[i] = v; setArgs(n); setArgsDirty(true); }} />
                    <Button theme="borderless" type="danger" icon={<Trash2 size={14} />}
                      onClick={() => { setArgs(args.filter((_, j) => j !== i)); setArgsDirty(true); }} />
                  </div>
                ))}
                <div className="loop-adp__tabfoot">
                  <Button icon={<Plus size={14} />} onClick={() => { setArgs([...args, ""]); setArgsDirty(true); }}>{t("loop.squad.add")}</Button>
                  <Button theme="solid" icon={<Save size={14} />} disabled={!argsDirty}
                    onClick={async () => { await patch({ name: agent.name, custom_args: args.filter((x) => x.trim()) }); setArgsDirty(false); Toast.success(t("loop.toast.saved")); }}>
                    {t("loop.action.save")}
                  </Button>
                </div>
              </div>
            </TabPane>
          </Tabs>
        </section>
      </div>
    </div>
  );
}
