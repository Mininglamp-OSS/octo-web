/**
 * Right-click "copy" selection capture (Issue #513 / #814).
 *
 * When a message is right-clicked we want the copy action to honour a partial
 * text selection when — and only when — that selection lives inside the very
 * message container that was right-clicked. Otherwise the copy handler falls
 * back to the full message text.
 *
 * The earlier implementation decided ownership by matching a hard-coded CSS
 * class whitelist (`.wk-message-base-bubble` / `.wk-msg-row-body`). Every new
 * kind of message container (folded summaries, expanded rows inside a fold
 * card, ...) had to be remembered and appended to that list, and whenever one
 * was missed its selections were silently dropped and the whole message was
 * copied instead. That is exactly the drift that broke folded messages.
 *
 * This helper replaces the whitelist with a container-ownership check: the
 * caller passes the container node that actually received the contextmenu
 * event (`event.currentTarget`) and we simply verify the selection is anchored
 * inside it. No class enumeration, so any present or future container works
 * without a code change.
 */
export function captureSelectionWithinContainer(
  selection: Selection | null,
  container: HTMLElement | null
): string | null {
  if (!container || !selection || selection.rangeCount === 0) {
    return null;
  }

  const text = selection.toString();
  if (text.length === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  return container.contains(range.commonAncestorContainer) ? text : null;
}
