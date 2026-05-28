# Backend I18n Contract Goal Guide

This guide is the operating manual for goal-mode work on the Octo Web backend i18n contract integration.

Use it together with:

- `AGENTS.md`
- `DEVELOPMENT.md`
- `docs/i18n-agent-guide.md`
- `docs/i18n-tracking.md`
- `.i18n/scan-config.json`

## Goal Objective

Implement Octo Web compatibility with the backend i18n contract while keeping the current released frontend i18n behavior usable.

The final state should support:

- `?lang=` and `i18n_lang` cookie language inputs.
- `Accept-Language` on internal Octo API requests.
- Backend v2 error envelope:
  - `error.code`
  - `error.message`
  - `error.details`
  - `error.http_status`
- Legacy error fallback:
  - `msg`
  - `status`
  - outer HTTP status
- Login response `language`.
- Signed-in language preference sync through `PUT /v1/user/language`.
- Shared error and language handling for both Axios and internal `fetch` calls.

## Working Directory

Use this worktree for frontend changes:

```txt
/Users/will/Project/octo/octo-web-i18n-backend-integration
```

The branch should be:

```txt
feat/i18n-backend-integration
```

Do not edit the main checkout at:

```txt
/Users/will/Project/octo/octo-web
```

The backend checkout may be used as read-only reference:

```txt
/Users/will/Project/octo/octo-server
```

Do not edit backend files unless the user explicitly changes the task.

## Source Of Truth

Prefer sources in this order:

1. Current frontend worktree code.
2. Current backend `octo-server/main` implementation.
3. Backend draft documents.
4. Old Codex session notes.

Do not rely on old thread state or prompt cache.

## Backend Facts To Respect

Backend main currently has these i18n pieces implemented:

- Localized error renderer emits the v2 envelope and legacy fields together.
- `ResponseErrorL` uses outer HTTP status `400` for compatibility.
- Real semantic status is in `error.http_status`.
- `error.message` is localized by backend language negotiation.
- `err.shared.internal` is marked internal; details are filtered and raw server errors should not be shown.
- `Content-Language` and `Vary` are emitted by the backend i18n middleware / renderer.
- Language negotiation order is:

```txt
trusted X-Octo-Lang
?lang=
i18n_lang cookie
user.language
Accept-Language
default language
```

- Web frontend must not send `X-Octo-Lang`; it is for trusted service-to-service propagation.
- `GET /v1/user/current`, login, and related login detail responses include `language`.
- `language: ""` means the user has no explicit account preference.
- `PUT /v1/user/language` exists and accepts `{ "language": "zh-CN" }`, `{ "language": "en-US" }`, or `{ "language": "" }`.
- `PUT /v1/user/language` success returns the existing success envelope, not a language echo.
- `PUT /v1/user/language` errors are still legacy for now, so frontend must handle both v2 and legacy errors.

Important implication:

Because backend query/cookie language currently outranks `user.language`, the frontend must sync a non-empty login response `language` back into `i18n_lang`. Otherwise a stale cookie can override the account preference on later requests.

## Execution Rules

### General

- Keep each phase independently reviewable and committable.
- After each phase, run its verification commands.
- Commit after each completed phase or stable checkpoint.
- Do not push unless the user asks.
- Do not mix unrelated UI polish or refactors into this goal.
- Preserve current behavior for unsupported backend states.
- Treat backend support as progressive enhancement.

### Commit Rules

Each commit must represent a stable checkpoint:

- The worktree must build or pass the phase-specific tests before commit.
- `git diff --check` must pass before commit.
- Commit messages should use this style:

```txt
docs(i18n): add backend integration goal guide
feat(i18n): align locale inputs with backend contract
feat(api): normalize backend error envelopes
feat(api): share i18n handling with fetch requests
feat(login): apply backend language preference
feat(i18n): sync signed-in language preference
```

If a phase cannot be fully completed but reaches a useful stopping point, commit only when:

- The partial behavior is intentionally guarded.
- Tests for touched code pass.
- The commit message clearly describes the checkpoint.
- The final response names what remains.

### Goal-Mode Stop Conditions

Do not mark the goal complete until all required phases are implemented and verified.

If blocked, continue with adjacent verifiable work unless the same blocker prevents progress for three consecutive goal turns.

Examples of non-blocking conditions:

- Backend endpoint missing in one environment.
- Dev server unavailable.
- Browser login state missing.
- A legacy endpoint without v2 envelope.

Examples of real blockers:

- Contract ambiguity that changes frontend persistence semantics.
- Missing dependency install with denied network access.
- Broken workspace state that prevents tests/build and cannot be isolated.

## Phase 0: Baseline And Contract Check

Purpose: make sure the goal starts from the current frontend and backend reality.

Tasks:

- Confirm frontend worktree branch and status.
- Confirm backend repo status.
- Read this guide and the standard i18n docs.
- Inspect backend implementation when contract details matter.
- Record any contract mismatch in the final response or a doc update.

Commands:

```bash
git status --short
git branch --show-current
pnpm i18n:check
```

Backend read-only reference commands:

```bash
git -C /Users/will/Project/octo/octo-server status --short
git -C /Users/will/Project/octo/octo-server log --oneline -n 20 --grep=i18n
```

Commit:

Only commit in this phase if documentation is created or updated.

Suggested commit:

```bash
git add docs/i18n-backend-integration-goal-guide.md docs/i18n-agent-guide.md
git commit -m "docs(i18n): add backend contract goal guide"
```

## Phase 1: Locale Inputs And Cookie Persistence

Purpose: make frontend language detection compatible with backend links and public pages.

Files:

- `packages/dmworkbase/src/i18n/detectLocale.ts`
- `packages/dmworkbase/src/i18n/I18nService.ts`
- `packages/dmworkbase/src/i18n/__tests__/detectLocale.test.ts`
- `packages/dmworkbase/src/i18n/__tests__/I18nService.test.ts`

Detection order:

```txt
explicit locale
?lang=
?locale=
i18n_lang cookie
localStorage octo:locale
navigator.language
defaultLocale
```

Persistence:

```txt
localStorage.octo:locale
i18n_lang=<locale>; Path=/; Max-Age=31536000; SameSite=Lax
```

Rules:

- Keep `?locale=` for backward compatibility.
- `i18n_lang` is not a security token.
- Do not make `i18n_lang` HttpOnly; frontend and public pages need read/write access.
- Only persist normalized supported locales.

Verify:

```bash
pnpm exec vitest run packages/dmworkbase/src/i18n/__tests__/detectLocale.test.ts
pnpm exec vitest run packages/dmworkbase/src/i18n/__tests__/I18nService.test.ts
pnpm i18n:check
git diff --check
```

Commit:

```bash
git add packages/dmworkbase/src/i18n
git commit -m "feat(i18n): align locale inputs with backend contract"
```

## Phase 2: Shared API Error Normalizer

Purpose: make all frontend error handling understand both v2 and legacy backend errors.

Files:

- `packages/dmworkbase/src/Service/apiError.ts`
- `packages/dmworkbase/src/Service/__tests__/apiError.test.ts`

Normalize these inputs:

```txt
v2:
data.error.code
data.error.message
data.error.details
data.error.http_status

legacy:
data.msg
data.status
outer HTTP status
```

Output shape:

```ts
interface NormalizedApiError {
  code?: string;
  httpStatus?: number;
  message: string;
  backendMessage?: string;
  details?: Record<string, unknown>;
  raw: unknown;
}
```

Display policy:

- `err.shared.internal` or 5xx: show frontend generic internal error, not backend raw text.
- `err.shared.auth.required`, `err.shared.auth.token_missing`, `err.shared.auth.token_invalid`, `err.shared.auth.token_expired`, or 401: session expired / login required.
- `err.shared.auth.forbidden` or 403: permission message, no logout.
- `err.shared.rate.limited` or 429: rate limit message.
- Business errors: show backend localized `error.message`.
- Legacy errors: show `msg`; fallback to frontend unknown error.

Rules:

- Never branch business behavior on `error.message`.
- Branch on `error.code` first.
- Use `error.http_status` for status-like behavior.
- Fall back to outer HTTP status only for legacy responses.

Verify:

```bash
pnpm exec vitest run packages/dmworkbase/src/Service/__tests__/apiError.test.ts
pnpm i18n:check
git diff --check
```

Commit:

```bash
git add packages/dmworkbase/src/Service/apiError.ts packages/dmworkbase/src/Service/__tests__/apiError.test.ts
git commit -m "feat(api): normalize backend error envelopes"
```

## Phase 3: APIClient Contract Integration

Purpose: make the main Axios path send language intent and consume normalized errors.

Files:

- `packages/dmworkbase/src/Service/APIClient.ts`
- `packages/dmworkbase/src/Service/apiLanguage.ts`
- `packages/dmworkbase/src/Service/__tests__/APIClient.error.test.ts`

Request behavior:

- Send `Accept-Language` for internal Octo API calls.
- Do not send `X-Octo-Lang`.
- Do not send `X-Octo-Error-Envelope` by default.

Response behavior:

- Use `normalizeApiError`.
- Trigger logout from auth codes or normalized 401.
- Preserve legacy `extractErrorMsg`.
- Keep existing callers compatible with `{ error, msg, status }` if needed.

Verify:

```bash
pnpm exec vitest run packages/dmworkbase/src/Service/__tests__/apiError.test.ts
pnpm exec vitest run packages/dmworkbase/src/Service/__tests__/APIClient.error.test.ts
pnpm --filter @octo/web build
pnpm i18n:check
git diff --check
```

Commit:

```bash
git add packages/dmworkbase/src/Service
git commit -m "feat(api): use backend i18n error semantics"
```

## Phase 4: Fetch Wrapper And Internal Fetch Migration

Purpose: keep direct internal `fetch` calls aligned with Axios behavior.

Files:

- `packages/dmworkbase/src/Service/apiFetch.ts`
- `packages/dmworkbase/src/Service/__tests__/apiFetch.test.ts`
- Internal fetch call sites as needed.

Wrapper API:

```ts
apiFetch(input, init)
apiFetchJson<T>(input, init)
```

Internal API fetches must:

- Send `Accept-Language`.
- Parse non-2xx JSON safely.
- Throw `NormalizedApiError`.

Do not wrap:

- Presigned upload URLs.
- File download or preview resources.
- PDF, PPT, image, and static content fetches.
- Local speech model probe requests.
- Third-party absolute URLs.

For unwrapped fetches, add a short comment if the reason is not obvious.

Initial call sites to inspect:

- `apps/web/src/Components/InviteLanding`
- `apps/web/src/Components/ConnectionStatus`
- `packages/dmworkbase/src/Components/NavRail/NavSettingsPanel`
- File preview renderers, only to confirm they should remain raw fetch.

Verify:

```bash
pnpm exec vitest run packages/dmworkbase/src/Service/__tests__/apiFetch.test.ts
pnpm --filter @octo/web build
pnpm i18n:check
git diff --check
```

Commit:

```bash
git add packages/dmworkbase/src/Service apps/web/src packages/dmworkbase/src/Components
git commit -m "feat(api): share i18n handling with fetch requests"
```

## Phase 5: Login Response Language

Purpose: apply account-level language preference when backend returns it.

Files:

- `packages/dmworklogin/src/loginSession.ts`
- `packages/dmworklogin/src/__tests__/loginSession.test.ts`

Rules:

- If `language` is `zh-CN` or `en-US`, call `i18n.setLocale(language)`.
- Persist both `localStorage.octo:locale` and `i18n_lang`.
- If `language` is `""`, do not synthesize a default and do not overwrite local preference.
- If `language` is absent, keep current behavior.
- Because backend cookie language outranks `user.language`, syncing non-empty `language` into cookie is required.

Verify:

```bash
pnpm exec vitest run packages/dmworklogin/src/__tests__/loginSession.test.ts
pnpm --filter @octo/login test
pnpm --filter @octo/web build
git diff --check
```

Commit:

```bash
git add packages/dmworklogin/src
git commit -m "feat(login): apply backend language preference"
```

## Phase 6: Signed-In Language Sync

Purpose: persist signed-in user language changes to backend without blocking local UI switching.

Files:

- `packages/dmworkbase/src/Components/NavRail/NavLanguageSwitcher.tsx`
- Optional: `packages/dmworkbase/src/Service/UserLanguageService.ts`
- Relevant tests.

Flow:

```txt
1. User selects a language.
2. UI immediately calls setLocale(next).
3. localStorage and i18n_lang cookie update.
4. If signed in, best-effort PUT /v1/user/language { language: next }.
5. Success does not need response language echo.
6. Failure does not roll back UI.
```

Rules:

- Login page language switching does not call `PUT /v1/user/language`.
- Signed-in NavRail language switching does call it.
- Legacy errors from this endpoint must not break local language switching.
- Avoid noisy toast unless product wants explicit failure feedback.

Verify:

```bash
pnpm exec vitest run packages/dmworkbase/src/i18n/__tests__/I18nService.test.ts
pnpm --filter @octo/web build
pnpm i18n:check
git diff --check
```

Browser checks:

```txt
Signed-in switch updates UI immediately.
localStorage.octo:locale changes.
i18n_lang cookie changes.
PUT /v1/user/language is sent when signed in.
Failed PUT does not roll back UI.
Login page switch does not call PUT.
```

Commit:

```bash
git add packages/dmworkbase/src/Components/NavRail packages/dmworkbase/src/Service
git commit -m "feat(i18n): sync signed-in language preference"
```

## Phase 7: Documentation And Final Regression

Purpose: make the integration maintainable for future agents and reviewers.

Files:

- `docs/i18n-agent-guide.md`
- `docs/i18n-tracking.md`
- `docs/i18n-backend-integration-goal-guide.md`
- Any PR checklist updates if required.

Document:

- `?lang=` / `?locale=` compatibility.
- `i18n_lang` cookie.
- Backend v2 envelope and legacy fallback.
- `Accept-Language` request behavior.
- No frontend `X-Octo-Lang`.
- No default `X-Octo-Error-Envelope`.
- Internal fetch wrapper rules.
- Signed-in language sync behavior.

Verify:

```bash
pnpm i18n:check
pnpm --filter @octo/web build
git diff --check
```

Full focused regression:

```bash
pnpm exec vitest run packages/dmworkbase/src/i18n/__tests__/detectLocale.test.ts
pnpm exec vitest run packages/dmworkbase/src/i18n/__tests__/I18nService.test.ts
pnpm exec vitest run packages/dmworkbase/src/Service/__tests__/apiError.test.ts
pnpm exec vitest run packages/dmworkbase/src/Service/__tests__/apiFetch.test.ts
pnpm exec vitest run packages/dmworklogin/src/__tests__/loginSession.test.ts
```

Commit:

```bash
git add docs
git commit -m "docs(i18n): document backend contract integration"
```

## Final Acceptance

The goal is complete only when:

- Phase 1 through Phase 7 are implemented or explicitly declared unnecessary with evidence.
- `pnpm i18n:check` passes.
- `pnpm --filter @octo/web build` passes.
- `git diff --check` passes.
- Focused tests for touched code pass.
- Browser checks cover:
  - `?lang=en-US`
  - `?locale=zh-CN`
  - signed-out language switching
  - signed-in language switching
  - legacy error response
  - v2 outer 400 with `error.http_status=401`
  - `err.shared.internal`
  - at least one migrated internal fetch path
- Work is committed in stable phase commits.

## PR Notes Template

Use this in the PR body:

```txt
Backend i18n contract integration

Implemented:
- Locale inputs: ?lang, ?locale, i18n_lang, localStorage, navigator fallback
- Accept-Language on internal API requests
- v2 + legacy API error normalization
- APIClient integration
- apiFetch integration for internal fetch calls
- login response language handling
- signed-in PUT /v1/user/language sync

Not sent:
- X-Octo-Lang, because it is trusted service-to-service only
- X-Octo-Error-Envelope by default, because backend already double-emits and CORS rollout should stay independent

Verification:
- pnpm i18n:check
- pnpm --filter @octo/web build
- focused vitest commands:
  - ...
- browser checks:
  - ...
```
