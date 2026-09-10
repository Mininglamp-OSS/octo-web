# Formal-content browser fixture

Test-only host for the production formal-content entry, feature, bridge, Service
and citation renderer. It talks to the real isolated API/Worker/MySQL fixture;
it does not mock Summary responses. Authentication uses synthetic fixture
identities, not browser-stored credentials. This folder is excluded from the
normal production Web entry.

Start the backend fixture documented in the paired backend repository's
`tests/content-execution-mirror/README.md`, then:

```sh
pnpm --dir apps/web exec vite build --config vite.formal-mirror.config.ts
docker build -f tests/content-execution-mirror/Dockerfile \
  -t octo-web:versioning-execution-final-20260908 .
docker run -d --name octo-summary-versioning-execution-web \
  --network octo-summary-versioning-test -p 127.0.0.1:28350:80 \
  octo-web:versioning-execution-final-20260908
```

Do not recreate an existing named container without inspecting its state.
The Vite fixture deliberately inherits the production build's test-module
exclusions: the legacy CommonJS dynamic asset lookup would otherwise import
Vitest test files and cause a runtime blank screen.

Open `http://127.0.0.1:28350/` for Chinese/light, or
`http://127.0.0.1:28350/?lang=en-US&theme=dark` for English/dark.

Verified September 8, 2026: real chat-source picker loads, schedule-only save
keeps the current version and next-run phase, explicit save-and-generate
disables overwrites while queued and updates to cited V5 automatically,
refresh restores V7 without generating again, seven historical versions and
irreversible-restore confirmation display correctly. English dark layout has
no horizontal overflow at 1440, 1024 and 720px; scoped buttons render at 28px.

Final Summary Vitest: 86 files / 1,255 tests passed. Production Web build and
i18n checks passed. Package typecheck is **not passing**: pristine upstream has
6,025 diagnostics; current source has 6,035. The ten additions are missing
React/Storybook declaration diagnostics on the new files and the inherited
ChatSelectorModal JSX-type failure, not a clean typecheck result.

This is not complete host navigation/login acceptance, a real provider quality
test, or the real-history/two-account 28140 rollout gate. Team/group execution,
generation-event notifications and initial-create coordination remain out of
this pilot. Existing mirrors and their data remain unchanged.
