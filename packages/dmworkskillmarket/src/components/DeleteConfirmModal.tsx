import { Button, Modal as OctoModal } from "@octo/ui";
import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { t, useI18n } from "@octo/base";
import type { Skill } from "../types/skill";
import { deleteSkill } from "../api/skillApi";

interface DeleteConfirmModalProps {
  skill: Skill | null;
  onClose: () => void;
  onDeleted: () => void;
}

export default function DeleteConfirmModal({ skill, onClose, onDeleted }: DeleteConfirmModalProps) {
  useI18n();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!skill) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSkill(skill.id);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("skillMarket.delete.failed"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <OctoModal
      visible={Boolean(skill)}
      onCancel={onClose}
      title={t("skillMarket.delete.title")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={deleting}>{t("skillMarket.common.cancel")}</Button>
          <Button variant="danger" onClick={() => void submit()} loading={deleting}>{t("skillMarket.common.delete")}</Button>
        </>
      }
    >
      <div className="skill-market-delete">
        <AlertTriangle size={22} />
        <div>
          <strong>{t("skillMarket.delete.confirmMessage", { values: { name: skill?.name ?? "" } })}</strong>
          <p>{t("skillMarket.delete.warning")}</p>
          {error && <p className="skill-market-delete__error">{error}</p>}
        </div>
      </div>
    </OctoModal>
  );
}
