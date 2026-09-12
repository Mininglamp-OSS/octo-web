# Embedded Desktop Presentation

## Scope

The dedicated Client communication renderer can opt into a shared top band with
the desktop host. Existing React headers keep their components, callbacks, routing,
and business state. The host owns the macOS traffic lights or Windows window
controls; this adapter does not redraw them or implement an AppKit/WinUI toolbar.

The messaging surface remains a separate WebContentsView. Its DOM and portals stay
in that document, not in the host's React tree.

The ordinary browser and legacy standalone Electron entries do not import the
adapter or its stylesheet. Shared components only declare inert presentation
markers. This work does not add user-visible entry points or complete the native
adaptation of the Apps, Contacts, or standalone Summary tabs.

## Opt-In Contract

The trusted communication bridge may provide both `getDesktopPresentation` and
`onDesktopPresentation`. A valid initial state enables the adapter. Missing
capabilities, invalid state, rejection, or a one-second negotiation timeout leave
the existing messaging presentation available. Startup waits for this bounded
negotiation, so an unresponsive optional provider may delay the first render by
up to one second.

`DesktopPresentation` version 1 contains:

| Field | Meaning |
| --- | --- |
| `revision` | Nonnegative monotonic revision; older updates are ignored |
| `platform` | `darwin` or `win32` |
| `canFuse` | Whether the host can safely share its top band |
| `headerHeight`, `fallbackHeight` | Host-provided heights in renderer CSS pixels |
| `topArea` | Available top-band rectangle, or `null` |
| `controls` | Window-control exclusion rectangles, at most four |
| `focused`, `maximized`, `fullScreen` | Host window state |
| `appearance` | Optional validated colors: background, foreground, separator, sidebar background |

The host converts window DIP coordinates, WebContentsView offsets, and page zoom
into the receiving renderer's CSS coordinates. Version 1 accepts finite,
nonnegative rectangle coordinates and sizes. The host must supply geometry in
that domain; no renderer should guess Windows controls from a user agent or
assume it inherits the host document's CSS titlebar environment variables.

Each registered header reserves only the controls that intersect its own
rectangle. Both left and right exclusions are supported. Hidden, inert, inactive,
or offscreen headers do not acquire a top-band marker. Optional invalid colors
fall back to the existing theme; malformed appearance does not disable geometry.

## Markers and Interaction

| Marker | Responsibility |
| --- | --- |
| `data-desktop-chrome="header"` | Registers an existing business header |
| `data-desktop-chrome="layout"` | Explicitly allows an otherwise empty layout region to drag |
| `data-desktop-overlay` | Declares a custom drawer or overlay root |
| `data-desktop-header` | Adapter-owned marker for a header currently intersecting the top band |
| `data-desktop-drag-suspended` | Guard-owned state for pausing document header dragging |

Business descendants remain interactive by default. Dragging is enabled only for
declared header/layout backgrounds, and disabled in fullscreen.

One drag guard observes the embedded document, including body portals. It
recognizes declared overlays, semantic dialogs, menus, listboxes, tooltips, native
dialogs, and popovers. Hidden or fully offscreen surfaces are excluded; a
zero-sized portal wrapper can still contain visible children.

The deliberate tradeoff is conservative: while any recognized overlay is
visible, **all embedded header dragging is paused**, including for nonmodal
sidebars and tooltips. Buttons keep their existing handlers. The guard restores
dragging when the last overlay closes. It does not maintain a selector blacklist
of individual close buttons or move business actions into the host.

## Motion and Lifecycle

Overlay changes are processed by mutation, resize, toggle, and motion events.
The drag guard does not run an animation-frame polling loop. A finite outgoing
motion holds the guard until it completes or is cancelled; intermediate geometry
cannot make the guard less restrictive.

Header geometry still follows finite running motion because ResizeObserver does
not report translations. The adapter matches the browser's CSS animation or
transition object by name/property and pseudo-element. Infinite animations,
paused/finished animations, and zero playback rates do not keep geometry polling
alive. Infinite loading indicators therefore do not trigger continuous scans.
Untracked end/cancel events do not schedule a scan. DOM/style mutations can still
cause event-driven scans; this is not a claim of zero work in a changing document.

`pagehide` disposes the adapter. A persisted `pageshow` serializes a fresh
negotiation and updates the host's capability report using the live page and space
context. A failed restoration can be retried by a later persisted `pageshow`;
there is no autonomous polling retry. Cancelling an unload does not tear down the
active adapter. Teardown releases observers, listeners, frames, and local styles
even if host unsubscription throws.

## File Map

| Location | Responsibility |
| --- | --- |
| `apps/web/src/client-communication/hostBridge.ts` | Optional bridge methods and readiness capability |
| `apps/web/src/client-communication/index.tsx` | Dedicated entry and bounded negotiation |
| `apps/web/src/client-communication/desktopPresentation.ts` | Validation, appearance, header geometry, cleanup |
| `apps/web/src/client-communication/desktopMotion.ts` | CSS motion identity and finite running lifetime |
| `apps/web/src/client-communication/desktopDragGuard.ts` | Document-wide overlay/drag policy |
| `apps/web/src/client-communication/desktopPresentationLifecycle.ts` | Navigation restoration and readiness |
| `apps/web/src/client-communication/desktop-presentation.css` | Opt-in platform styles and hit regions |
| Shared headers and overlay roots | Declarative markers only; existing business ownership is unchanged |

## Verification

Run from the repository root. The communication renderer build requires
`VITE_API_URL` to be configured and a clean worktree. Dirty artifacts are only
permitted by the existing explicit local-test override, never as release inputs.

```sh
pnpm install --frozen-lockfile
pnpm --filter @octo/web exec vitest run src/client-communication
pnpm --filter @octo/web test:e2e:desktop
pnpm --filter @octo/web build:e2e
pnpm --filter @octo/web exec playwright test --config=e2e-kit/playwright.ci.config.ts
pnpm --filter @octo/web build
pnpm --filter @octo/web build:client-communication
```

The two Playwright suites intentionally use different servers:

- `e2e-kit/tests` exercises the normal Web build through `vite preview`.
- `e2e-kit/desktop-tests` exercises DEV-only fixtures through
  `playwright.desktop.config.ts`. Its server is isolated, uses a strict port
  (`E2E_DESKTOP_PORT`, default 3198), and never reuses an existing server.
  `vite.desktop.config.ts` keeps the Web plugins but limits dependency discovery
  and warmup to the fixture, with a separate cache for cold CI starts.
- Both run in the existing `e2e-p0` PR gate. Desktop failures, missing results,
  unexpected discovery shrinkage, skips, and flaky retries fail the gate. The
  desktop JSON/JUnit files are separate from the normal Web report.

Do not move DEV fixtures into the production entry to make CI green. Verify that
ordinary Web output contains neither desktop adapter logic nor desktop-only
styles; inert shared-component markers are allowed. Keep fixture artifacts and
non-mock release artifacts separate.

Unit and browser tests cover capability fallback, geometry, navigation cleanup,
overlay stacking/hiding/removal, finite motion, idle scans with infinite
animations, narrow file headers, zoom, and existing action callbacks.

## Platform Acceptance

Browser tests with macOS/Windows geometry are not native-window acceptance.
Before enabling or releasing the host integration, verify:

- macOS traffic lights, native dragging, double-click preference, fullscreen,
  focus, occlusion/restore, and multiple displays.
- Windows controls, maximize/restore, Snap Layouts, system menu, keyboard window
  commands, edge resize, and mixed-DPI displays. Test OS scaling separately from
  page zoom.
- Both platforms: input methods, drafts, scrolling, overlays, retained views,
  theme/accessibility settings, crash recovery, and signed packaged startup.

The narrow fixture sizes do not establish a new supported minimum window width
or a responsive column-collapse policy. Native material effects and a native
business toolbar are outside this adapter's scope.

Release integration must build non-mock renderers from the final committed source
and update the host's exact artifact pins. This design does not bypass manifest
validation or authorize merging, publication, or enabling the experiment.
