# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Octo-web is the web frontend for DMWork (enterprise IM platform). It's a pnpm monorepo with Turborepo, React + TypeScript.

- **Package Manager**: pnpm
- **Build Tool**: Vite + Turborepo
- **Test Framework**: Vitest
- **Default Branch**: `main`

## Common Commands

```bash
# Install dependencies
pnpm install

# Development
pnpm dev                        # start dev server (excludes extension)
pnpm dev:all                    # start all including extension

# Build
pnpm build                      # production build

# Test
cd apps/web && pnpm test        # run vitest

# Lint
pnpm lint                       # turbo-orchestrated lint across all packages
```

## Architecture

### Monorepo Structure

```
apps/
  web/          — Main web application (Vite + React)
  extension/    — Browser extension
packages/
  dmworkbase/       — Core shared components (Chat, ChannelSetting, Conversation)
  dmworkcontacts/   — Contacts module
  dmworkdatasource/ — Data layer
  dmworklogin/      — Authentication
  dmworksummary/    — Summary/notes feature
  dmworktodo/       — Todo/task feature
  dmworkappbot/     — App bot integration
  eslint-config-custom/  — Shared ESLint config
  tsconfig/         — Shared TS config
```

### Key Patterns

**Global App Object**: `WKApp.shared` is the singleton entry point for app-wide state, API clients, module registration, and navigation.

```typescript
WKApp.shared.registerModule(new MyModule())
WKApp.apiClient.config.apiURL
WKApp.shared.currentSpaceId
```

**ViewModel Pattern**: Components use `ProviderListener`-based ViewModels (not Redux/Zustand):

```typescript
export class ChatVM extends ProviderListener {
  // reactive state + business logic
}
```

**Module Registration**: Each package exports a Module class registered in `apps/web/src/index.tsx`:

```typescript
import { MyModule } from '@octo/my-package'
WKApp.shared.registerModule(new MyModule())
```

### Mention System

DMWork uses a multi-tier mention protocol:
- `@所有人` (all humans) → UID sentinel `-2`, `mention.humans=1`
- `@所有AI` (all AIs) → UID sentinel `-3`, `mention.ais=1`
- `@具体用户` → standard UID in `mention.uids[]`

Key files: `voiceMention.ts`, `MessageInput/index.tsx`, mention parsing in `dmworkbase`

### CSS

Plain CSS files (no CSS Modules, no Tailwind). Styles co-located with components.

## Coding Conventions

- Commit messages: English, Conventional Commits (`feat:`, `fix:`, etc.)
- Branch types from AGENTS.config.json: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`
- Components: PascalCase directories, `index.tsx` entry
- ViewModels: `vm.ts` or `vm.tsx` in component directory
- Tests: `__tests__/` directory or `*.test.ts` co-located
- Imports: use workspace package names for cross-package imports:
  - `@octo/base`, `@octo/contacts`, `@octo/datasource`, `@octo/login`, `@octo/todo`
  - `@dmwork/summary`, `@dmwork/appbot`
- Type safety: avoid `any` — use proper types or `unknown` with type guards
- API calls: go through `WKApp.apiClient`, do NOT create separate axios/fetch instances
