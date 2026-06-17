// Typecheck-only ambient declaration for `@octo/base`.
//
// WHY THIS EXISTS
// ---------------
// `@octo/base` (packages/dmworkbase) is consumed source-direct (its package.json
// `main` is `src/index.tsx` with no built `.d.ts`). When this package's `tsc
// --noEmit` follows the `import { WKApp, i18n, t, useI18n } from '@octo/base'` in
// octoweb/index.ts, TypeScript pulls the ENTIRE dmworkbase source into the program
// and reports thousands of errors that belong to the host package's own (react@17)
// typings — none of them in docs `src/**`. `skipLibCheck` does not help because
// those are `.ts/.tsx` source files, not `.d.ts`.
//
// The host monorepo's real quality gate is `vite build` (rolldown) + lint + i18n,
// NOT a cross-package `tsc` (apps/web has no tsc typecheck job; sibling feature
// packages like @octo/todo have no typecheck script at all). So docs typecheck must
// likewise stop at the `@octo/base` boundary instead of auditing the host's source.
//
// This file declares ONLY the exact surface octoweb/index.ts imports from
// `@octo/base`. It is wired via `tsconfig.typecheck.json`'s `paths` so it is used
// ONLY for the isolated `pnpm typecheck` of docs — runtime/build resolution still
// uses the real `@octo/base`. Type-safety on the seam is preserved: the docs code
// already re-declares the structural WKApp/APIClient/RouteManager interfaces in
// octoweb/types.ts, and getWKApp() casts the real WKApp to WKAppShape explicitly.
declare module '@octo/base' {
  // WKApp is cast through `unknown` to WKAppShape in octoweb/index.ts, so its precise
  // shape is irrelevant to docs typecheck; declare it as `unknown`-ish to avoid
  // re-importing the host class type.
  export const WKApp: unknown

  // i18n namespace registration surface used by DocsModule.init().
  export const i18n: {
    registerNamespace(
      namespace: string,
      resources: Record<string, Record<string, unknown>>,
    ): void
    getLocale(): string
    init(): void
  }

  // Synchronous one-shot translation (non-component reads).
  export function t(key: string, values?: Record<string, unknown>): string

  // React hook returning a `t` bound to the current locale via I18nProvider context.
  export function useI18n(): { t: (key: string, values?: Record<string, unknown>) => string }
}
