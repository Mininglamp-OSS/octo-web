import "@octo/base/src/theme/tokens.css";
import "./index.css";
import { isBrowserHtmlAttachment } from "@octo/base/src/features/html-attachment/types";

// Choose before evaluating business modules: a preview must not connect IM or
// mount the chat shell. The ordinary bootstrap retains its initialization order.
if (
  window.location.pathname === "/file-preview" &&
  isBrowserHtmlAttachment({ name: "file.html", extension: "html" })
) {
  void import("./htmlPreviewBootstrap").then((module) =>
    module.startHtmlPreview()
  );
} else {
  void import("./chatBootstrap");
}
