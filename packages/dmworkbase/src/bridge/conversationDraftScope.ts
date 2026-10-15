import WKApp from "../App";
import type { DraftScope } from "../features/chat-composer/local-drafts/model";

export function currentConversationDraftScope(): DraftScope {
  return {
    server: WKApp.apiClient?.config?.apiURL ?? "",
    account: WKApp.loginInfo?.uid ?? "",
    space: WKApp.shared?.currentSpaceId ?? "",
  };
}
