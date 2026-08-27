import { Button, Modal as OctoModal } from "@octo/ui";
import React from "react";
import { AlertTriangle } from "lucide-react";
import { t, useI18n } from "@octo/base";
import type { ExpertItem } from "../mock/expertMock";

interface ExpertDeleteConfirmModalProps {
  item: ExpertItem | null;
  onClose: () => void;
  onConfirm: (id: string) => void;
}

/**
 * Delete confirmation for an owned expert / squad in the 我的 tab. Mirrors
 * McpDeleteConfirmModal's layout. Confirming hands the id back to the page,
 * which calls the expert / squad DELETE endpoint and reloads the list.
 */
export default function ExpertDeleteConfirmModal({
  item,
  onClose,
  onConfirm,
}: ExpertDeleteConfirmModalProps) {
  useI18n();

  const submit = () => {
    if (!item) return;
    onConfirm(item.id);
    onClose();
  };

  return (
    <OctoModal
      visible={Boolean(item)}
      onCancel={onClose}
      title={t("mcp.expert.deleteConfirmTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("mcp.expert.deleteCancel")}
          </Button>
          <Button variant="danger" onClick={submit}>
            {t("mcp.expert.deleteOk")}
          </Button>
        </>
      }
    >
      <div className="wk-mcp-delete">
        <AlertTriangle size={22} />
        <div>
          <strong>{item?.name ?? ""}</strong>
          <p>{t("mcp.expert.deleteConfirmBody")}</p>
        </div>
      </div>
    </OctoModal>
  );
}
