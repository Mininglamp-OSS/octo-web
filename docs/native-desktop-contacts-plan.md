# Contacts Desktop Presentation

## Behavior List
- Keep the existing Contacts entry, search, filters, virtual list, profile and
  group-card actions. Do not add business routes or change API permissions.
- Give the embedded Contacts list a compact localized header with the same
  surface as the navigation list. Keep the browser entry unchanged.
- Reuse existing route headers for return navigation. Search, cards, dialogs
  and their close actions stay interactive when the window header is fused.
- Preserve selection, filter, scroll and drafts when switching between Contacts
  and Messages. Account and Space changes retain the existing lifecycle.
- Loading, empty and error states retain their existing actions and safe header.

## File Map
- `apps/web/src/client-communication/CommunicationShell.tsx`: embedded-only
  Contacts header and layout wrapper, reusing WKNavHeader.
- `apps/web/src/client-communication/desktop-contacts.css`: opt-in Contacts
  presentation, header/content sizing and list surface.
- `apps/web/src/client-communication/{hostBridge,desktopPresentationLifecycle}.ts`:
  additive supported-page capability for the existing geometry protocol.
- `apps/web/src/client-communication/*test*`: capability lifecycle, absent-host
  fallback and embedded header coverage.
- Client communication contracts, ready parser, view manager and slot:
  accept a validated supported-page list, clear it with renderer identity, and
  fuse Contacts only when explicitly supported. Legacy v1 means chat only.
- Client Contacts Electron E2E: real embedded renderer, native and simulated
  Windows geometry, navigation, overlays, search and state preservation.

## PR Scope
- Build on the reviewed desktop-shell changes in separate worktrees.
- Only adapt Contacts and its host negotiation. Applications, Summary and
  remaining Client pages are separate follow-ups.
- Do not modify runtime versions, authentication, API contracts, shared browser
  entry points or publish artifacts. Do not remove fallback titlebars globally.
- This is not a new business UI component: reuse WKNavHeader and the existing
  Contacts UI. No new Service, bridge, route or duplicated user entry is needed.
- Both repositories require independent subagent review before any new commit.

## Verification Plan
- Run the communication Vitest suite and Client typecheck, focused IPC/unit
  tests and desktop-window component tests.
- Build a new communication fixture with explicit dirty/mock identity during
  development. Never relabel it as a clean release artifact.
- Exercise Contacts at 1440x900, 1120x760, 900x700 and 760x800 in Electron.
  Verify search/clear, filters, profile/group-card close, return routes, opening
  Messages, view identity, scrolling and drafts; include page zoom.
- Check macOS and Windows safe-area geometry, default-off and old-capability
  fallback. Inspect screenshots, not only DOM geometry.
- Build the ordinary browser entry and check desktop code remains excluded.
- Windows geometry tests do not replace native WCO/Snap/DPI acceptance.
  OS fullscreen and signed installers remain separate release gates.

## Implementation Evidence
- All presentation edits stay in the standalone communication entry. No shared
  Contacts business components or ordinary browser styles changed.
- Communication tests: 12 files, 89 cases passed. Ordinary browser build,
  standalone mock build and i18n validation passed. Browser output contains none
  of the Contacts desktop selectors or geometry adapter tokens.
- Independent Web review found no blocking issue; its state-preservation test
  suggestion was added and passed.
- Electron Contacts checks passed for native macOS and simulated Windows
  host/guest geometry at all four sizes, plus English and independent host/guest
  zoom. Search, clear, filters, no-results, three profile close actions, group
  navigation and drafts were exercised with local fixtures.
- A 182-member fixture verifies virtual scrolling and filter/scroll retention.
  Legacy v1 capability and default-off behavior retain the fallback layout.
- Screenshots are renderer captures. They do not establish OS traffic-light
  sizing, native Windows hit testing, Snap behavior or signed-release readiness.
