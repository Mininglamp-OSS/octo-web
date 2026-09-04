import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { t, useI18n, WKButton, WKModal } from "@octo/base";

/** Server-side cap on `reason` for `POST /plugins/review_requests/{id}/reject`. */
const MAX_REJECT_REASON_LENGTH = 1000;

interface RejectReasonModalProps {
  visible: boolean;
  title?: string;
  pluginName?: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
}

export default function RejectReasonModal({
  visible,
  title,
  pluginName,
  onClose,
  onConfirm,
}: RejectReasonModalProps) {
  useI18n();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on close, not only via handleClose: a failed reject can close the
  // modal by flipping `visible` directly (ReviewDetailDrawer setRejectOpen(false)),
  // bypassing handleClose, and this instance survives a change of `review`. Left
  // to handleClose alone, a 409'd reason stays in the box and pre-fills 拒绝 on
  // the NEXT request — one confirm would write the previous plugin's reason here.
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
    const trimmed = reason.trim();
    // The server answers an empty reason with 400; block it here so the
    // reviewer gets an inline hint instead of a wire-shaped API error.
    if (!trimmed) {
      setError(t("skillMarket.review.rejectReasonRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(trimmed);
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
      title={title ?? t("skillMarket.review.rejectModalTitle")}
      footer={
        <>
          <WKButton variant="secondary" onClick={handleClose} disabled={submitting}>
            {t("skillMarket.common.cancel")}
          </WKButton>
          <WKButton variant="danger" onClick={() => void handleSubmit()} loading={submitting}>
            {t("skillMarket.review.rejectConfirm")}
          </WKButton>
        </>
      }
    >
      <div className="skill-market-reject-form">
        <AlertTriangle size={22} />
        <div>
          <strong>
            {pluginName
              ? t("skillMarket.review.rejectModalHeadingNamed", { values: { name: pluginName } })
              : t("skillMarket.review.rejectModalHeading")}
          </strong>
          <p>{t("skillMarket.review.rejectModalHint")}</p>
          <textarea
            aria-label={t("skillMarket.review.reasonFieldLabel")}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (error) setError(null);
            }}
            placeholder={t("skillMarket.review.rejectReasonPlaceholder")}
            rows={4}
            maxLength={MAX_REJECT_REASON_LENGTH}
            disabled={submitting}
          />
          {error && <p className="skill-market-reject-form__error">{error}</p>}
        </div>
      </div>
    </WKModal>
  );
}
