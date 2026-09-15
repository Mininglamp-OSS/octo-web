import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider, i18n } from "@octo/base/src/i18n";
import FilePreviewHeader from "@octo/base/src/Components/FilePreviewPanel/FilePreviewHeader";
import HtmlRenderer from "@octo/base/src/Components/FilePreviewPanel/renderers/HtmlRenderer";
import {
  configureHtmlAttachmentRuntime,
  currentAttachmentSession,
  storedAttachmentSession,
} from "@octo/base/src/features/html-attachment/runtime";
import APIClient from "@octo/base/src/Service/APIClient";
import { getSessionSid } from "@octo/base/src/Service/SessionScope";
import "@octo/base/src/theme/tokens.css";

const options = new URLSearchParams(location.search);
if (!options.has("restore")) {
  sessionStorage.setItem("octo.session.sid", "fixture");
  sessionStorage.setItem("uidfixture", "fixture-user");
  sessionStorage.setItem("tokenfixture", "fixture-token");
  localStorage.setItem("uidfixture", "fixture-user");
  localStorage.setItem("tokenfixture", "fixture-token");
}
configureHtmlAttachmentRuntime(() =>
  storedAttachmentSession(getSessionSid(), "space-a", "/api/v1/")
);
APIClient.shared.config.apiURL = "/api/v1/";
APIClient.shared.config.tokenCallback = () => currentAttachmentSession()?.token;
i18n.setLocale("en-US");
function Fixture() {
  const [second, setSecond] = useState(false);
  const file = {
    url: `${location.origin}/${
      options.has("proxy") ? "file" : "attachment-objects"
    }/chat/${second ? "second" : "uuid"}`,
    name: second ? "Second.html" : "季度报告 Q3.html",
    extension: "html",
    size: options.has("large") ? 21 * 1024 * 1024 : undefined,
  };
  return (
    <>
      <button onClick={() => setSecond(true)}>Select second attachment</button>
      <FilePreviewHeader
        file={file}
        onClose={() => undefined}
        showOpenExternal
      />
      <div style={{ height: 500 }}>
        <HtmlRenderer file={file} />
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <Fixture />
  </I18nProvider>
);
