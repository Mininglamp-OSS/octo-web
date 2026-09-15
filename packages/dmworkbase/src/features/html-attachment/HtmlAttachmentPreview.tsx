import React, { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import HtmlAttachmentPreviewPage from "../../ui/HtmlAttachmentPreviewPage";
import HtmlRenderer from "../../Components/FilePreviewPanel/renderers/HtmlRenderer";
import { descriptorKey, type HtmlPreviewDescriptor } from "./handoff";
import {
  currentAttachmentSession,
  subscribeAttachmentSession,
} from "./runtime";
import { useHtmlAttachmentActions } from "../../bridge/html-attachment/useHtmlAttachmentActions";

export function HtmlAttachmentPreview({
  descriptor,
}: {
  descriptor: HtmlPreviewDescriptor | null;
}) {
  const { t } = useI18n();
  const [expired, setExpired] = useState(
    !descriptor || !currentAttachmentSession()
  );
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const file = !expired && descriptor ? descriptor.file : null;
  const actions = useHtmlAttachmentActions(file);
  useEffect(() => {
    document.title = file?.name || t("base.htmlAttachment.title");
  }, [file?.name]);
  useEffect(() => {
    const check = () => {
      if (!currentAttachmentSession()) {
        setExpired(true);
        if (descriptor) sessionStorage.removeItem(descriptorKey(descriptor.id));
      }
    };
    const unsubscribe = subscribeAttachmentSession(check);
    check();
    return unsubscribe;
  }, [descriptor]);
  return (
    <HtmlAttachmentPreviewPage
      name={file?.name || ""}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      download={
        file
          ? { pending: actions.pending, onClick: () => void actions.download() }
          : undefined
      }
      error={expired ? t("base.htmlAttachment.expired") : actions.error}
      onReturn={() => window.location.assign("/")}
    >
      {file && (
        <HtmlRenderer
          file={file}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      )}
    </HtmlAttachmentPreviewPage>
  );
}
