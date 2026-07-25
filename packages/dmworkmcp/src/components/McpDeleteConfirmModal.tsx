import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { t, useI18n, WKButton, WKModal } from "@octo/base";
import type { McpListItem } from "../types/mcp";
import { deleteMcp } from "../api/mcpService";

interface McpDeleteConfirmModalProps {
  item: McpListItem | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

export default function McpDeleteConfirmModal({ item, onClose, onDeleted }: McpDeleteConfirmModalProps) {
  useI18n();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state when the target changes (including transition to
  // hidden via `null`) — otherwise a prior item's error banner or the
  // loading spinner would flash into the next open.
  useEffect(() => {
    setError(null);
    setDeleting(false);
  }, [item]);

  async function submit() {
    if (!item) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteMcp(item.id);
      onDeleted(item.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mcp.delete.failed"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <WKModal
      visible={Boolean(item)}
      onCancel={onClose}
      title={t("mcp.delete.confirmTitle")}
      footer={
        <>
          <WKButton variant="secondary" onClick={onClose} disabled={deleting}>
            {t("mcp.delete.cancel")}
          </WKButton>
          <WKButton variant="danger" onClick={() => void submit()} loading={deleting}>
            {t("mcp.delete.ok")}
          </WKButton>
        </>
      }
    >
      <div className="wk-mcp-delete">
        <AlertTriangle size={22} />
        <div>
          <strong>{item?.name ?? ""}</strong>
          <p>{t("mcp.delete.confirmBody")}</p>
          {error && <p className="wk-mcp-delete__error">{error}</p>}
        </div>
      </div>
    </WKModal>
  );
}
