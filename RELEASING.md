# Releasing

This repository follows the **org-wide OCTO release process**. The authoritative
design, rationale, and shared automation live in
[`Mininglamp-OSS/.github`](https://github.com/Mininglamp-OSS/.github) — this page
is only the per-repo pointer, so it links rather than duplicates.

## SemVer

Releases are immutable [Semantic Versioning](https://semver.org) tags
`vMAJOR.MINOR.PATCH` (e.g. `v1.5.0`):

- **MAJOR** — breaking changes
- **MINOR** — backward-compatible features
- **PATCH** — backward-compatible fixes

Pre-releases use a suffix (e.g. `v1.2.0-rc.1`) and are not marked **Latest**.
Tags matching `v*` are protected; org maintainers push them.

## Changelog (automated)

Changelogs are drafted automatically by **release-drafter**
(`.github/workflows/release-drafter.yml`, which calls the org
[`reusable-release-drafter`](https://github.com/Mininglamp-OSS/.github/blob/main/.github/workflows/reusable-release-drafter.yml)).
PRs are squash-merged, so **release notes are generated from PR titles** — keep
titles in [Conventional Commits](https://www.conventionalcommits.org) form
(`feat:`, `fix:`, `docs:` …). A running draft Release is refreshed on every merge
to `main`; you don't write the changelog by hand.

## Cutting a release

1. **Choose the commit** on `main` and confirm its **CI run is green**. That run is
   the release evidence — copy its **run ID** from the Actions tab URL
   (`…/actions/runs/<RUN_ID>`).
2. **Push the tag** on that exact commit:
   ```
   git tag -a v1.5.0 -m "Release v1.5.0" <sha>
   git push origin v1.5.0
   ```
3. **Publish** via the **Release Publish** workflow
   (`.github/workflows/release-publish.yml` → Actions → *Run workflow*), passing
   the tag and the successful CI **run ID**. It calls the org
   [`reusable-release-publish`](https://github.com/Mininglamp-OSS/.github/blob/main/.github/workflows/reusable-release-publish.yml),
   which re-verifies the CI run **succeeded on the tagged commit** before
   promoting the drafted GitHub Release. Pass `draft: true` to stage without
   publishing.

## Org references

- [Workflow architecture — Plane 3: Supply chain / release](https://github.com/Mininglamp-OSS/.github/blob/main/docs/workflow-architecture.md)
- [CI/CD state snapshot](https://github.com/Mininglamp-OSS/.github/blob/main/docs/cicd-state-snapshot.md)
- [`reusable-release-drafter`](https://github.com/Mininglamp-OSS/.github/blob/main/.github/workflows/reusable-release-drafter.yml) · [`reusable-release-publish`](https://github.com/Mininglamp-OSS/.github/blob/main/.github/workflows/reusable-release-publish.yml)
