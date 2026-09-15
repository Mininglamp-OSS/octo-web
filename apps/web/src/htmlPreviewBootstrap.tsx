import React from "react";
import { createRoot } from "react-dom/client";
import APIClient from "@octo/base/src/Service/APIClient";
import { I18nProvider, i18n } from "@octo/base/src/i18n";
import { readHtmlPreviewDescriptor } from "@octo/base/src/features/html-attachment/handoff";
import {
  configureHtmlAttachmentRuntime,
  currentAttachmentSession,
  storedAttachmentSession,
} from "@octo/base/src/features/html-attachment/runtime";
import { HtmlAttachmentPreview } from "@octo/base/src/features/html-attachment/HtmlAttachmentPreview";
import { resolveApiURL } from "./apiURL";

export function startHtmlPreview() {
  document.body.classList.add("wk-html-preview-host");
  const descriptor = readHtmlPreviewDescriptor();
  const apiURL = resolveApiURL({
    isDesktop: false,
    isDev: import.meta.env.DEV,
    rawApiURL: import.meta.env.VITE_API_URL,
  });
  configureHtmlAttachmentRuntime(() => {
    if (!descriptor) return null;
    const session = storedAttachmentSession(
      descriptor.ownerSessionId,
      descriptor.spaceId,
      apiURL
    );
    return session?.uid === descriptor.ownerUid ? session : null;
  });
  APIClient.shared.config.apiURL = apiURL;
  APIClient.shared.config.tokenCallback = () =>
    currentAttachmentSession()?.token;
  APIClient.shared.config.spaceIdCallback = () =>
    currentAttachmentSession()?.spaceId;
  i18n.init();
  try {
    const theme = sessionStorage.getItem("theme-mode");
    if (theme === "1" || theme === "dark")
      document.body.setAttribute("theme-mode", "dark");
  } catch {
    /* An unavailable store is rendered as an expired preview. */
  }
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider>
        <HtmlAttachmentPreview descriptor={descriptor} />
      </I18nProvider>
    </React.StrictMode>
  );
}
