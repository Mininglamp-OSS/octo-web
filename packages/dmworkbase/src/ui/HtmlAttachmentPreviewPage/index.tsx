import React from "react";
import { useI18n } from "../../i18n";
import type { HtmlAttachmentPreviewPageProps } from "./types";
import "./index.css";

export const HtmlAttachmentPreviewPage: React.FC<
  HtmlAttachmentPreviewPageProps
> = ({
  name,
  viewMode,
  onViewModeChange,
  download,
  error,
  onReturn,
  children,
}) => {
  const { t } = useI18n();
  return (
    <main className="wk-html-attachment-page">
      <header className="wk-html-attachment-page__header">
        <h1 title={name}>{name || t("base.htmlAttachment.title")}</h1>
        {download && (
          <div className="wk-html-attachment-page__actions">
            <button
              aria-pressed={viewMode === "preview"}
              onClick={() => onViewModeChange("preview")}
            >
              {t("base.filePreview.preview")}
            </button>
            <button
              aria-pressed={viewMode === "source"}
              onClick={() => onViewModeChange("source")}
            >
              {t("base.filePreview.source")}
            </button>
            <button disabled={download.pending} onClick={download.onClick}>
              {t(
                download.pending
                  ? "base.htmlAttachment.preparing"
                  : "base.filePreview.download"
              )}
            </button>
          </div>
        )}
        <button onClick={onReturn}>
          {t("base.htmlAttachment.returnToChat")}
        </button>
      </header>
      {error && (
        <p className="wk-html-attachment-page__error" role="alert">
          {error}
        </p>
      )}
      <section className="wk-html-attachment-page__content">{children}</section>
    </main>
  );
};
export default HtmlAttachmentPreviewPage;
