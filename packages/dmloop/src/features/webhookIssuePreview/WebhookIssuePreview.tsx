import React from "react";
import { Button, Spin, Typography } from "@douyinfe/semi-ui";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useI18n } from "@octo/base";
import {
  useIssuePreview,
  type IssuePreviewTarget,
} from "../../bridge/useIssuePreview";
import IssueDetailPage from "../../panel/IssueDetailPage";
import "./index.css";

const { Text } = Typography;

export default function WebhookIssuePreview({
  target,
}: {
  target: IssuePreviewTarget;
}) {
  const { t } = useI18n();
  const preview = useIssuePreview(target);

  if (preview.loading) {
    return (
      <div className="loop-webhook-issue-preview__state" aria-busy="true">
        <Spin />
        <Text type="tertiary">{t("loop.preview.loading")}</Text>
      </div>
    );
  }

  if (preview.error || !preview.data) {
    return (
      <div className="loop-webhook-issue-preview__state" role="alert">
        <Text type="tertiary">{t("loop.preview.loadError")}</Text>
        <div className="loop-webhook-issue-preview__actions">
          <Button
            theme="borderless"
            icon={<RefreshCw size={15} />}
            onClick={preview.retry}
          >
            {t("loop.preview.retry")}
          </Button>
          <Button
            theme="borderless"
            icon={<ExternalLink size={15} />}
            onClick={() =>
              window.open(target.sourceUrl, "_blank", "noopener,noreferrer")
            }
          >
            {t("loop.preview.openSource")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <IssueDetailPage
      issueId={preview.data.issue.id}
      snapshot={preview.data}
      presentation="panel"
      sourceUrl={target.sourceUrl}
    />
  );
}
