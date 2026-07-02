// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { captureSelectionWithinContainer } from "../copySelection";

/**
 * Regression tests for the right-click "copy" selection capture (Issue #513).
 *
 * These tests exercise the REAL capture function used in production
 * (`captureSelectionWithinContainer`, called from Conversation.showContextMenus
 * with `event.currentTarget`) — not a local re-implementation. They build the
 * three real message-container DOM shapes and assert that a partial selection
 * inside the right-clicked container is captured, while anything outside it
 * falls back (returns null → copy handler uses the full message text).
 *
 * The historical bug: the capture logic matched a hard-coded CSS class
 * whitelist, so folded-summary and fold-expanded-row containers — never added
 * to the list — always fell back to copying the whole message. The last test
 * below encodes the anti-drift intent: a brand-new container class that no
 * whitelist could know about must still work, purely by ownership.
 */

// Build a faithful Selection over a real Range so the production function runs
// against real DOM `contains` / `commonAncestorContainer` semantics.
function selectionOver(range: Range | null): Selection {
  return {
    rangeCount: range ? 1 : 0,
    getRangeAt: () => {
      if (!range) throw new Error("no range");
      return range;
    },
    toString: () => (range ? range.toString() : ""),
  } as unknown as Selection;
}

function rangeWithin(node: Node, start: number, end: number): Range {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

describe("captureSelectionWithinContainer — real capture path", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("captures a partial selection inside a normal message row (.wk-msg-row)", () => {
    // Container the contextmenu handler is bound to is the whole row; the text
    // lives in .wk-msg-row-body inside it.
    const row = el("div", "wk-msg-row");
    const body = el("div", "wk-msg-row-body");
    const text = document.createTextNode("Hello, this is a message");
    body.appendChild(text);
    row.appendChild(body);
    document.body.appendChild(row);

    const sel = selectionOver(rangeWithin(text, 7, 11)); // "this"
    expect(captureSelectionWithinContainer(sel, row)).toBe("this");
  });

  it("captures a partial selection inside a folded summary (.wk-fold-session-card-summary)", () => {
    const summary = el("div", "wk-fold-session-card-summary");
    const inner = el("div", "wk-fold-msg-text");
    const text = document.createTextNode("Folded digest text here");
    inner.appendChild(text);
    summary.appendChild(inner);
    document.body.appendChild(summary);

    const sel = selectionOver(rangeWithin(text, 0, 6)); // "Folded"
    expect(captureSelectionWithinContainer(sel, summary)).toBe("Folded");
  });

  it("captures a partial selection inside an expanded row of a fold card (.wk-fold-msg)", () => {
    // The onContextMenu is bound to the outer .wk-fold-msg; text is in
    // .wk-fold-msg-body -> .wk-fold-msg-text below it.
    const foldMsg = el("div", "wk-fold-msg");
    const foldBody = el("div", "wk-fold-msg-body");
    const foldText = el("div", "wk-fold-msg-text");
    const text = document.createTextNode("Expanded row content");
    foldText.appendChild(text);
    foldBody.appendChild(foldText);
    foldMsg.appendChild(foldBody);
    document.body.appendChild(foldMsg);

    const sel = selectionOver(rangeWithin(text, 0, 8)); // "Expanded"
    expect(captureSelectionWithinContainer(sel, foldMsg)).toBe("Expanded");
  });

  it("falls back (null) when the selection is in a different message container", () => {
    const rowA = el("div", "wk-msg-row");
    const bodyA = el("div", "wk-msg-row-body");
    bodyA.appendChild(document.createTextNode("Message A"));
    rowA.appendChild(bodyA);

    const rowB = el("div", "wk-msg-row");
    const bodyB = el("div", "wk-msg-row-body");
    const textB = document.createTextNode("Message B");
    bodyB.appendChild(textB);
    rowB.appendChild(bodyB);

    document.body.appendChild(rowA);
    document.body.appendChild(rowB);

    // Selection lives in row B, but row A was right-clicked → must not capture.
    const sel = selectionOver(rangeWithin(textB, 0, 7));
    expect(captureSelectionWithinContainer(sel, rowA)).toBeNull();
  });

  it("falls back (null) when the selection spans across the container boundary", () => {
    const row = el("div", "wk-msg-row");
    const body = el("div", "wk-msg-row-body");
    const inside = document.createTextNode("inside text");
    body.appendChild(inside);
    row.appendChild(body);

    const outside = el("div", "some-sibling");
    const outsideText = document.createTextNode("outside text");
    outside.appendChild(outsideText);

    document.body.appendChild(row);
    document.body.appendChild(outside);

    // A range spanning both nodes has commonAncestorContainer == body element,
    // which is not inside the row.
    const range = document.createRange();
    range.setStart(inside, 0);
    range.setEnd(outsideText, 7);
    expect(captureSelectionWithinContainer(selectionOver(range), row)).toBeNull();
  });

  it("returns null for an empty / collapsed selection (unselected right-click copies full message)", () => {
    const row = el("div", "wk-msg-row");
    const body = el("div", "wk-msg-row-body");
    const text = document.createTextNode("Hello");
    body.appendChild(text);
    row.appendChild(body);
    document.body.appendChild(row);

    expect(captureSelectionWithinContainer(selectionOver(null), row)).toBeNull();
    expect(captureSelectionWithinContainer(null, row)).toBeNull();
    // collapsed range → empty string → null
    expect(
      captureSelectionWithinContainer(selectionOver(rangeWithin(text, 2, 2)), row)
    ).toBeNull();
  });

  it("anti-drift: a brand-new container class (no whitelist entry) still works by ownership", () => {
    // This is the whole point of Direction ②. A future message container that
    // no CSS-class whitelist knows about must capture selections correctly with
    // zero code changes, purely because ownership is decided by `contains`.
    const future = el("div", "wk-some-future-container-that-never-existed");
    const inner = el("span", "totally-new-inner");
    const text = document.createTextNode("future container selection");
    inner.appendChild(text);
    future.appendChild(inner);
    document.body.appendChild(future);

    const sel = selectionOver(rangeWithin(text, 0, 6)); // "future"
    expect(captureSelectionWithinContainer(sel, future)).toBe("future");
  });
});

// ── tiny DOM helpers ──────────────────────────────────────────────────────
function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
