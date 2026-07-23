import React, { useEffect, useState } from "react";
import { Button, Input, Modal, Popconfirm, Toast } from "@douyinfe/semi-ui";
import { Check, Edit3, Plus, Save, Trash2, X } from "lucide-react";
import { useI18n } from "@octo/base";
import type { IssueLabel } from "../api/types";
import {
  createLabel,
  deleteLabel,
  attachLabel,
  detachLabel,
  listLabels,
  updateLabel,
} from "../api/labelApi";
import LabelChips from "./LabelChips";
import LabelColorPicker from "./LabelColorPicker";
import { DEFAULT_LABEL_COLOR, normalizeLabelColor } from "./labelPalette";

export default function LabelManagementModal({
  visible,
  onClose,
  onChanged,
  issueId,
  attachedLabelIds,
}: {
  visible: boolean;
  onClose: () => void;
  onChanged?: (labels: IssueLabel[]) => void;
  issueId?: string;
  attachedLabelIds?: string[];
}) {
  const { t } = useI18n();
  const [labels, setLabels] = useState<IssueLabel[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_LABEL_COLOR);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingColor, setEditingColor] = useState<string>(DEFAULT_LABEL_COLOR);
  const [localAttachedIds, setLocalAttachedIds] = useState<string[]>([]);
  const attached = new Set(localAttachedIds);

  const reload = async (notify = false) => {
    setLoading(true);
    try {
      const rows = await listLabels();
      setLabels(rows);
      if (notify) onChanged?.(rows);
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    setName("");
    setColor(DEFAULT_LABEL_COLOR);
    setEditingId(null);
    setLocalAttachedIds(attachedLabelIds ?? []);
    reload();
  }, [visible]);

  useEffect(() => {
    if (visible) setLocalAttachedIds(attachedLabelIds ?? []);
  }, [attachedLabelIds, visible]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await createLabel(trimmed, color);
      setName("");
      setColor(DEFAULT_LABEL_COLOR);
      await reload(true);
      Toast.success(t("loop.label.created"));
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.label.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = (label: IssueLabel) => {
    setEditingId(label.id);
    setEditingName(label.name);
    setEditingColor(normalizeLabelColor(label.color));
  };

  const saveEdit = async () => {
    if (!editingId || !editingName.trim() || busy) return;
    setBusy(true);
    try {
      await updateLabel(editingId, {
        name: editingName.trim(),
        color: editingColor,
      });
      setEditingId(null);
      await reload(true);
      Toast.success(t("loop.label.updated"));
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.label.updateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (label: IssueLabel) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteLabel(label.id);
      if (editingId === label.id) setEditingId(null);
      await reload(true);
      Toast.success(t("loop.label.deleted"));
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.label.deleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const toggleIssueLabel = async (label: IssueLabel) => {
    if (!issueId || busy) return;
    setBusy(true);
    try {
      if (attached.has(label.id)) {
        await detachLabel(issueId, label.id);
        setLocalAttachedIds((ids) => ids.filter((id) => id !== label.id));
      } else {
        await attachLabel(issueId, label.id);
        setLocalAttachedIds((ids) => [...ids, label.id]);
      }
      onChanged?.(labels);
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      className="loop-modal"
      title={t("loop.label.manageTitle")}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={560}
    >
      <div className="loop-label-mgr">
        <div className="loop-fields__row">
          <div className="loop-fields__label">
            {t("loop.label.newPlaceholder")}
          </div>
          <div className="loop-label-mgr__create">
            <Input
              value={name}
              onChange={setName}
              placeholder={t("loop.label.newPlaceholder")}
              onEnterPress={create}
              disabled={busy}
            />
            <Button
              theme="solid"
              icon={<Plus size={14} />}
              onClick={create}
              loading={busy}
              disabled={!name.trim()}
            >
              {t("loop.label.create")}
            </Button>
          </div>
          <LabelColorPicker
            value={color}
            onChange={setColor}
            ariaLabel={t("loop.label.color")}
          />
        </div>

        <div className="loop-label-mgr__list" aria-busy={loading}>
          {labels.length === 0 && !loading ? (
            <div className="loop-label-mgr__empty">{t("loop.label.empty")}</div>
          ) : (
            labels.map((label) => {
              const editing = editingId === label.id;
              return (
                <div key={label.id} className="loop-label-mgr__row">
                  {editing ? (
                    <div className="loop-label-mgr__edit">
                      <Input
                        value={editingName}
                        onChange={setEditingName}
                        onEnterPress={saveEdit}
                        disabled={busy}
                      />
                      <LabelColorPicker
                        value={editingColor}
                        onChange={setEditingColor}
                        ariaLabel={t("loop.label.color")}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`loop-label-mgr__pick${
                        attached.has(label.id) ? " is-active" : ""
                      }`}
                      onClick={() => toggleIssueLabel(label)}
                    >
                      <LabelChips labels={[label]} />
                      {attached.has(label.id) && <Check size={14} />}
                    </button>
                  )}
                  <div className="loop-label-mgr__actions">
                    {editing ? (
                      <>
                        <Button
                          size="small"
                          icon={<Save size={13} />}
                          onClick={saveEdit}
                          loading={busy}
                          disabled={!editingName.trim()}
                          aria-label={t("loop.action.save")}
                        />
                        <Button
                          size="small"
                          type="tertiary"
                          icon={<X size={13} />}
                          onClick={() => setEditingId(null)}
                          aria-label={t("loop.action.cancel")}
                        />
                      </>
                    ) : (
                      <Button
                        size="small"
                        type="tertiary"
                        icon={<Edit3 size={13} />}
                        onClick={() => beginEdit(label)}
                        aria-label={t("loop.label.edit")}
                      />
                    )}
                    <Popconfirm
                      title={t("loop.label.deleteConfirm")}
                      content={t("loop.label.deleteConfirmDesc")}
                      onConfirm={() => remove(label)}
                    >
                      <Button
                        size="small"
                        type="danger"
                        theme="borderless"
                        icon={<Trash2 size={13} />}
                        aria-label={t("loop.label.delete")}
                      />
                    </Popconfirm>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
