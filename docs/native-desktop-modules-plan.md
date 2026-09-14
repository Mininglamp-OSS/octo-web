# Remaining Desktop Modules

## Behavior List
- Preserve Contacts, Apps and Summary routes, permissions, API calls, drafts,
  scroll positions, menus and original action callbacks.
- Extend the opt-in desktop presentation to Apps and every Summary workspace
  route. Unknown capabilities keep a safe host titlebar.
- Applications retain separate list and conversation WebContentsViews. Both
  visible surfaces must support presentation before the host removes its bar.
- Ordinary browser and legacy Electron entries do not import desktop adapters
  or desktop CSS. Shared UI changes are declarative markers only.

## File Map
- `apps/web/src/client-feature/desktop/`: shared geometry, drag guard and
  presentation lifecycle, extracted from the communication entry.
- `apps/web/src/client-communication/`: compatibility entry and Contacts changes.
- `apps/web/src/client-apps/` and `client-summary/`: optional bridge capability,
  entry lifecycle and narrowly scoped module presentation CSS.
- `packages/dmworkappbot/src/workspace/` and Summary workspace pages:
  declarative header/layout markers without business changes.
- Focused adapter, lifecycle and workspace tests; paired Client Electron tests.

## PR Scope
- One Web PR for the remaining desktop presentation theme, paired with one
  Client MR. Separate commits by module after independent subagent review.
- Based on upstream main, preserving the reviewed Contacts adaptation.
- No business rewrite, new entry, API migration, dark-theme overhaul, native
  toolkit rewrite, OS minimum-size change or runtime dependency update.
- Optional `getDesktopPresentation` / `onDesktopPresentation` reuse v1 geometry.
  Ready reports advertise version 1 plus a complete `desktopPresentationPages`
  allowlist: `apps` for Apps; Summary uses its existing route view names.
  Missing or invalid feature capabilities must not enable fusion.

## Verification Plan
- Adapter/lifecycle and original Apps/Summary workspace tests, including absent
  host, timeout, reload, repeated ready, revocation and cleanup.
- Build ordinary Web and scan its output for desktop adapter/CSS leakage.
- Build separate mock/live artifacts with truthful source identity; Client
  pins must match clean committed source before final submission.
- Electron checks at 1440x900, 1120x760, 900x700 and 760x800; zh-CN/en-US,
  independent host/guest zoom, navigation, overlays and retained view identity.
- macOS and Windows geometry coverage plus separately recorded OS acceptance;
  simulated Windows geometry does not establish WCO/Snap/DPI correctness.
