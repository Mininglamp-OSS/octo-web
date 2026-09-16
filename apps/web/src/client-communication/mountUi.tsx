import React from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider, WKApp } from "@octo/base";
import { CommunicationShell } from "./CommunicationShell";
import { installDesktopPresentationLifecycle } from "./desktopPresentationLifecycle";
import { installHostDocumentPreview } from "./documentPreview";
import { installHostFilePreview } from "./filePreview";
import type { CommunicationBootstrap, DocumentForwardRequest, OctoBuddyCommunicationBridge } from "./hostBridge";

export async function mountCommunicationUi(
  host: OctoBuddyCommunicationBridge,
  bootstrap: CommunicationBootstrap,
  options: {
    runtimeOwned?: boolean; onReady?(): void; isActive?(): boolean;
    isDocumentForwardCurrent?(request: DocumentForwardRequest): boolean;
  } = {},
): Promise<() => void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Communication root unavailable");
  const presentation = installDesktopPresentationLifecycle(window, host, root, () => ({
    page: WKApp.currentMenuId === "contacts" ? "contacts" : "chat",
    spaceId: WKApp.shared.currentSpaceId,
  }));
  await presentation.available;
  if (options.isActive && !options.isActive()) {
    presentation.dispose();
    return () => {};
  }
  const disposeDocumentPreview = options.runtimeOwned
    ? () => {}
    : installHostDocumentPreview(host, WKApp.shared.currentSpaceId);
  const disposeFilePreview = installHostFilePreview(host, WKApp.shared.currentSpaceId);
  const reactRoot = createRoot(root);
  reactRoot.render(
    <React.StrictMode>
      <I18nProvider>
        <CommunicationShell
          bridge={host}
          initialPage={bootstrap.initialPage}
          initialSpaceId={WKApp.shared.currentSpaceId}
          initialPresentation={bootstrap.initialPresentation}
          runtimeOwned={options.runtimeOwned}
          isDocumentForwardCurrent={options.isDocumentForwardCurrent}
          onReady={async ({ page, spaceId }) => {
            const navigationCommit = typeof host.reportNavigationCommitted === "function"
              ? { navigationCommitVersion: 1 as const } : undefined;
            await presentation.reportReady({
              bridgeVersion: 1, page, spaceId,
              ...navigationCommit,
              rendererVersion: WKApp.config.appVersion, documentForwardVersion: 1,
            });
            options.onReady?.();
          }}
        />
      </I18nProvider>
    </React.StrictMode>,
  );
  return () => {
    reactRoot.unmount();
    disposeFilePreview();
    disposeDocumentPreview();
    presentation.dispose();
  };
}
