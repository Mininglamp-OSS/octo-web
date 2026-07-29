# Excalidraw package patch

`@excalidraw/excalidraw@0.18.1.patch` patches the published npm package consumed by
`packages/docs`. It is an artifact-level pnpm patch, not output reproduced from a maintained
Excalidraw source fork.

## Provenance

- Package: `@excalidraw/excalidraw@0.18.1`
- Registry tarball SHA-1: `fd6ad752807c814698c5f51dab778845b7e4bba7`
- Registry tarball SHA-256: `b280d4b364b65cba264c5aa4e7435cc2ce6421eabbbef9765a56997a0fadf534`
- Registry integrity: `sha512-6i5Gt7IDTOH//qa0Z315Ly5iVRhjWpu2whrlQFqkuwrkKUWgRsMk0P5qdE7bpyDpai7jeLeWYkyj1eVAfni1lw==`
- Patch SHA-256: `da6bafe9db3b9f97183d5ca70d2848b65faf49d95ad7c5418ea807d65175708c`

The readable development bundles were edited at artifact level. The replacement production chunk
and entry file came from an unrecorded build or transformation whose source checkout and command are
not available; their broad `const`/`let` and symbol changes cannot honestly be described as hand-edit
churn on the same minified output. Review behavior through the readable development-bundle hunks and
the installed dev/prod contract tests. Reproducibility is byte-level only: the verifier pins the npm
tarball, patch, and all ten patched outputs, not a source build.

The upstream source maps remain the maps shipped in the npm package. They are useful for locating
upstream modules, but they do not describe the Octo additions and must not be treated as generated
provenance.

## Behavior carried by the patch

- Octo font IDs and font-picker entries.
- UTF-16 `customData.textRuns`, rich-text layout, Canvas/SVG rendering, WYSIWYG selection,
  composition, caret, and resize behavior.
- Native triangle, inverted-triangle, and parallelogram shapes plus package exports.
- Octo shape/line flyouts and canvas-colour toolbar trigger.
- Property-panel and portalled-picker outside-click handling.
- Board-specific help/shortcut labels.

## Replaying and verifying

From the repository root:

```sh
node scripts/verify-excalidraw-patch.mjs
pnpm install --frozen-lockfile
pnpm --dir packages/docs exec vitest run \
  src/board/excalidrawToolbarPatch.contract.test.ts \
  src/board/excalidrawLocales.contract.test.ts \
  src/board/octoNativeShapes.contract.test.ts
```

The verification script downloads the exact npm package, verifies the tarball and patch hashes,
applies the patch to a temporary pristine tree, and checks every patched output byte-for-byte. It
fails if the registry input, patch, anchors, or generated files drift.

## Maintenance rule

Do not hand-edit only one installed dev/prod bundle. Start from the pinned pristine npm tarball,
update both modes, regenerate the pnpm patch, update the expected hashes in the verification script,
and run all installed-bundle contract tests. A future Excalidraw version should replace this
artifact-level process with a pinned source fork or source overlay before adding more bundle edits.
