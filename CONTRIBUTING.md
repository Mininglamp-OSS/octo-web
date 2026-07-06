# Contributing to OCTO

Thanks for your interest in contributing to OCTO! 🐙 We welcome contributions of all sizes.

## Getting Started

1. **Fork** the repo and create your branch from `main`.
2. **Install dependencies** — see the project's README for setup instructions.
3. **Make your changes** — follow existing code style.
4. **Add tests** — if you're fixing a bug or adding a feature, please add tests.
5. **Update docs** — if behavior changes, update the README/docs accordingly.
6. **Open a Pull Request** — fill in the PR template.

## Development Workflow

- All changes go through a Pull Request.
- PRs must pass CI before merging.
- PRs require at least one approving review from a maintainer.
- We use squash-merge to keep history clean.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add user presence API
fix: resolve message ordering race condition
docs: update README install steps
chore: bump dependency versions
```

## Pull Request Description

- Describe **what** you changed and **why**.
- Reference any related issues (e.g. `Fixes #123`).
- Include screenshots for UI changes.
- **Write PR descriptions in English** to keep the history accessible to the global community.

## Code Style

- **Go**: `gofmt` + `golangci-lint`
- **TypeScript/JavaScript**: Prettier + ESLint (config in repo)
- **Swift**: SwiftFormat
- **Kotlin**: ktlint / Android Studio default

## Reporting Bugs

Open a GitHub issue using the **Bug Report** template. Include:

- Expected vs actual behavior
- Steps to reproduce
- Environment (OS, version, etc.)
- Logs/screenshots if relevant

## Suggesting Features

Open a GitHub issue using the **Feature Request** template. Explain the
use case and why existing features don't solve it.

## License

By contributing, you agree that your contributions will be licensed under the
project's [Apache License 2.0](LICENSE).

## Questions?

- Open a [GitHub Discussion](https://github.com/orgs/Mininglamp-OSS/discussions)
- Read the [docs](https://docs.octo.chat) _(coming soon)_

Thanks for helping make OCTO better! 🚀
