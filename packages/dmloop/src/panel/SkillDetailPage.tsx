import React, { useEffect, useState } from "react";
import { Typography, Input, Button, Spin, Tag, Toast, TextArea, Banner } from "@douyinfe/semi-ui";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Skill } from "../api/types";
import { getSkill, updateSkill, deleteSkill, skillSource } from "../api/skillApi";
import "./sideDetail.css";

const { Text } = Typography;
const SRC: Record<string, "green" | "blue" | "grey"> = { github: "green", local: "blue", workspace: "grey" };

/** Skill 独立详情页：左侧元信息 + 右侧内容编辑。 */
export default function SkillDetailPage({ skillId, onChanged }: { skillId: string; onChanged?: () => void }) {
  const { t } = useI18n();
  const [row, setRow] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getSkill(skillId)
      .then((s) => { setRow(s); setName(s.name); setDesc(s.description); setContent(s.content ?? ""); setDirty(false); })
      .catch((e) => setError(e?.message ?? "load failed"))
      .finally(() => setLoading(false));
  }, [skillId]);

  const back = () => WKApp.routeRight.pop();
  const save = async () => {
    if (!name.trim()) { Toast.warning(t("loop.validate.nameRequired")); return; }
    try { await updateSkill(skillId, { name: name.trim(), description: desc, content }); setDirty(false); Toast.success(t("loop.toast.saved")); onChanged?.(); }
    catch (e) { Toast.error((e as Error)?.message ?? "save failed"); }
  };
  const remove = async () => {
    try { await deleteSkill(skillId); Toast.success(t("loop.toast.deleted")); onChanged?.(); back(); }
    catch (e) { Toast.error((e as Error)?.message ?? "delete failed"); }
  };

  if (loading) return <div className="loop-sd"><div className="loop-sd__center"><Spin /></div></div>;
  if (error || !row) return <div className="loop-sd"><div className="loop-sd__topbar"><Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button></div><div className="loop-sd__center">{error ? <Banner type="danger" description={error} /> : <Text type="tertiary">{t("loop.detail.notFound")}</Text>}</div></div>;

  const src = skillSource(row);

  return (
    <div className="loop-sd">
      <div className="loop-sd__topbar">
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button>
        <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.detail.skillTitle")}</Text>
        <div style={{ flex: 1 }} />
        <Button theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={remove}>{t("loop.action.delete")}</Button>
        <Button theme="solid" icon={<Save size={14} />} disabled={!dirty} onClick={save}>{t("loop.action.save")}</Button>
      </div>
      <div className="loop-sd__body">
        <aside className="loop-sd__aside">
          <div className="loop-detail__section-title">{t("loop.field.name")}</div>
          <Input value={name} onChange={(v) => { setName(v); setDirty(true); }} />
          <div className="loop-detail__section-title" style={{ marginTop: 14 }}>{t("loop.field.description")}</div>
          <TextArea value={desc} onChange={(v) => { setDesc(v); setDirty(true); }} autosize={{ minRows: 2, maxRows: 5 }} />
          <div className="loop-detail__section-title" style={{ marginTop: 14 }}>{t("loop.skill.source")}</div>
          <Tag color={SRC[src]} size="small">{t(`loop.skill.sourceType.${src}`)}</Tag>
        </aside>
        <section className="loop-sd__main">
          <div className="loop-detail__section-title">{t("loop.skill.content")}</div>
          <TextArea value={content} onChange={(v) => { setContent(v); setDirty(true); }} autosize={{ minRows: 16, maxRows: 40 }} className="loop-mono" />
        </section>
      </div>
    </div>
  );
}
