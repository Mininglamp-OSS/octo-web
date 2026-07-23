import React, { useState } from "react";
import { Dropdown, Toast } from "@douyinfe/semi-ui";
import { Check, Settings2 } from "lucide-react";
import { useI18n } from "@octo/base";
import type { IssueLabel } from "../api/types";
import { listLabels, attachLabel, detachLabel } from "../api/labelApi";
import LabelChips from "./LabelChips";
import LabelManagementModal from "./LabelManagementModal";

export default function LabelEditor({
  issueId,
  labels,
  onChanged,
  className,
}: {
  issueId: string;
  labels?: IssueLabel[] | null;
  onChanged: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const [all, setAll] = useState<IssueLabel[]>([]);
  const [busy, setBusy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const attached = new Set((labels ?? []).map((l) => l.id));

  const loadAll = () =>
    listLabels()
      .then(setAll)
      .catch(() => {});

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

  const menu = (
    <Dropdown.Menu>
      {all.length === 0 && (
        <Dropdown.Item disabled>{t("loop.label.empty")}</Dropdown.Item>
      )}
      {all.map((l) => {
        const active = attached.has(l.id);
        return (
          <Dropdown.Item key={l.id} onClick={() => toggle(l)}>
            <span className="loop-label-option">
              <LabelChips labels={[l]} />
              {active && <Check size={14} />}
            </span>
          </Dropdown.Item>
        );
      })}
      <Dropdown.Divider />
      <Dropdown.Item onClick={() => setManageOpen(true)}>
        <span className="loop-label-option loop-label-option--manage">
          <Settings2 size={14} />
          {t("loop.label.manage")}
        </span>
      </Dropdown.Item>
    </Dropdown.Menu>
  );

  return (
    <>
      <Dropdown trigger="click" position="bottomRight" render={menu} onVisibleChange={(v) => v && loadAll()}>
        <button type="button" className={`loop-label-editor${className ? ` ${className}` : ""}`}>
          {labels && labels.length > 0 ? <LabelChips labels={labels} /> : <span className="loop-label-editor__empty">{t("loop.label.add")}</span>}
        </button>
      </Dropdown>
      <LabelManagementModal
        visible={manageOpen}
        onClose={() => setManageOpen(false)}
        onChanged={(next) => {
          setAll(next);
          onChanged();
        }}
      />
    </>
  );
}
