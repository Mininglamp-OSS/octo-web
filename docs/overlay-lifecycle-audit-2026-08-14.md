# Overlay Lifecycle Audit - 2026-08-14

This audit follows the emoji picker incident documented in
`overlay-lifecycle-review-guide.md`. It reviews custom overlays for divergent
close paths, stale asynchronous reopen work, mask behavior, nested Escape
handling, focus restoration, and missing real-entry coverage.

## Confirmed Findings

### P1 - Context menu can reopen after it was closed

Owner: `packages/dmworkbase/src/Components/ContextMenus/index.tsx`

`show()` measures and opens the menu in `requestAnimationFrame()`. `hide()` does
not cancel or invalidate that pending callback, and `hideAll()` only visits
instances whose committed state is already open.

Reproduction path:

1. Right-click a message or conversation.
2. Before the next animation frame, trigger a close, scroll dismissal, or open a
   different context menu.
3. The stale callback commits `showContextMenus: true` and revives the old menu.

The current unit test replaces RAF with a synchronous function, so it cannot
exercise this ordering.

Required correction:

- cancel pending RAF in `hide()` and before scheduling another `show()`;
- add a generation token so stale callbacks cannot commit;
- make `hideAll()` invalidate pending opens as well as committed opens;
- test `show -> hide -> flush RAF` and `show A -> show B -> flush RAF`.

### P1 - Voice and Secrets modals leave the Settings flyout open

Owners:

- `packages/dmworkbase/src/Components/NavRail/NavVoiceSettingsItem.tsx`
- `packages/dmworkbase/src/Components/NavRail/NavSecretsSettingsItem.tsx`
- `packages/dmworkbase/src/Components/NavRail/NavSettingsPanel.tsx`

The Voice and Secrets items open their own panels without calling the parent
flyout close callback. The modal mask hides the flyout temporarily, but closing
the modal reveals the old Settings flyout again.

Required correction:

- pass an explicit parent-close callback to both menu items;
- close the flyout before opening a modal from a menu selection;
- keep the event-driven Secrets deep link able to open the modal directly;
- replace the mocked-child gap in `NavSettingsPanelFlyout.test.tsx` with an
  integration case that closes the modal and verifies the flyout stays closed.

### P2 - One Escape closes both nested Channel Search overlays

Owners:

- `packages/dmworkbase/src/features/channelSearch/useOutsideDismiss.ts`
- `packages/dmworkbase/src/features/channelSearch/ChannelSearchPanel.tsx`
- `packages/dmworkbase/src/features/channelSearch/ChannelSearchFilters.tsx`

The outer filter popover and the nested sender/sort menus each register a
document Escape listener. They do not coordinate a topmost overlay, so one key
press closes both levels and discards the un-applied filter draft.

Required correction:

- coordinate nested overlays through a stack or explicit child-open state;
- the first Escape must close only the nested menu;
- the second Escape may close the filter popover;
- add tests for sender and sort nesting.

### P2 - Context menu has no Escape lifecycle

Owner: `packages/dmworkbase/src/Components/ContextMenus/index.tsx`

The custom context menu closes through its mask and pointer paths only. Escape
does not dismiss it, so the menu and the global native-context-menu guard remain
active.

Required correction:

- register Escape only while the topmost context menu is open;
- remove the listener in hide and unmount paths;
- test menu visibility and document guard cleanup after Escape.

## Browser Verification Required

### NavFlyout focus restoration when opening a successor modal

`NavFlyout` restores focus to its trigger whenever `open` changes to false.
Menu actions such as Changelog close the flyout and open a modal in the same
interaction. Depending on the final effect ordering in the real Semi modal,
the flyout may move focus back behind the modal.

This is not recorded as a confirmed defect until a browser test checks the
active element after the successor modal opens. The likely correction is a
close reason or `restoreFocus` option: mask and Escape closes restore focus;
navigation and successor-modal selections do not.

## Checked Without Additional Findings

- `MessageReactionPicker/ReactionPickerOverlay`: mask, right-click, Escape,
  focus restoration, and container cleanup use one close operation.
- `EmojiToolbar` and sticker preview portal: immediate picker close and preview
  timer/listener cleanup are consistent.
- `VoiceInputButton` and composer `VoiceInputIndicator`: controlled dropdown
  selection closes before recording begins.
- Chat header Add popover: no confirmed frame-level residue.
- `NavLanguageSwitcher`, `NavSpaceSwitcher`, `SlashCommandMenu`, and file
  preview hover dropdowns: no confirmed divergent close lifecycle.
- `PopupMenus`: no current production references were found.

## Recommended Order

1. Fix ContextMenus pending RAF and Escape in one lifecycle-focused change.
2. Close the Settings flyout before Voice/Secrets successor modals open, with
   focus assertions.
3. Introduce nested Escape ownership for Channel Search.
4. Add browser-level focus verification for successor-modal transitions.

