# RFC: `@octo/ui` Icon, Avatar, and AvatarGroup

- Status: Avatar/AvatarGroup accepted; Icon visual rules accepted, asset manifest pending
- Date: 2026-08-27
- Scope: shared UI primitives and migration policy
- Baseline: `feat/octo-ui-tooltip` at `980d8604`

## Summary

Define a project-owned `Icon` registry strategy and introduce the accepted
`Avatar` and `AvatarGroup` primitives in `@octo/ui`. Icon implementation stays
deferred until the approved asset manifest is supplied.

This change includes one business-adapter pilot: the existing `WKAvatar`
component now composes the shared `Avatar` primitive while retaining its SDK
URL resolution, scroll-root lazy loading, refresh events, fallback, class names,
and caller-owned sizing. It does not migrate an `AvatarGroup` business caller
or move business responsibilities into `@octo/ui`. Components that fetch a
palette, upload or crop an image, display presence, or own navigation remain in
their business packages and may compose the primitives later.

## Why an RFC is required

The current names hide materially different responsibilities:

- `WKAvatar` resolves channel URLs, observes scroll containers, handles image
  failure, and reacts to channel-avatar events.
- `ChannelAvatar` owns upload, crop, save, analytics, modal, and permission
  behavior.
- `GroupAvatarPreview` fetches and caches the server-compatible palette and
  reproduces server text-layout rules.
- `SpaceAvatar`, `ListItemAvatar`, `AppBotAvatar`, and the message Avatar each
  add their own domain or interaction behavior.
- Icons currently come from multiple providers with no shared naming,
  accessibility, sizing, or replacement policy.

Treating these components as interchangeable would either leak business logic
into the shared package or silently remove established behavior.

## Current inventory

The following numbers are a source-file census on the RFC baseline. They are
used to size the migration problem, not to authorize a bulk replacement.

### Icon sources

| Source                      | Files referencing it | Current role                                            | RFC decision                                                      |
| --------------------------- | -------------------: | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `lucide-react`              |                  110 | General outline icons                                   | Transitional source behind the project registry                   |
| `@douyinfe/semi-icons`      |                   90 | General and Semi-coupled icons                          | Transitional source; never exposed by the public API              |
| local `filled-*` SVG assets |                    2 | Project-owned filled assets                             | Register only after visual and naming review                      |
| Meego                       |    1 token reference | Historical design annotation, not a usable icon library | Do not treat as a provider until real assets and call sites exist |

The visual reference contains many inline icons but no standalone, accepted
Icon component specification. Icon sizes and stroke/fill rules therefore need
explicit approval rather than being inferred from unrelated examples.

### Avatar systems

| Component            | Production files referencing it | Responsibility                                                | Boundary decision                                         |
| -------------------- | ------------------------------: | ------------------------------------------------------------- | --------------------------------------------------------- |
| `WKAvatar`           |                              33 | Channel URL resolution, lazy loading, refresh event, fallback | Keep as business/runtime adapter                          |
| `ChannelAvatar`      |                               5 | Upload, crop, save, modal and analytics workflow              | Keep as business feature                                  |
| `GroupAvatarPreview` |                               6 | Server palette and server-compatible group text layout        | Keep as business adapter; may compose `Avatar` later      |
| `SpaceAvatar`        |                               3 | Space-specific naming and colour choice                       | Keep as business adapter; candidate for later composition |
| `ListItemAvatar`     |                               1 | Upload entry and editing flow                                 | Keep as business feature                                  |
| `AppBotAvatar`       |                               3 | Bot-to-channel mapping                                        | Keep as business adapter                                  |
| message Avatar       |                local message UI | Image plus online status                                      | Keep as message composition; use `Avatar + Dot` later     |
| Semi `Avatar`        |     1 confirmed production file | Static member fallback                                        | First possible migration pilot after primitive acceptance |

There is no existing exported `AvatarGroup` primitive. Thread surfaces contain
local overlapping-avatar layouts and are migration candidates only after the
new layout primitive is accepted.

## Goals

- Give application code a stable project-owned Icon vocabulary.
- Normalize icon sizing, colour inheritance, accessibility, and visual source
  selection without exposing provider props.
- Provide a pure visual Avatar primitive that matches the accepted design
  reference and an AvatarGroup primitive that follows the separately confirmed
  product rules.
- Define which existing avatar responsibilities remain in business packages.
- Make later migration incremental, measurable, and reversible.

## Non-goals

- Bulk-replacing Semi, Lucide, filled SVG, or native inline SVG usage.
- Moving channel lookup, SDK access, API calls, palette fetching, upload,
  cropping, analytics, permissions, navigation, or presence into `@octo/ui`.
- Renaming all existing business components in one change.
- Adding a second user-visible entry for any avatar editing flow.
- Treating screenshots, Storybook fixtures, or symbol names as proof that two
  business interactions are equivalent.

## Decision 1: Icon registry

### Public contract

`@octo/ui` will own a typed, curated registry. Callers use stable project names
rather than importing provider-specific components through the primitive.

Proposed shape:

```ts
export type IconName = "search" | "close" | "chevron-right" | "add";

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  name: IconName;
  size?: IconSize;
  label?: string;
}
```

The final initial name list will be generated from an approved manifest rather
than copied from any provider's full catalogue.

### Naming

- Use stable glyph names such as `search`, `close`, and `chevron-right`.
- Do not encode a business destination such as `delete-thread` in a generic
  glyph name.
- Do not expose provider prefixes such as `IconSearchStroked`, `LucideSearch`,
  or `MeegoSearch`.
- Add aliases only as deprecated migration aids and remove them after callers
  migrate.

### Source priority

For a new registry entry, use this order:

1. Approved project/design SVG when exact artwork exists.
2. Lucide for a matching generic outline glyph.
3. Semi only as a temporary compatibility source when replacing it would alter
   the accepted appearance.
4. Legacy local SVG only after its view box, fill/stroke behaviour, and licence
   are verified.

The source is registry metadata. Consumers must not depend on it.

### Bundle strategy

- Keep the registry curated; do not register the thousands of scanned design
  symbols or entire vendor catalogues.
- Generate `IconName` and exports from one manifest so runtime and type surfaces
  cannot drift.
- Prefer per-icon generated exports or another build-time tree-shakable form.
- Reject a root module that eagerly imports every Lucide and Semi icon.
- Add a bundle comparison before accepting the first implementation PR.

### Rendering and accessibility

- Icons render on a consistent square view box and inherit `currentColor`.
- The approved Icon size scale is `16 / 20 / 24`, with a `1.5px` stroke width
  for outline icons.
- Existing callers outside the approved size scale are reviewed case by case;
  migration must not silently round them to the nearest supported size.
- Filled icons are reserved for navigation. Other contexts use the approved
  outline artwork unless the design owner explicitly confirms an exception.
- The initial glyph manifest remains deferred until the design owner supplies
  the approved Icon assets.
- Decorative icons are `aria-hidden` by default.
- A meaningful standalone icon requires `label` and exposes an accessible
  image role.
- `Icon` is not interactive. Icon-only actions use the project Button and must
  provide an accessible label.
- A filled and outline glyph are separate reviewed registry entries unless the
  design explicitly defines them as variants of one icon.

## Decision 2: Avatar

### Visual authority

The accepted Avatar section in `Web-组件总览.html` defines:

- person: circular, solid palette colour, white text, at most two visible
  characters;
- group: circular, tinted background, palette border and foreground, at most
  four visible characters;
- group CJK layout: three characters use one over two, four characters use two
  over two; non-CJK content remains on one line;
- no-name group fallback: a group icon;
- sizes: `40 / 32 / 28 / 20 / 16`;
- a fixed ten-colour component palette independent of semantic status colours;
- person and group avatars use the same tone index: the person's solid
  background colour is also the group's border and foreground colour, while
  the group uses the matching tinted background.

### Public contract

The primitive receives already-authorized display data. It does not resolve a
user, channel, group, Space, or bot.

Proposed shape:

```ts
export type AvatarSize = 16 | 20 | 28 | 32 | 40;
export type AvatarKind = "person" | "group";
export type AvatarTone = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface AvatarProps {
  src?: string;
  alt: string;
  size?: AvatarSize;
  kind?: AvatarKind;
  fallbackText?: string;
  fallbackIcon?: React.ReactNode;
  tone?: AvatarTone;
  className?: string;
  imageLoading?: "eager" | "lazy";
}
```

Contract rules:

- `src` success renders the image; load failure falls back to the provided
  text or icon without fetching business data.
- `kind` controls only visual treatment and text layout.
- Palette selection is deterministic through `tone`; the primitive does not
  call the group palette endpoint.
- The ten tones are fixed `@octo/ui` component tokens shared by person and
  group avatars. Existing server-backed group palette behavior remains in
  `GroupAvatarPreview` until a later migration proves exact parity.
- `alt` is required but may be an empty string when adjacent text already names
  the same entity.
- Click, edit, upload, presence, badge, and navigation behavior are external
  composition.
- Custom IntersectionObserver logic remains in `WKAvatar`; the primitive may
  only expose native image loading behaviour.

## Decision 3: AvatarGroup

`AvatarGroup` is a layout primitive and composes `Avatar` children.

The Avatar section of `Web-组件总览.html` specifies a single group avatar, not
this overlapping multi-avatar layout. The same preview contains a `4 × 16px`
overlapping usage example in its Thread section, but it is not the standalone
AvatarGroup contract. The rules below are the separately confirmed product
rules and take precedence over that contextual example.

Confirmed rules:

- maximum visible count `3`;
- adjacent overlap `8px`;
- overflow is hidden, with no `+N` item;
- no white or other separating border between overlapping avatars;
- the current product has both `16px` and `20px` avatar groups, each using an
  `8px` overlap;
- the caller selects `16px` or `20px` according to its container; there is no
  single global default size yet;
- total count remains the responsibility of adjacent business copy.

Additional sizes are not part of the initial contract. They may be added only
after a real container requires and verifies them.

Proposed shape:

```ts
export type AvatarGroupSize = 16 | 20;

export interface AvatarGroupProps {
  children: React.ReactElement<AvatarProps>[];
  size: AvatarGroupSize;
  max?: 1 | 2 | 3;
  label?: string;
  className?: string;
}
```

`max` defaults to `3`; the implementation always uses an `8px` overlap and no
separating border. Requiring `size` prevents the primitive from guessing which
container-specific size is correct.

## Business composition boundary

| Existing owner          | May later compose                                | Must continue to own                                             |
| ----------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| `WKAvatar`              | `Avatar` image shell                             | SDK URL resolution, scroll-root lazy loading, refresh events     |
| `ChannelAvatar`         | Avatar preview                                   | upload, crop, save, modal, permissions, analytics                |
| `GroupAvatarPreview`    | `Avatar kind="group"` if visual parity is proven | server palette, colour seed and server-compatible text rules     |
| `SpaceAvatar`           | `Avatar`                                         | Space name/logo mapping                                          |
| `ListItemAvatar`        | Avatar display slot                              | file picker and upload workflow                                  |
| `AppBotAvatar`          | `WKAvatar` or `Avatar`                           | bot/channel mapping                                              |
| message Avatar          | `Avatar` and `Dot`                               | message click semantics and online-state decision                |
| thread participant rows | Keep the existing business layout for now        | participant selection, ordering, total-count copy and navigation |

## Delivery plan

### Current PR: RFC, Avatar primitives, and the WKAvatar pilot

- Add this document and the docs index entry.
- Add the accepted Avatar and AvatarGroup primitives, component tokens, public
  exports, Stories, and focused tests.
- Compose `Avatar` inside the existing `WKAvatar` runtime adapter while keeping
  its URL resolution, lazy loading, refresh events, fallback, class names, and
  caller-owned sizing behavior unchanged.
- Do not migrate an AvatarGroup business caller in this PR.
- Keep the Icon provider strategy documented, but leave implementation for the
  separate Icon branch until the approved asset manifest is available.

### Later PR on a new branch: Icon primitive

- Add the manifest, generator or consistency check, primitive, styles, exports,
  Stories, and focused tests.
- Start with a small approved core set; do not ingest full provider catalogues.
- Validate bundle output and prove no Semi or Lucide type leaks through the
  public declarations.
- Do not migrate business callers in the primitive PR.

### Later migration PRs

- Review `ChannelAvatar`, `GroupAvatarPreview`, `SpaceAvatar`,
  `ListItemAvatar`, and `AppBotAvatar` one owner at a time; keep each business
  implementation until visual and behavioural parity is proven on a real
  route.
- Do not migrate `ThreadCreated` to `AvatarGroup`: the currently reachable
  production cards provide only one participant, so they do not prove a real
  overlapping-avatar requirement. Reconsider only after a reachable business
  surface supplies at least two real participants.
- Inventory Icon callers by provider and interaction contract; migrate one
  owner at a time.
- Preserve provider visuals when no approved registry equivalent exists.

## Verification gates for implementation PRs

### Automated

- component tests for rendering, fallback, size, truncation, visibility and
  accessibility contracts;
- `@octo/ui` typecheck and build;
- public declaration/runtime export parity;
- registry duplicate-name and missing-definition check;
- bundle comparison proving the registry does not pull complete icon vendors;
- `git diff --check` and complete-diff review.

### Storybook

- Icon gallery: approved registry entries, size candidates, current-colour
  inheritance, filled/outline entries, and decorative/meaningful examples;
- Avatar: image, error fallback, person one/two-character, group three/four-CJK,
  non-CJK, no-name icon, ten tones, and all five sizes;
- AvatarGroup: one, two, three, and more-than-three children at `16px` and
  `20px`, both with `8px` overlap and no separating border;
- light and dark themes with resolved computed token values.

### Manual migration cases

Every later business migration must name a real route and prove:

- the same avatar source, fallback, ordering, click action, permissions, lazy
  loading, refresh event, upload flow, and online status remain intact;
- Icon placement, tooltip, disabled state, click target, and accessible label
  remain intact;
- excluded native or unmatched visual implementations remain untouched.

`ThreadCreated` is excluded from the current AvatarGroup business migration
and must not be listed as a two/three-avatar manual case while its real payload
contains only one participant. The one/two/three/more-than-three cases above
remain Storybook coverage for the primitive, not claims about current business
data.

## Open decisions requiring design approval

1. Supply and approve the Icon asset manifest. The size scale (`16 / 20 / 24`),
   `1.5px` stroke rule, and filled-icons-only-in-navigation rule are confirmed;
   the asset set itself is still pending.

AvatarGroup border/count/overlap rules and Avatar palette ownership are no
longer open. Only the Icon specification is waiting for design input.
