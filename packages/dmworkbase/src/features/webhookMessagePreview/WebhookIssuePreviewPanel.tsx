import React from "react";
import WKApp from "../../App";
import type { WebhookIssuePreviewTarget } from "../../bridge/message/webhookPreview";
import { useI18n } from "../../i18n";
import ResizableRightPanel from "../../ui/ResizableRightPanel";
import "./index.css";

const WEBHOOK_ISSUE_PREVIEW_SIZE = {
  minWidth: 480,
  defaultWidth: 760,
  maxWidth: 1200,
  storageKey: "wk-webhook-issue-preview-panel-width",
  maxContainerRatio: 0.75,
};

export interface WebhookIssuePreviewPanelProps {
  target: WebhookIssuePreviewTarget;
  onClose: () => void;
}

export default function WebhookIssuePreviewPanel({
  target,
  onClose,
}: WebhookIssuePreviewPanelProps) {
  const { t } = useI18n();
  const content = WKApp.endpoints.chatWebhookIssuePreview(target);

  return (
    <ResizableRightPanel
      className="wk-webhook-issue-preview"
      title={t("base.message.webhookPreview.title", {
        values: { identifier: target.issueIdentifier },
      })}
      closeLabel={t("base.message.webhookPreview.close")}
      onClose={onClose}
      size={WEBHOOK_ISSUE_PREVIEW_SIZE}
    >
      {content ?? (
        <div className="wk-webhook-issue-preview__unavailable">
          <p>{t("base.message.webhookPreview.unavailable")}</p>
          <a href={target.sourceUrl} target="_blank" rel="noopener noreferrer">
            {t("base.message.webhookPreview.openSource")}
          </a>
        </div>
      )}
    </ResizableRightPanel>
  );
}
