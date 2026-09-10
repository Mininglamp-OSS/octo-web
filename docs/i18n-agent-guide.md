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

English expansions break narrow UI. Budget the copy against the container, not only against the Chinese source.

### Expansion-ratio reference

| Pattern | Example (zh-CN → en-US) | Approx. expansion |
| --- | --- | --- |
| Short relative date | `前天` → `The day before yesterday` | ~12× |
| Compact status | `已完成` → `Completed` | ~1.5–2× |
| Nav / rail label | `AI 总结` → `AI Summary` | ~1.5× |
| Primary button verb | `创建` → `Create` | ~1× |
| Error / toast sentence | short CN clause → full EN sentence | 2–3× |

W3C / IBM localization guidance commonly budgets **30–50% expansion** for UI strings; treat the table above as the floor for short constrained labels.

### Constrained container inventory (starter)

Keep this table alive. When you discover a new narrow container, add a row.

| Container | Typical budget | Notes |
| --- | --- | --- |
| NavRail collapsed label | ~8–12 Latin chars | Truncation shows `Sum...` if over budget |
| Chat list date column | ~12–16 Latin chars | `The day before yesterday` blows the column |
| Tab titles | ~12–20 Latin chars | Prefer short keys |
| Primary / compact buttons | ~12 Latin chars | Prefer verbs, not full sentences |
| Fixed-width table headers | measure cell width | Prefer short nouns; avoid clauses |

### Design layers (preference order)

1. **Reserve layout space** — size the container for the longest required locale.
2. **`.short` variant keys** — ship a dedicated short key for the constrained surface (e.g. `date.short.dayBeforeYesterday`).
3. **Locale-sensitive `format.*`** — use `format.relativeTime` / `format.dateTime` instead of hand-translated date phrases.
4. **Truncation + tooltip** — last resort only; document the container in the inventory table.

### Anti-patterns

- Translating a compact Chinese date phrase into a full English sentence without a `.short` key.
- Shipping only `zh-CN` length realism, then discovering overflow in `en-US` review.
- Clipping the start and end of a centered single-line note instead of wrapping.
- Growing a fixed-width column without re-checking both locales.

### PR verification checklist (constrained layouts)

- [ ] Budget checked for both `zh-CN` and `en-US` on every touched constrained surface.
- [ ] New narrow containers added to the inventory table above.
- [ ] `.short` key or `format.*` used where expansion exceeds the budget.
- [ ] Screenshots or notes for both locales when truncation or overflow is possible.

### References

- [W3C Internationalization — Strings on the Web](https://www.w3.org/International/questions/qa-translate-able.en)
- [IBM Localization quality](https://www.ibm.com/docs/en/ibm-style-guide)
- [Material Design 3 — Content](https://m3.material.io/foundations/content/overview)
- [Apple HIG — Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- SimpleLocalize / common L10n expansion guidance

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
