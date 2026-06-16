import React, { useState, useEffect } from "react";
import { Checkbox, Spin } from "@douyinfe/semi-ui";
import DOMPurify from "dompurify";
import WKModal from "../WKModal";
import WKButton from "../WKButton";
import { getDocument } from "../../Service/DocumentService";
import { useI18n } from "../../i18n";

interface VoiceFeedbackNoticeProps {
  onAccept: (feedbackOn: boolean) => Promise<void> | void;
  onCancel: () => void;
  feedbackPrivacyUrl?: string;
  feedbackUserAgreementUrl?: string;
}

export default function VoiceFeedbackNotice({
  onAccept,
  onCancel,
  feedbackPrivacyUrl,
  feedbackUserAgreementUrl,
}: VoiceFeedbackNoticeProps) {
  const { t } = useI18n();
  const [feedbackChecked, setFeedbackChecked] = useState(false);
  const [docContent, setDocContent] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(true);
  const [docError, setDocError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDocument("asr_service_doc")
      .then((doc) => {
        if (!cancelled) setDocContent(doc.content);
      })
      .catch(() => {
        if (!cancelled) setDocError(true);
      })
      .finally(() => {
        if (!cancelled) setDocLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const hasLinks = feedbackPrivacyUrl || feedbackUserAgreementUrl;
  const acceptDisabled =
    docLoading || submitting || (docError && !feedbackPrivacyUrl && !feedbackUserAgreementUrl);

  const handleAccept = async () => {
    setSubmitting(true);
    try {
      await onAccept(feedbackChecked);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <WKModal
      visible
      title={t("base.navRail.voiceNotice.title")}
      onCancel={onCancel}
      options={{ closeOnEsc: true, maskClosable: false }}
      footer={
        <div className="wk-modal-footer-fill" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ borderTop: "1px solid var(--semi-color-border)", margin: 0 }} />
          <Checkbox
            checked={feedbackChecked}
            onChange={(e) => setFeedbackChecked(e.target.checked)}
          >
            {t("base.navRail.voiceNotice.feedbackConsent")}
          </Checkbox>
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <WKButton onClick={onCancel}>{t("base.common.cancel")}</WKButton>
            <WKButton variant="primary" onClick={handleAccept} disabled={acceptDisabled}>
              {t("base.navRail.voiceNotice.accept")}
            </WKButton>
          </div>
        </div>
      }
    >
      <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--semi-color-text-2)", maxHeight: 400, overflowY: "auto" }}>
        {docLoading && (
          <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
            <Spin />
          </div>
        )}
        {docError && !docLoading && (
          <div style={{ color: "var(--semi-color-warning)", padding: "8px 0" }}>
            {t("base.navRail.voiceNotice.loadFailed")}
          </div>
        )}
        {docContent && (
          <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(docContent) }} />
        )}
        {hasLinks && (
          <p style={{ margin: "12px 0 0" }}>
            {t("base.navRail.voiceNotice.detailsPrefix")}
            {feedbackPrivacyUrl && (
              <a
                href={feedbackPrivacyUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--semi-color-link)" }}
              >
                {t("base.navRail.voiceSettings.privacyPolicy")}
              </a>
            )}
            {feedbackPrivacyUrl && feedbackUserAgreementUrl && t("base.navRail.voiceNotice.and")}
            {feedbackUserAgreementUrl && (
              <a
                href={feedbackUserAgreementUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--semi-color-link)" }}
              >
                {t("base.navRail.voiceSettings.userAgreement")}
              </a>
            )}
          </p>
        )}
      </div>
    </WKModal>
  );
}
