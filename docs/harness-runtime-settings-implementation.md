# Harness runtime settings implementation

## Behaviour

- Add an always-visible `Devices and runtimes` entry under the Settings `Tools` group.
- Keep the existing device download/resource page intact and rename its entry to `Tools and resources`.
- List runtimes owned by the signed-in user in the current workspace, including status, device, version, and last heartbeat.
- Create a short-lived device enrollment token immediately when the user selects Add device; there is no second generate step.
- Build a copyable `octo-harness login` command locally and present it as a code block. The profile is derived from the enrollment's Space ID and user ID, and the server URL comes from the current web origin. The command does not override the harness agent-worker URL.
- Let `octo-harness` use the target device hostname as the initial Runtime name; naming is not part of enrollment.
- Embed the short-lived, one-time enrollment token in the temporary POSIX command and feed it through `--enroll-token-stdin`.
- Support loading, empty, error/retry, refresh, token expiry, and copy feedback states.

## File map

- `packages/dmworkbase/src/ui/HarnessRuntimeSettings`: pure runtime list and enrollment dialog UI plus Storybook states.
- `packages/dmworkbase/src/bridge/HarnessRuntimeSettings`: stateful hook joining the UI contract to the service.
- `packages/dmworkbase/src/features/harnessRuntime`: settings-page composition and localized copy.
- `packages/dmworkbase/src/Service/HarnessRuntimeService.ts`: typed agent-worker HTTP contract.
- `packages/dmworkbase/src/Components/NavRail`: Settings registry, icon, and page wiring.
- `nginx.conf.template` and `docker-entrypoint.sh`: same-origin `/agentworker/api/` proxy configured by `CODEWORKER_URL`.

## API contract

- `GET /agentworker/api/v1/runtimes`
- `POST /agentworker/api/v1/device_enrollments`

Both browser calls rely on the existing `APIClient` human-auth headers (`token` and `X-Space-ID`). Runtime device enrollment and daemon registration remain the responsibility of `octo-harness`.

For local development, set `CODEWORKER_URL=http://localhost:8091`. Vite and nginx preserve the complete `/agentworker/api/v1/*` path for the local gateway.

## Pull request scope

This change does not add Electron-specific installation, onboarding, runtime mutation controls, editable setup fields, or unified shell/PowerShell installation scripts.

## Verification

- Component stories cover populated, empty, loading, and error states.
- Unit tests cover service paths, command generation, profile validation, and settings registration.
- Run focused Vitest suites, TypeScript/build checks, `pnpm i18n:check`, and `git diff --check`.
- Exercise the proxy and authenticated API flow against `https://im-test.deepminer.com.cn/` when the test deployment exposes the configured agent-worker upstream.
