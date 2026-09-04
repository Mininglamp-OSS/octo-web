import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { t, useI18n, WKButton, WKModal } from "@octo/base";

/** Server-side cap on `reason`, shared with the reject path. */
const MAX_DELIST_REASON_LENGTH = 1000;

interface DelistReasonModalProps {
  visible: boolean;
  pluginName?: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
}

/**
 * Confirmation for 下架.
 *
 * Unlike reject, the reason is OPTIONAL — the server accepts an empty one and
 * substitutes its own audit note. It is still asked for, because a takedown is
 * something an admin does to somebody else's work and the author sees the reason
 * on the request this cancels.
 *
 * The dialog exists at all because delisting is not reversible by the person who
 * performs it: only the author can publish again.
 */
export default function DelistReasonModal({
  visible,
  pluginName,
  onClose,
  onConfirm,
}: DelistReasonModalProps) {
  useI18n();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on close, not only via handleClose: a caller can close by flipping
  // `visible` directly (bypassing handleClose) and this instance survives across
  // targets, so a leftover reason would otherwise pre-fill the next 下架.
  useEffect(() => {
    if (!visible) {
      setReason("");
      setError(null);
    }
  }, [visible]);

  function handleClose() {
    if (submitting) return;
    setReason("");
    setError(null);
    onClose();
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("skillMarket.review.actionFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <WKModal
      visible={visible}
      onCancel={handleClose}
      title={t("skillMarket.review.delistModalTitle")}
      footer={
        <>
          <WKButton variant="secondary" onClick={handleClose} disabled={submitting}>
            {t("skillMarket.common.cancel")}
          </WKButton>
          <WKButton variant="danger" onClick={() => void handleSubmit()} loading={submitting}>
            {t("skillMarket.plugin.actionDelist")}
          </WKButton>
        </>
      }
    >
      <div className="skill-market-reject-form">
        <AlertTriangle size={22} />
        <div>
          <strong>
            {pluginName
              ? t("skillMarket.review.delistModalHeadingNamed", { values: { name: pluginName } })
              : t("skillMarket.review.delistModalHeading")}
          </strong>
          <p>{t("skillMarket.review.delistModalHint")}</p>
          <textarea
            aria-label={t("skillMarket.review.delistReasonLabel")}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (error) setError(null);
            }}
            placeholder={t("skillMarket.review.delistReasonPlaceholder")}
            rows={3}
            maxLength={MAX_DELIST_REASON_LENGTH}
            disabled={submitting}
          />
          {error && <p className="skill-market-reject-form__error">{error}</p>}
        </div>
      </div>
    </WKModal>
  );
}
