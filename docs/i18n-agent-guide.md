# I18n Agent Guide

This guide is the standard entry point for future agents handling multilingual UI work in Octo Web.

For architecture decisions, rollout status, and governance rules, read `docs/i18n-tracking.md`.

## Read First

Before changing user-visible copy, read these files:

1. `docs/i18n-agent-guide.md`
2. `docs/i18n-tracking.md`
3. `.i18n/scan-config.json`

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

## Adding New Copy

For new user-visible copy:

1. Pick the owning namespace.
2. Add the key to both `zh-CN.json` and `en-US.json`.
3. Use `useI18n()` or `t()` at the callsite.
4. Run `pnpm i18n:check`.
5. If the text is visible in a constrained layout, verify both languages in the browser.
6. Update `docs/i18n-tracking.md` only when the change affects architecture, rollout status, or governance rules.

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

For large i18n work, prefer one PR with a small number of meaningful commits:

1. Docs and migration tracking.
2. Runtime and language switcher.
3. Product/app surface migrations.
4. Base/shared chat surface migrations.
5. Tests.
6. Scanner, CI, and governance.
7. Layout polish or unrelated support chores, only if needed.

Every PR that changes UI copy should include:

- `pnpm i18n:check` result.
- Focused test result for touched packages.
- Browser notes for both `zh-CN` and `en-US` when layout may change.
