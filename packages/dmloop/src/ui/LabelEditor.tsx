import React, { useState } from "react";
import { Dropdown, Input, Button, Toast } from "@douyinfe/semi-ui";
import { Check, Plus } from "lucide-react";
import { useI18n } from "@octo/base";
import type { IssueLabel } from "../api/types";
import { listLabels, createLabel, attachLabel, detachLabel } from "../api/labelApi";
import LabelChips from "./LabelChips";

// issue 标签编辑器:点开下拉列出工作区标签(勾选=挂/摘),底部内联建新标签并挂上。
// UI 从简(默认色,取色器等留待 UI 定稿);核心是把挂/摘/建标签能力接上后端。
export default function LabelEditor({
  issueId,
  labels,
  onChanged,
}: {
  issueId: string;
  labels?: IssueLabel[] | null;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [all, setAll] = useState<IssueLabel[]>([]);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const attached = new Set((labels ?? []).map((l) => l.id));

  const loadAll = () => listLabels().then(setAll).catch(() => {});

  const toggle = async (l: IssueLabel) => {
    if (busy) return;
    setBusy(true);
    try {
      if (attached.has(l.id)) await detachLabel(issueId, l.id);
      else await attachLabel(issueId, l.id);
      onChanged();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const label = await createLabel(name, "#8B5CF6"); // 默认紫,取色留待 UI 定稿
      await attachLabel(issueId, label.id);
      setNewName("");
      await loadAll();
      onChanged();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const menu = (
    <Dropdown.Menu>
      {all.map((l) => (
        <Dropdown.Item key={l.id} onClick={() => toggle(l)}>
          <span style={{ flex: 1, marginRight: 8 }}>{l.name}</span>
          {attached.has(l.id) && <Check size={14} />}
        </Dropdown.Item>
      ))}
      <Dropdown.Divider />
      <div style={{ padding: "4px 8px", display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
        <Input
          size="small"
          value={newName}
          onChange={setNewName}
          placeholder={t("loop.label.newPlaceholder")}
          onEnterPress={create}
          style={{ width: 130 }}
        />
        <Button size="small" icon={<Plus size={14} />} onClick={create} loading={busy} aria-label={t("loop.label.create")} />
      </div>
    </Dropdown.Menu>
  );

  // clickToHide 默认 false:勾选多个标签时下拉保持打开;每次打开重新拉全量标签。
  return (
    <Dropdown trigger="click" position="bottomLeft" render={menu} onVisibleChange={(v) => v && loadAll()}>
      <span style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
        {labels && labels.length > 0 ? <LabelChips labels={labels} /> : <span style={{ opacity: 0.5 }}>{t("loop.label.add")}</span>}
      </span>
    </Dropdown>
  );
}
