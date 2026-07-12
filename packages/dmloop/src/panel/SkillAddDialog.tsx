import React, { useEffect, useMemo, useState } from "react";
import { Modal, Input, Checkbox, Spin, Typography, Toast } from "@douyinfe/semi-ui";
import { Search, FileText } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Skill } from "../api/types";
import { listSkills } from "../api/skillApi";

const { Text } = Typography;

/**
 * 为 Agent 追加技能的选择弹窗：
 * 拉取工作区技能、过滤掉已挂载的、可搜索多选，确认后与已挂载合并交给父组件保存。
 */
export default function SkillAddDialog({
  visible,
  attachedIds,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  attachedIds: string[];
  onClose: () => void;
  onConfirm: (mergedIds: string[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const [all, setAll] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [kw, setKw] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setKw(""); setSelected(new Set());
    setLoading(true);
    listSkills().then(setAll).catch(() => setAll([])).finally(() => setLoading(false));
  }, [visible]);

  const attached = useMemo(() => new Set(attachedIds), [attachedIds]);
  const filtered = useMemo(() => {
    const q = kw.trim().toLowerCase();
    return all
      .filter((s) => !attached.has(s.id))
      .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q));
  }, [all, attached, kw]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const confirm = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await onConfirm([...attachedIds, ...selected]);
      onClose();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      className="loop-modal"
      title={t("loop.agent.addSkillTitle")}
      visible={visible}
      onCancel={onClose}
      onOk={confirm}
      okText={t("loop.agent.addSkillConfirm", { values: { count: selected.size } })}
      cancelText={t("loop.action.cancel")}
      okButtonProps={{ loading: saving, disabled: selected.size === 0 }}
    >
      <div className="loop-adp__skilldlg">
        <Input className="loop-search" prefix={<Search size={14} />} placeholder={t("loop.agent.addSkillSearch")} value={kw} onChange={setKw} showClear />
        <div className="loop-adp__skilldlg-list">
          {loading ? (
            <div className="loop-adp__skilldlg-center"><Spin /></div>
          ) : filtered.length === 0 ? (
            <div className="loop-adp__skilldlg-center">
              <Text type="tertiary" style={{ fontSize: 13 }}>{t("loop.agent.addSkillEmpty")}</Text>
            </div>
          ) : (
            filtered.map((s) => (
              <button key={s.id} type="button" className={`loop-adp__skilldlg-row ${selected.has(s.id) ? "is-sel" : ""}`} onClick={() => toggle(s.id)}>
                <Checkbox checked={selected.has(s.id)} />
                <FileText size={15} className="loop-adp__skilldlg-ico" />
                <span className="loop-adp__skilldlg-main">
                  <span className="loop-adp__skilldlg-name">{s.name}</span>
                  {s.description && <span className="loop-adp__skilldlg-desc">{s.description}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
