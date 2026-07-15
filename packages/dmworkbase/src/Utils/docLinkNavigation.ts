import WKApp from "../App";
import { parseDocLink } from "./docLink";

/**
 * If `href` is a same-origin in-app document share link (`/d/<docId>?sp=<spaceId>`) AND an in-chat
 * doc sidebar host is currently mounted, open the document inline in the sidebar and return true.
 * Otherwise return false so the caller falls back to its default behavior (follow the anchor / open
 * the standalone page in a new tab).
 *
 * WS-17: clicking a forwarded document link inside a conversation should open the live document in a
 * right-side sidebar — so the user can read the rendered doc while continuing to chat with the agent
 * to edit it — instead of navigating away to a new page. The sidebar only exists on the chat page, so
 * `WKApp.openDocPreview` is set by ChatContentPage while it is mounted and cleared on unmount; gating
 * on its presence means a `/d/` link clicked anywhere else (or before the chat page mounts) is left
 * untouched and opens the full standalone page as before, matching "只在聊天里内联，其他情况开新页面".
 */
export function tryOpenDocLinkInSidebar(href: string | undefined): boolean {
  const open = WKApp.openDocPreview;
  if (!open) return false;
  const parsed = parseDocLink(href);
  if (!parsed) return false;
  // Only intercept when the docs pane can actually render (docs module registered). A host that
  // mounts the chat but not the docs module (e.g. the extension side panel) would otherwise swallow
  // the link into an empty, uncloseable panel; fall through so it opens the standalone page instead.
  if (!WKApp.endpoints?.hasChatDocPreviewPane?.()) return false;
  open(parsed.docId, parsed.space);
  return true;
}
