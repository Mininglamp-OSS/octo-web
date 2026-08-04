export interface MessageAttentionState {
  chatModuleActive: boolean;
  documentVisible: boolean;
  windowFocused: boolean;
  currentConversation: boolean;
  newMessageVisible: boolean;
}

export interface MessageAttentionSessionContext {
  accountId: string;
  spaceId: string;
  loginToken?: string;
}

export interface ElementRectangle {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ConversationViewportScope {
  channelId: string;
  channelType: number;
  viewport?: HTMLElement | null;
}

export function shouldSuppressImmediateAlert(
  state: MessageAttentionState
): boolean {
  return (
    state.chatModuleActive &&
    state.documentVisible &&
    state.windowFocused &&
    state.currentConversation &&
    state.newMessageVisible
  );
}

export function shouldMarkConversationRead(
  state: MessageAttentionState
): boolean {
  return shouldSuppressImmediateAlert(state);
}

export function isSameMessageAttentionSession(
  arrival: MessageAttentionSessionContext,
  current: MessageAttentionSessionContext
): boolean {
  return (
    arrival.accountId === current.accountId &&
    arrival.spaceId === current.spaceId &&
    arrival.loginToken === current.loginToken
  );
}

export function isElementVisibleInViewport(
  rect: ElementRectangle,
  viewport: ViewportSize
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < viewport.height &&
    rect.left < viewport.width
  );
}

export function isRectangleVisibleWithin(
  rect: ElementRectangle,
  containerRect: ElementRectangle
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (containerRect.width <= 0 || containerRect.height <= 0) return false;
  return (
    rect.bottom > containerRect.top &&
    rect.right > containerRect.left &&
    rect.top < containerRect.bottom &&
    rect.left < containerRect.right
  );
}

export function isOwnedConversationSingleton<T>(
  current: T | undefined,
  owned: T | undefined
): boolean {
  return owned !== undefined && current === owned;
}

function isElementRendered(
  element: HTMLElement,
  targetDocument: Document
): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    const style = targetDocument.defaultView?.getComputedStyle(current);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse"
    ) {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

export function isConversationViewportVisible(
  viewport: HTMLElement | null | undefined,
  targetDocument: Document = document
): boolean {
  if (!viewport || viewport.ownerDocument !== targetDocument) return false;
  if (!targetDocument.documentElement.contains(viewport)) return false;
  if (!isElementRendered(viewport, targetDocument)) return false;
  return isElementVisibleInViewport(viewport.getBoundingClientRect(), {
    width: targetDocument.defaultView?.innerWidth || 0,
    height: targetDocument.defaultView?.innerHeight || 0,
  });
}

function viewportMatchesScope(
  viewport: HTMLElement,
  scope: ConversationViewportScope
): boolean {
  return (
    viewport.dataset.conversationChannelId === scope.channelId &&
    viewport.dataset.conversationChannelType === String(scope.channelType)
  );
}

function conversationViewports(
  targetDocument: Document,
  scope: ConversationViewportScope
): HTMLElement[] {
  if (scope.viewport) {
    return viewportMatchesScope(scope.viewport, scope) ? [scope.viewport] : [];
  }
  return Array.from(
    targetDocument.querySelectorAll<HTMLElement>(
      "[data-conversation-channel-id][data-conversation-channel-type]"
    )
  ).filter((viewport) => viewportMatchesScope(viewport, scope));
}

export function isConversationChannelVisible(
  scope: ConversationViewportScope,
  targetDocument: Document = document
): boolean {
  return conversationViewports(targetDocument, scope).some((viewport) =>
    isConversationViewportVisible(viewport, targetDocument)
  );
}

export function isMessageElementVisible(
  messageSeq: number,
  targetDocument: Document = document,
  scope?: ConversationViewportScope
): boolean {
  const viewports = scope
    ? conversationViewports(targetDocument, scope)
    : [undefined];
  for (const scopedViewport of viewports) {
    if (
      scopedViewport &&
      !isConversationViewportVisible(scopedViewport, targetDocument)
    ) {
      continue;
    }
    const queryRoot: Document | HTMLElement = scopedViewport || targetDocument;
    const elements = queryRoot.querySelectorAll<HTMLElement>(
      `[data-message-seq="${messageSeq}"]`
    );
    for (const element of elements) {
      if (!isElementRendered(element, targetDocument)) continue;
      const rect = element.getBoundingClientRect();
      const conversationViewport =
        element.closest<HTMLElement>('[id^="viewport-"]');
      if (scopedViewport && conversationViewport !== scopedViewport) continue;
      if (
        conversationViewport &&
        (!isConversationViewportVisible(conversationViewport, targetDocument) ||
          !isRectangleVisibleWithin(
            rect,
            conversationViewport.getBoundingClientRect()
          ))
      ) {
        continue;
      }
      if (
        isElementVisibleInViewport(rect, {
          width: targetDocument.defaultView?.innerWidth || 0,
          height: targetDocument.defaultView?.innerHeight || 0,
        })
      ) {
        return true;
      }
    }
  }
  return false;
}
