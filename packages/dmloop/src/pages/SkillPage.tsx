import React, { useCallback, useEffect, useState } from "react";
import {
  Typography, Input, Button, Table, Tag, Spin, Modal, Toast, Popconfirm, TextArea, Banner,
  Tabs, TabPane, Select, Checkbox,
} from "@douyinfe/semi-ui";
import { Search, Plus, Trash2, Sparkles, Download, Monitor, Globe, FileText } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Skill, RuntimeDevice, RuntimeLocalSkillSummary } from "../api/types";
import {
  listSkills, createSkill, deleteSkill, skillSource, importSkill,
  fetchRuntimeSkills, importRuntimeSkill,
} from "../api/skillApi";
import { listRuntimes } from "../api/runtimeApi";
import SkillDetailPage from "../panel/SkillDetailPage";
import { confirmDelete } from "../ui/confirmDelete";

const { Title, Text } = Typography;
const SRC: Record<string, "green" | "blue" | "grey"> = { github: "green", local: "blue", workspace: "grey" };

export default function SkillPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  // local
  const [nName, setNName] = useState("");
  const [nDesc, setNDesc] = useState("");
  const [nContent, setNContent] = useState("");
  // web
  const [webUrl, setWebUrl] = useState("");
  const [webBusy, setWebBusy] = useState(false);
  // runtime
  const [runtimes, setRuntimes] = useState<RuntimeDevice[]>([]);
  const [rtId, setRtId] = useState<string | undefined>();
  const [rtBusy, setRtBusy] = useState(false);
  const [rtSkills, setRtSkills] = useState<RuntimeLocalSkillSummary[]>([]);
  const [rtErr, setRtErr] = useState<string | null>(null);
  const [rtPicked, setRtPicked] = useState<Set<string>>(new Set());

  const reload = useCallback(() => {
    setLoading(true); setError(null);
    listSkills({ keyword }).then(setRows).catch((e) => setError(e?.message ?? "load failed")).finally(() => setLoading(false));
  }, [keyword]);
  useEffect(reload, [reload]);

  const openDetail = (id: string) => WKApp.routeRight.push(<SkillDetailPage skillId={id} onChanged={reload} />);

  const openCreate = () => {
    setCreateOpen(true);
    setNName(""); setNDesc(""); setNContent(""); setWebUrl("");
    setRtSkills([]); setRtPicked(new Set()); setRtErr(null);
    listRuntimes().then((rs) => { setRuntimes(rs); if (rs[0]) setRtId(rs[0].id); }).catch(() => setRuntimes([]));
  };

  const createLocal = async () => {
    if (!nName.trim()) { Toast.warning(t("loop.validate.nameRequired")); return; }
    try { await createSkill({ name: nName.trim(), description: nDesc, content: nContent }); setCreateOpen(false); Toast.success(t("loop.toast.created")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "create failed"); }
  };
  const importFromWeb = async () => {
    if (!webUrl.trim()) { Toast.warning(t("loop.skill.urlRequired")); return; }
    setWebBusy(true);
    try { await importSkill(webUrl.trim()); setCreateOpen(false); Toast.success(t("loop.toast.created")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "import failed"); }
    finally { setWebBusy(false); }
  };
  const loadRuntimeSkills = async () => {
    if (!rtId) return;
    setRtBusy(true); setRtErr(null); setRtSkills([]); setRtPicked(new Set());
    try {
      const res = await fetchRuntimeSkills(rtId);
      if (!res.supported) setRtErr(t("loop.skill.rtUnsupported"));
      else if (res.error) setRtErr(res.error);
      else setRtSkills(res.skills);
    } catch (e) { setRtErr((e as Error)?.message ?? "failed"); }
    finally { setRtBusy(false); }
  };
  const importFromRuntime = async () => {
    if (!rtId || rtPicked.size === 0) return;
    setRtBusy(true);
    try {
      let ok = 0;
      for (const key of rtPicked) {
        const sk = rtSkills.find((s) => s.key === key);
        const res = await importRuntimeSkill(rtId, key, sk?.name);
        if (res.status === "completed" || res.skill) ok += 1;
      }
      setCreateOpen(false);
      Toast.success(`${t("loop.skill.imported")} (${ok})`);
      reload();
    } catch (e) { Toast.error((e as Error)?.message ?? "import failed"); }
    finally { setRtBusy(false); }
  };
  const remove = async (id: string) => {
    try { await deleteSkill(id); Toast.success(t("loop.toast.deleted")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "delete failed"); }
  };

  const columns = [
    { title: t("loop.field.name"), dataIndex: "name", render: (v: string, r: Skill) => <span className="loop-cell-title" onClick={() => openDetail(r.id)}>{v}</span> },
    { title: t("loop.field.description"), dataIndex: "description", render: (v: string) => <Text type="tertiary">{v || "—"}</Text> },
    { title: t("loop.skill.source"), dataIndex: "id", width: 120, render: (_v: string, r: Skill) => { const s = skillSource(r); return <Tag color={SRC[s]} size="small">{t(`loop.skill.sourceType.${s}`)}</Tag>; } },
    { title: "", dataIndex: "id", width: 60, render: (v: string) => <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} onClick={() => confirmDelete({ title: t("loop.confirm.delete"), okText: t("loop.action.delete"), cancelText: t("loop.action.cancel"), onOk: () => remove(v) })} /> },
  ];

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.skill")}</Title>
        <div className="loop-page__spacer" />
        <Input prefix={<Search size={14} />} placeholder={t("loop.search.skill")} value={keyword} onChange={setKeyword} showClear style={{ width: 220 }} />
        <Button theme="solid" icon={<Plus size={14} />} onClick={openCreate}>{t("loop.action.newSkill")}</Button>
      </div>
      <div className="loop-page__body">
        {error ? <Banner type="danger" description={error} />
          : loading ? <div className="loop-page__center"><Spin /></div>
          : rows.length === 0 ? (
            <div className="loop-empty">
              <Sparkles size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.empty.skillTitle")}</div>
              <div className="loop-empty__desc">{t("loop.empty.skillDesc")}</div>
              <Button theme="solid" icon={<Plus size={14} />} onClick={openCreate} style={{ marginTop: 12 }}>{t("loop.action.newSkill")}</Button>
            </div>
          ) : <Table rowKey="id" columns={columns} dataSource={rows} pagination={false} size="small" />}
      </div>

      <Modal title={t("loop.action.newSkill")} visible={createOpen} onCancel={() => setCreateOpen(false)} footer={null} width={620}>
        <Tabs type="line">
          {/* 本地 */}
          <TabPane tab={<span><FileText size={13} style={{ marginRight: 6 }} />{t("loop.skill.local")}</span>} itemKey="local">
            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
              <div><div className="loop-detail__section-title">{t("loop.field.name")}</div><Input value={nName} onChange={setNName} /></div>
              <div><div className="loop-detail__section-title">{t("loop.field.description")}</div><Input value={nDesc} onChange={setNDesc} /></div>
              <div><div className="loop-detail__section-title">{t("loop.skill.content")}</div><TextArea value={nContent} onChange={setNContent} autosize={{ minRows: 5, maxRows: 12 }} /></div>
              <div style={{ textAlign: "right" }}><Button theme="solid" onClick={createLocal}>{t("loop.action.create")}</Button></div>
            </div>
          </TabPane>

          {/* 从 web 拷贝 */}
          <TabPane tab={<span><Globe size={13} style={{ marginRight: 6 }} />{t("loop.skill.fromWeb")}</span>} itemKey="web">
            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
              <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.skill.fromWebHint")}</Text>
              <Input value={webUrl} onChange={setWebUrl} placeholder="https://www.skills.sh/owner/repo/skill" />
              <div style={{ textAlign: "right" }}><Button theme="solid" loading={webBusy} icon={<Download size={14} />} onClick={importFromWeb}>{t("loop.skill.import")}</Button></div>
            </div>
          </TabPane>

          {/* 从运行时拷贝 */}
          <TabPane tab={<span><Monitor size={13} style={{ marginRight: 6 }} />{t("loop.skill.fromRuntime")}</span>} itemKey="runtime">
            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <Select value={rtId} onChange={(v) => setRtId(v as string)} style={{ flex: 1 }} placeholder={t("loop.agent.runtime")}>
                  {runtimes.map((r) => <Select.Option key={r.id} value={r.id}>{r.name}（{r.provider}）</Select.Option>)}
                </Select>
                <Button loading={rtBusy} onClick={loadRuntimeSkills}>{t("loop.skill.fetch")}</Button>
              </div>
              {rtErr && <Banner type="warning" description={rtErr} closeIcon={null} />}
              {rtBusy && rtSkills.length === 0 && !rtErr && <div style={{ textAlign: "center", padding: 16 }}><Spin /></div>}
              {rtSkills.length > 0 && (
                <>
                  <div className="loop-skill-rtlist">
                    {rtSkills.map((s) => (
                      <label key={s.key} className="loop-skill-rtitem">
                        <Checkbox
                          checked={rtPicked.has(s.key)}
                          onChange={(e) => {
                            const next = new Set(rtPicked);
                            if (e.target.checked) next.add(s.key); else next.delete(s.key);
                            setRtPicked(next);
                          }}
                        />
                        <span className="loop-skill-rtitem__main">
                          <strong>{s.name}</strong>
                          {s.description && <small>{s.description}</small>}
                        </span>
                        {s.provider && <Tag size="small" color="grey">{s.provider}</Tag>}
                      </label>
                    ))}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Button theme="solid" loading={rtBusy} disabled={rtPicked.size === 0} icon={<Download size={14} />} onClick={importFromRuntime}>
                      {t("loop.skill.importSelected")}（{rtPicked.size}）
                    </Button>
                  </div>
                </>
              )}
            </div>
          </TabPane>
        </Tabs>
      </Modal>
    </div>
  );
}
