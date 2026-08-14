# Overlay Lifecycle Review Guide

This guide applies to custom pickers, popovers, flyouts, context menus, and
other portaled overlays. It records the lessons from the emoji picker dismissal
incident fixed on August 14, 2026.

## Incident Summary

The toolbar emoji picker appeared to flash before disappearing when the user
clicked the editor or the empty composer row. Selecting an emoji did not flash.

The first investigations changed the Tiptap emoji prefix suggestion popup. That
was a different UI surface with a similar description, so its tests could pass
without affecting the reported behavior.

The actual event path was:

1. `EmojiToolbar` rendered a transparent full-screen mask above the composer.
2. A click aimed at the editor or composer row hit that mask.
3. The mask called the generic close path.
4. The generic close path kept the picker visible for a 250 ms exit animation.
5. Emoji selection used a separate immediate-close path.

The existing unit test explicitly expected the outside-click animation, so it
preserved the defect instead of detecting it.

The correction is recorded in:

- `0597b453 fix(emoji): close picker without exit flash`
- `20b5e6e6 revert: remove unrelated emoji suggestion fixes`

## Diagnostic Rules

### Identify the exact surface

Before changing code, record all three identifiers:

- the user-visible entry point, such as the toolbar smile button;
- the rendered overlay selector, such as `.wk-emojitoolbar-emojipanel`;
- the owning component, such as `Components/EmojiToolbar`.

Do not substitute a component merely because it has a similar name, visual
shape, or symptom.

### Trace the browser event target

For portaled overlays and transparent masks, the element visually underneath a
pointer is often not the element receiving the event. Verify the real target
with `document.elementFromPoint()` or browser event logging.

A test that directly calls `editor.click()` in jsdom does not prove that a real
browser click reaches the editor when a mask is mounted above it.

### Compare every close path

List the state transition for each dismissal source:

| Path | Typical source |
| --- | --- |
| Selection or confirmation | item click, submit button |
| Outside pointer | mask, click-away listener |
| Keyboard | Escape, Tab |
| Focus change | blur, editor focus restoration |
| Owner lifecycle | navigation, unmount, feature disable |
| Reopen or replacement | another picker opens |

Equivalent user outcomes should normally converge on one close operation. Any
different delay, animation, focus restoration, cleanup, or callback ordering
must be intentional and independently tested.

### Treat animation as lifecycle state

An exit animation keeps the old overlay mounted and potentially visible,
focusable, measurable, and event-active. Review it as an additional state, not
as harmless styling.

In particular, do not keep an overlay visibly exiting while the same action
focuses an editor, navigates, inserts content, opens a replacement overlay, or
changes its anchor.

## Required Test Matrix

For each custom overlay, cover the applicable rows against the real owning
component:

| Scenario | Required assertion |
| --- | --- |
| Open | Correct portal, position, focus, and visible state |
| Select | Business callback fires once and overlay closes once |
| Outside click | Real hit target is verified; overlay reaches its intended state immediately |
| Click underlying control | Mask interception or click-through behavior is explicit |
| Escape | Listener is removed and focus restoration is correct |
| Reopen | No stale animation, listener, anchor, or previous content survives |
| Navigation/unmount | Portal and global listeners are removed |
| Async update | Stale completion cannot revive or reposition a closed overlay |

When the defect is visual, observe the real DOM lifecycle. Useful probes
include:

- `MutationObserver` for class, style, visibility, and node replacement;
- `requestAnimationFrame` sampling for painted position and visibility;
- `elementFromPoint()` for masks and overlapping portals.

Unit tests should lock component state and callbacks. Browser tests should lock
the actual pointer path and painted lifecycle. Neither replaces the other.

## Review Checklist

- [ ] The reported UI surface is named by entry point, selector, and owner.
- [ ] The real browser event target is known.
- [ ] All dismissal paths converge or their differences are justified.
- [ ] Exit animation does not overlap a conflicting business transition.
- [ ] Masks and global listeners have symmetric setup and cleanup.
- [ ] Focus restoration happens once and targets a live element.
- [ ] Reopen cannot inherit stale closing state.
- [ ] Tests do not encode the reported defect as expected behavior.
- [ ] Browser coverage exercises the real entry point, not a similar component.
- [ ] Adjacent subsystems are not changed without an independent reproduction.

## Review Output

An overlay lifecycle review should report:

1. the exact trigger and rendered owner;
2. a close-path table showing state, animation, focus, and cleanup;
3. findings with a concrete browser interaction;
4. missing unit and browser coverage;
5. the inspected components that had no findings.

