# I18n Agent Guide

This guide is the standard entry point for future agents handling multilingual UI work in Octo Web.

## Read First

Before changing user-visible copy, read these files:

1. `docs/i18n-agent-guide.md`
2. `.i18n/scan-config.json`
3. `.i18n/length-budgets.json`

After changing user-visible copy, run:

```bash
pnpm i18n:check
pnpm i18n:pseudo         # regenerate en-XA.json for any touched en-US.json
git diff --check
```

If layout may be affected by English copy length, also verify the touched screens in `zh-CN`, `en-US`, and the pseudo-locale `en-XA` (see § Copy Length Budgets & Constrained Layouts).

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

Constrained layouts — NavRail labels, tab titles, buttons, fixed-width table cells, date columns — are where localization fails most visibly. English source strings are typically the shortest form; other languages expand, and the shorter the source the higher the expansion ratio. W3C's guidance (citing IBM's *Guidelines to Design Global Solutions*) is roughly:

| Source length (chars) | Average expansion |
|---|---|
| ≤ 10 | 200 – 300 % |
| 11 – 20 | 180 – 200 % |
| 21 – 30 | 160 – 180 % |
| 31 – 50 | 140 – 160 % |
| > 70 | ~130 % |

For Chinese source (Octo's primary), expansion into English can be even steeper: a 4-character `智能总结` becomes 10-character `AI Summary` (2.5×); a 2-character `前天` becomes 25-character `The day before yesterday` (12.5×).

### Enforcement — `pnpm i18n:check`

The check reads `.i18n/length-budgets.json` and fails when any locale's translation of a matched key exceeds its budget. Each budget declares a container, a `maxChars` limit, and a list of `keyPatterns` (glob-lite: `*` matches one dot-separated segment, `**` matches one or more):

```json
{
  "budgets": [
    {
      "container": "navRailLabel",
      "maxChars": 10,
      "notes": "NavRail top-level menu — icon 40px + label area ~60-80px",
      "keyPatterns": ["base.navRail.*", "app.navRail.*"]
    },
    {
      "container": "chatListDate",
      "maxChars": 12,
      "keyPatterns": ["base.time.*"]
    }
  ]
}
```

### Escape hatch — `.short` variants

When a translation cannot fit its container but the source language reads well at full length, ship a sibling `<key>.short` value. The check accepts a violation if `<key>.short` fits the budget in the same locale. Consumers in constrained containers should resolve `<key>.short` first, then fall back to `<key>`:

```json
{
  "time.dayBeforeYesterday": "The day before yesterday",
  "time.dayBeforeYesterday.short": "2d ago"
}
```

Keep both keys — full copy stays available for tooltips, aria labels, and roomy layouts.

### Pseudo-localization — `pnpm i18n:pseudo`

`pnpm i18n:pseudo` regenerates `en-XA.json` next to every `en-US.json`. `en-XA` is the industry pseudo-locale (W3C, Chrome, Android) and the output ships three visual signals to catch layout breakage before real translations arrive:

- Accent substitutions (`á`, `β`, `ç`, …) — proves the string was routed through `t()` instead of hard-coded.
- 40 % length padding — matches the average expansion ratio; if pseudo overflows, real French/German will too.
- Wrapping brackets — anything that clips shows a truncated `]`, so the reviewer does not need a design mock.

Placeholders (`{{name}}`) are preserved, so runtime substitution keeps working. CI runs `pnpm i18n:pseudo:check` to fail when `en-XA.json` drifts from `en-US.json`; regenerate before committing English changes.

Runtime toggling to `en-XA` for browser preview is out of scope for the generator — load the file into `I18nService` locally when you need to eyeball a screen.

### Design layers, in order of preference

1. **Reserve space.** Containers use `min-width` + `width: max-content` + `max-width: 100%`, not a hardcoded `width`. Reserve for source × 2 as a rule of thumb.
2. **Short variants.** When space cannot be reserved, ship `<key>.short`.
3. **Wrap or truncate with an accessible fallback.** Truncate visually but keep the full copy in `title` / `aria-label`.

## Adding New Copy

For new user-visible copy:

1. Pick the owning namespace.
2. Add the key to both `zh-CN.json` and `en-US.json`.
3. Use `useI18n()` or `t()` at the callsite.
4. Run `pnpm i18n:check`.
5. Run `pnpm i18n:pseudo` if you touched `en-US.json`, and commit the regenerated `en-XA.json`.
6. If the text is visible in a constrained layout, verify all three locales in the browser and confirm the budget entry in `.i18n/length-budgets.json` (add a `.short` variant if the copy overflows).

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
- `pnpm i18n:pseudo` regenerated `en-XA.json` (committed) when `en-US.json` changed.
- Focused test result for touched packages.
- Browser notes for `zh-CN`, `en-US`, and — when a narrow container is in play — `en-XA` for the pseudo-locale layout check.
