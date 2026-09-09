import { WKApp } from "@octo/base";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

/** Install only in the artifact; Web continues using its legacy menu adapter. */
export function installSummaryNavigation(
  bridge: Pick<OctoBuddyCommunicationBridge, "openSummary">,
  onError: (error: unknown) => void
): () => void {
  const previous = {
    detail: WKApp.openSummaryDetail,
    preview: WKApp.openSummarySharePreview,
    share: WKApp.openSummaryShareDetail,
  };
  const open = (request: Parameters<typeof bridge.openSummary>[0]) => {
    void Promise.resolve().then(() => bridge.openSummary(request)).catch(onError);
  };
  const detail: NonNullable<typeof WKApp.openSummaryDetail> =
    (taskId, spaceId, originConversation) => open({
      route: { view: "detail", taskId, originConversation },
      spaceId: spaceId || WKApp.shared.currentSpaceId,
    });
  const preview: NonNullable<typeof WKApp.openSummarySharePreview> =
    (shareId, spaceId, originConversation) => open({
      route: { view: "share", shareId, preview: true, originConversation },
      spaceId: spaceId || WKApp.shared.currentSpaceId,
    });
  const share: NonNullable<typeof WKApp.openSummaryShareDetail> =
    (shareId, spaceId, originConversation) => open({
      route: { view: "share", shareId, originConversation },
      spaceId: spaceId || WKApp.shared.currentSpaceId,
    });
  WKApp.openSummaryDetail = detail;
  WKApp.openSummarySharePreview = preview;
  WKApp.openSummaryShareDetail = share;
  return () => {
    if (WKApp.openSummaryDetail === detail) WKApp.openSummaryDetail = previous.detail;
    if (WKApp.openSummarySharePreview === preview) WKApp.openSummarySharePreview = previous.preview;
    if (WKApp.openSummaryShareDetail === share) WKApp.openSummaryShareDetail = previous.share;
  };
}
