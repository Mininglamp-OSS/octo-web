import React, { useState } from "react";
import { Dropdown, Toast } from "@douyinfe/semi-ui";
import { Check, Settings2, Tag } from "lucide-react";
import { useI18n } from "@octo/base";
import type { IssueLabel } from "../api/types";
import { attachLabel, detachLabel, listLabels } from "../api/labelApi";
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
  const attachedLabels = labels ?? [];
  const attached = new Set(attachedLabels.map((label) => label.id));

  const loadAll = () =>
    listLabels()
      .then(setAll)
      .catch(() => {});

  const toggle = async (label: IssueLabel) => {
    if (busy) return;
    setBusy(true);
    try {
      if (attached.has(label.id)) await detachLabel(issueId, label.id);
      else await attachLabel(issueId, label.id);
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
      {all.map((label) => {
        const active = attached.has(label.id);
        return (
          <Dropdown.Item key={label.id} onClick={() => toggle(label)}>
            <span className="loop-label-option">
              <LabelChips labels={[label]} />
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
      <Dropdown
        trigger="click"
        position="bottomRight"
        render={menu}
        onVisibleChange={(visible) => visible && loadAll()}
      >
        <div className={`loop-label-editor${className ? ` ${className}` : ""}`}>
          {attachedLabels.length > 0 ? (
            <button type="button" className="loop-label-chipbutton">
              <LabelChips labels={attachedLabels} />
            </button>
          ) : (
            <button type="button" className="loop-label-add">
              <Tag size={13} />
              {t("loop.label.add")}
            </button>
          )}
        </div>
      </Dropdown>
      <LabelManagementModal
        visible={manageOpen}
        onClose={() => setManageOpen(false)}
        issueId={issueId}
        attachedLabelIds={attachedLabels.map((label) => label.id)}
        onChanged={() => {
          onChanged();
        }}
      />
    </>
  );
}
