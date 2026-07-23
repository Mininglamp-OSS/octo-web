import React, { useState } from "react";
import { Dropdown, Toast } from "@douyinfe/semi-ui";
import { Check, Settings2, Tag, X } from "lucide-react";
import { useI18n } from "@octo/base";
import type { IssueLabel } from "../api/types";
import { listLabels, attachLabel, detachLabel } from "../api/labelApi";
import LabelChips from "./LabelChips";
import LabelManagementModal from "./LabelManagementModal";

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

  const detach = async (label: IssueLabel) => {
    if (busy) return;
    setBusy(true);
    try {
      await detachLabel(issueId, label.id);
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
      <div className="loop-label-editor">
        <div className="loop-label-editor__chips">
          {(labels ?? []).map((label) => (
            <span
              key={label.id}
              className="loop-label-removable"
              style={
                { "--loop-chip-color": label.color } as React.CSSProperties
              }
            >
              <LabelChips labels={[label]} />
              <button
                type="button"
                onClick={() => detach(label)}
                aria-label={t("loop.label.remove", {
                  values: { name: label.name },
                })}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <Dropdown
          trigger="click"
          position="bottomLeft"
          render={menu}
          onVisibleChange={(v) => v && loadAll()}
        >
          <button type="button" className="loop-label-add">
            <Tag size={13} />
            {t("loop.label.add")}
          </button>
        </Dropdown>
      </div>
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
