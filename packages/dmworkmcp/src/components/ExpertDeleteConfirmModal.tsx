import React from "react";
import { AlertTriangle } from "lucide-react";
import { t, useI18n, WKButton, WKModal } from "@octo/base";
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
    <WKModal
      visible={Boolean(item)}
      onCancel={onClose}
      title={t("mcp.expert.deleteConfirmTitle")}
      footer={
        <>
          <WKButton variant="secondary" onClick={onClose}>
            {t("mcp.expert.deleteCancel")}
          </WKButton>
          <WKButton variant="danger" onClick={submit}>
            {t("mcp.expert.deleteOk")}
          </WKButton>
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
    </WKModal>
  );
}
