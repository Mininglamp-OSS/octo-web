# I18n Agent Guide

This guide is the standard entry point for future agents handling multilingual UI work in Octo Web.

## Read First

Before changing user-visible copy, read these files:

1. `docs/i18n-agent-guide.md`
2. `.i18n/scan-config.json`

After changing user-visible copy, run:

```bash
pnpm i18n:check
git diff --check
```

If layout may be affected by English copy length, also verify the touched screens in both `zh-CN` and `en-US`.

## Architecture Rules

- Use `@octo/base` as the only application-facing i18n API.
- Do not import a third-party i18n engine directly from feature packages.
- Keep locale resources next to the package that owns the UI.
- Use JSON resources for locale files.
- Keep namespace ownership explicit.
- Use `zh-CN` and `en-US` as the required baseline locales.
- Keep URL locale prefixes, machine translation of user content, and partial third-locale rollout out of ordinary UI copy work.

Typical namespace layout:

```txt
packages/<package>/src/i18n/
  zh-CN.json
  en-US.json
```

Package modules register their namespace during `init()`:

```ts
import { i18n } from "@octo/base";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";

i18n.registerNamespace("summary", {
  "zh-CN": zhCN,
  "en-US": enUS,
});
```

## API Usage

Function components should use `useI18n()` when copy must update immediately after locale switching:

```tsx
const { t, format } = useI18n();

return <button>{t("summary.actions.create")}</button>;
```

Class components, VM files, module registration, toasts, and non-React helpers can use `t()`:

```ts
Toast.success(t("base.common.saved"));
```

Use `format` for locale-sensitive dates, times, relative times, numbers, and currency. Do not bake date/time order or punctuation into translation strings when `Intl` formatting can handle it.

```ts
const { format } = useI18n();
format.dateTime(createdAt);
format.relativeTime(updatedAt);
```

Semi UI component chrome is also locale-sensitive. The app-level `I18nProvider` owns the Semi `ConfigProvider` / `LocaleProvider` bridge, so do not set Semi locale per DatePicker, Pagination, Modal, or Select unless a component has a specific product reason. Component props that are still product copy, such as labels, placeholders, tooltips, and aria labels, must continue to use `t()`.

Language switchers live in the signed-in NavRail and on the login page. Runtime switching should update React copy, Semi UI chrome, menus, and locale-sensitive formatting without requiring a page refresh.

## Backend API I18n Rules

Keep these backend-facing rules stable:

- Locale detection accepts `?lang=`, `?locale=`, `i18n_lang`, `localStorage.octo:locale`, then browser language fallback.
- `i18n.setLocale()` persists both `localStorage.octo:locale` and the frontend-readable `i18n_lang` cookie.
- Internal Octo API requests go through `APIClient`, `apiFetch`, or `apiFetchJson` so they send `Accept-Language`.
- Web frontend code must not send `X-Octo-Lang`; it is reserved for trusted service-to-service propagation.
- Do not branch on localized backend `error.message`; use `error.code`, `error.http_status`, then legacy `status`.
- Hide raw backend text for `err.shared.internal` and 5xx errors.
- Keep raw `fetch` only for file/blob/static resources, presigned URLs, local probes, third-party URLs, unload beacons, or intentionally custom clients such as OIDC bind HTTP.
- Login response `language: ""` means no account preference. Non-empty supported values apply locally. Signed-in NavRail language changes best-effort sync `PUT /v1/user/language`; login-page changes stay local.

When changing backend API language or error behavior, run the touched package tests plus:

```bash
pnpm exec vitest run packages/dmworkbase/src/Service/__tests__/apiError.test.ts packages/dmworkbase/src/Service/__tests__/apiFetch.test.ts
pnpm i18n:check
git diff --check
```

## Key Naming

Use stable semantic keys, not source-language sentence keys.

Preferred:

```json
{
  "summary.actions.create": "Create summary",
  "todo.toast.created": "Task created"
}
```

Avoid:

```json
{
  "创建总结": "Create summary"
}
```

Key conventions:

- Prefix keys with the owning namespace domain, such as `summary`, `todo`, `base`, `login`, `contacts`, `appbot`, or `app`.
- Group by surface and intent: `actions`, `toast`, `empty`, `modal`, `form`, `menu`, `errors`, `status`.
- Use interpolation placeholders for variable content.
- Keep placeholder names identical across locales.

```json
{
  "base.thread.archiveConfirmTitle": "Archive thread \"{name}\"?"
}
```

## What To Translate

Translate:

- Buttons, labels, placeholders, tooltips, aria labels.
- Menus, tabs, filters, empty states.
- Modal titles, confirm text, toast text.
- Client-side validation and recoverable client errors.
- UI-owned status labels.

Do not translate:

- User-generated message content.
- File names, channel names, group names, contact names, summary titles from server data.
- Backend error payloads unless there is an existing code/key mapping.
- Protocol tokens, dictionary data, emoji shortcodes, pinyin or text-conversion tables.
- Test-only assertions unless tests need locale setup.

When excluding a source file from hardcoded Chinese checks, record the reason in `.i18n/scan-config.json`. Do not add broad ignores without a concrete non-UI reason.

## Copy Length Budgets & Constrained Layouts

Constrained layouts — nav labels, tabs, buttons, date columns, table cells with fixed widths — are where localization most often fails. Short source strings expand the most when translated, and Octo uses Chinese as the primary source; short Chinese labels can grow by an order of magnitude when rendered in English.

### Reference Expansion Ratios (W3C / IBM)

Source: W3C "Text size in translation" (citing IBM Guidelines to Design Global Solutions). The figures are **English-source** averages across common target locales.

| English source length | Average expansion |
|---|---|
| ≤ 10 chars | 200-300% |
| 11-20 | 180-200% |
| 21-30 | 160-180% |
| 31-50 | 140-160% |
| 51-70 | 130-140% |
| > 70 | ~130% |

For Octo, source strings are usually Chinese, not English. Chinese → English expansion is generally **larger** than the table above; treat these numbers as a lower bound when the source is Chinese and design for the worst-case locale, not the source locale. Real examples from Octo Web:

- `智能总结` (4 chars) → `AI Summary` (10 chars, 2.5×)
- `前天` (2 chars) → `The day before yesterday` (24 chars, 12×)
- `昨天` (2 chars) → `Yesterday` (9 chars, 4.5×)

### Constrained Container Inventory & Budgets

The following containers in Octo Web have fixed or narrow width constraints. When adding or migrating a translation key rendered in one of these containers, the translated string in **any** locale must fit the budget below. Budgets are conservative maxes derived from the current CSS and the current formatter outputs; measure again if the layout changes.

| Container | Component / consumer | Character budget | Notes |
|---|---|---|---|
| NavRail label — collapsed rail | `packages/dmworkbase/src/Components/NavRail/NavItem.tsx` + `.wk-navrail__item` / `.wk-navrail__item-label` in `packages/dmworkbase/src/Components/NavRail/index.css` | ≤ 8 chars | **Deliberate design carve-out**: the collapsed rail is a fixed 56 px icon-first grid (item 56×54, icon 20×20, label padding-inline 4px → usable label ~44px at font-size `--wk-text-size-tiny`). Design layer 1 ("reserve space in layout") does **not** apply here — the whole point of the collapsed rail is a constant grid; extra chars are absorbed by editing copy or by dropping to icon-only. The expanded rail (`.wk-layout-tab-expanded .wk-navrail__item`, row layout with `width: 100%`) is not budget-limited here. |
| Chat list date column | `packages/dmworkbase/src/Components/ConversationList/index.tsx` (`.wk-conversationlist-item-time`) rendering `getTimeStringAutoShort2` from `packages/dmworkbase/src/Utils/time.ts` | ≤ 16 chars | Cell is `flex-shrink: 0` and shares the header line with a `flex: 1; min-width: 0` conversation title, so an oversized time string does **not** truncate itself — it hogs the row and forces the title to truncate more. Budget covers realistic worst-case outputs the formatter already produces: `Yesterday 21:34` (15), `2026-09-06 10:00` (16), `Wed 10:30` (9). The current English `time.dayBeforeYesterday` value ("The day before yesterday") plus a time suffix reaches ~30 chars in this cell and blows the budget — see Design Layer 3 for the fix. |
| Tab title | Tabs / SegmentedControl surfaces | ≤ 12 chars | Verify per usage — some tab rows scroll horizontally and need no budget. |
| Primary button (fixed-width toolbar) | Toolbar / ActionBar surfaces with hard `width` on the button | ≤ 18 chars | Skip if the toolbar uses `width: max-content`. |
| Table column header (fixed-width) | Table headers with hard `width` | ≤ 14 chars | Skip if the table auto-sizes columns. |

Add rows to this table when a new narrow container is discovered. Do not delete rows without evidence the container is no longer constrained.

### Design Layers (in order of preference)

1. **Reserve space in layout, not in copy.** Layout containers use `min-width` + `width: max-content` + `max-width: 100%`, not `width: <fixed-px>`. Reserve for source × 2 as a rule of thumb. Deliberate design-constraint carve-outs (e.g. the fixed-grid collapsed NavRail above) are the exception, not the rule; those cases skip straight to layers 2/3.

2. **Short-variant keys (proposed convention, `.short` suffix).** When a base translation exceeds a budget in any locale, add a sibling `.short` key **atomically in every locale file at the same time**. This is a hard requirement, not a nice-to-have — see below for why.

   **Why not "fall back at the call site":** `t()`'s resolution order (see `packages/dmworkbase/src/i18n/I18nService.ts`) is:

   1. `messages[activeLocale][key]`
   2. `messages[defaultLocale][key]` (`defaultLocale` is `zh-CN`)
   3. `options.defaultValue`
   4. `key` (raw)

   So `t(\`${key}.short\`, { defaultValue: t(key) })` is **unsafe**: if only zh-CN adds `foo.short` and en-US does not, an active en-US user gets the zh-CN short string via step 2 (Chinese leaks into the English UI) and never reaches the `defaultValue`. A missing `.short` never falls back to the base key of the same locale. The safe recipe is therefore:

   - Add `foo.short` to **every** locale JSON at the same time, or don't add it in any.
   - Callers pick the key explicitly by container, not by fallback:

     ```ts
     // Constrained container:
     const label = t(narrowSurface ? `${key}.short` : key);
     ```

   - `pnpm i18n:check` should assert atomic locale coverage for any key with a `.short` sibling (any locale has `foo.short` ⇒ every locale has `foo.short`). Wire this in when the length-assertion pass lands.

   **Go-forward vs. grandfathered.** A different suffix convention already exists in the codebase — camelCase `Short` (e.g. `conversationList.minutesAgoShort`, `filePreview.pdf.noBookmarksShort`, `globalSearch.aggregated.messagesShort`, `subscribers.minutesAgoShort`, `dmworkskillmarket:reuploadShort`). Those keys are **grandfathered**; do not migrate them just to change the suffix. For **new** constrained-container keys, prefer the dotted `.short` sibling because it groups with its base in flat JSON and is trivial for `i18n:check` to pair up. Whichever convention a caller uses, the atomic-locale-coverage rule above still applies.

3. **Locale-sensitive short formats for dates/times/numbers.** Dates, times, relative times, and numbers in constrained containers must go through `format.dateTime` / `format.time` / `format.relativeTime` / `format.number` from `@octo/base`, **not** through translated phrase keys — this rule and the "shorter locale form" note on the date column are the same rule. If a shorter phrasing is needed (e.g. the current `Yesterday HH:mm` composition or a locale-native "yesterday" produced by `Intl.RelativeTimeFormat`), it should come from the formatter, not from a translation key. If a truly custom short form is unavoidable, add it as a helper on the formatter, not as a new phrase key in the resource files.

   The current `format.relativeTime` wraps `Intl.RelativeTimeFormat` with `numeric: "auto"` and takes only `(value, unit)` — there is no short-mode option today. Constrained chat/list surfaces that need `HH:mm` / weekday-abbrev / `MMM d` / `M/d/yy` should build those via `format.dateTime` / `format.time` with explicit `Intl.DateTimeFormatOptions`.

   Reference ladder to aim for in constrained rows (implement per surface, do not hard-code phrasing):

   - Today → `HH:mm`
   - Yesterday → `format.relativeTime(-1, "day")` (locale-native short form; do not hand-translate) or `format.time(ts)` for a pure `HH:mm`
   - This week → weekday abbrev via `format.dateTime(ts, { weekday: "short" })`
   - This year → `format.dateTime(ts, { month: "short", day: "numeric" })`
   - Prior years → `format.dateTime(ts, { year: "2-digit", month: "numeric", day: "numeric" })`

4. **Truncation + tooltip (last resort).** `text-overflow: ellipsis` on the element that clips, plus **both** of the following (they are not interchangeable):

   - `title="{full text}"` for the **visible hover tooltip** — sighted mouse users need this to read the truncated content on hover; screen readers may or may not surface it depending on platform.
   - `aria-label="{full text}"` (or the equivalent accessible name via visually-hidden text) for the **accessible name** — required for keyboard-only and AT users; `title` alone is not a reliable accessible name in every AT.

   Ellipsis with neither is a hard accessibility bug (W3C WAI, Baymard). Ellipsis with only one covers only half the audience.

### Anti-patterns

- ❌ Direct translation of a phrase that exceeds the budget (`The day before yesterday`, `AI Summary` in a collapsed NavRail label).
- ❌ Ellipsis without both a `title` and an accessible name — see Layer 4.
- ❌ Fixed pixel widths on layout containers holding translatable copy (outside a deliberate design-constraint carve-out).
- ❌ Reducing font-size to fit — accessibility regression.
- ❌ Adding a `.short` (or grandfathered `Short`) variant in one locale only — it silently leaks the other locale's short string into the un-updated locale via `t()`'s default-locale fallback.
- ❌ Using `defaultValue` as a `.short → base` fallback at the call site — see Layer 2 for why this is unsafe.
- ❌ Hard-coded date/time phrases in place of `format.dateTime` / `format.time` / `format.relativeTime`, whether via `t()` or inline literals.

### Verification Checklist (for PRs touching constrained layouts)

- [ ] `pnpm i18n:check` passes.
- [ ] Every locale file (`zh-CN`, `en-US`, and any future locales) carries the `.short` (or grandfathered `Short`) sibling atomically — no locale is missing it if any locale has it.
- [ ] Call sites in constrained containers select the short/base key explicitly, not via a `t(..., { defaultValue: t(base) })` fallback (which leaks zh-CN into en-US when only one locale has the sibling).
- [ ] Manual browser verification in both `zh-CN` and `en-US` for the touched screens.
- [ ] Ellipsis-truncated elements have **both** `title` (visible hover tooltip) and an accessible name (`aria-label` or equivalent).
- [ ] Date / time / number rendering goes through `format.*` (or an explicit `Intl.*` call), not a translated phrase.

### References

- W3C "Text size in translation": https://www.w3.org/International/articles/article-text-size.en
- IBM Globalization — Guidelines to design global solutions
- Material Design 3 Navigation Bar (accessibility): https://m3.material.io/components/navigation-bar/accessibility
- Apple Human Interface Guidelines — Localization: https://developer.apple.com/localization/
- SimpleLocalize — Text expansion in UI localization: https://simplelocalize.io/blog/posts/text-expansion-ui-localization/

## Adding New Copy

For new user-visible copy:

1. Pick the owning namespace.
2. Add the key to both `zh-CN.json` and `en-US.json`.
3. Use `useI18n()` or `t()` at the callsite.
4. Run `pnpm i18n:check`.
5. If the text is visible in a constrained layout, verify both languages in the browser.

## Migrating Existing Copy

For existing hardcoded copy:

1. Run `pnpm i18n:scan` to locate candidates.
2. Migrate one coherent surface at a time.
3. Keep zh-CN output behavior unchanged unless the existing copy is clearly wrong.
4. Add en-US translations with enough length realism to catch layout issues.
5. Replace literals with `t()` / `useI18n()` / `format`.
6. Run `pnpm i18n:check`.
7. Run focused tests for the touched package.
8. Manually check important screens in both locales.
9. Update PR notes with broad checkpoint facts when the migration is substantial.

## Adding A New Locale

Adding a locale is a separate product decision. Do not add a partial locale casually.

Expected work:

1. Add locale files for every registered namespace.
2. Extend `SupportedLocale` and locale detection/display names.
3. Update the language switcher if there are more than two locales.
4. Run locale key consistency checks.
5. Verify layout with the new language, especially narrow sidebars, modals, buttons, and tables.

## Commit And PR Expectations

For large i18n work, prefer a small number of meaningful commits grouped by runtime behavior, product surface migration, tests, scanner/CI guardrails, and any required layout fixes.

Every PR that changes UI copy should include:

- `pnpm i18n:check` result.
- Focused test result for touched packages.
- Browser notes for both `zh-CN` and `en-US` when layout may change.
