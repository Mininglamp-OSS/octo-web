import WKApp from "../../App";

// GlobalSearch's message/file tabs run against the same OpenSearch backend
// as ChannelSearch. Reuse the same remote-config flag so both are enabled
// atomically. If disabled, the outer GlobalSearch falls back to the legacy
// `/v1/search/global` messages listing (see index.tsx).
export function isGlobalContentSearchEnabled(): boolean {
  return !!WKApp.remoteConfig.messagesSearchOn;
}
