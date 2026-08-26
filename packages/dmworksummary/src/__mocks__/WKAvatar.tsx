import React from 'react';

export default function WKAvatar() {
  return <span data-testid="wk-avatar" />;
}

// Mirror the real module's named export so consumers that call isBot()
// (e.g. ChatSelectorModal.loadMembers) resolve it in tests. Bot detection in
// the members path is driven by the `robot` field, so a constant false is
// sufficient here.
export function isBot(_uid?: string) {
  return false;
}
