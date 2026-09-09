# Docs Voice Host Compatibility

## Behavior List

- Keep native input/textarea voice capture, selection replacement, configured shortcuts,
  settings gating and offline behavior unchanged.
- Allow rich-text hosts to omit `inputRef` and insert transcription via the existing callback.
- Ref-less shortcut activation requires an explicit `isHotkeyActive` callback. An unfocused
  rich-text editor, or one without that callback, must not capture global shortcuts.
- A supplied ref whose element is still null remains unavailable.
- No new menu, route, backend interface, permission or navigation behavior.

## File Map

- `packages/dmworkbase/src/Components/VoiceInputButton/index.tsx`: optional rich-text
  host contract, availability and shortcut focus.
- `packages/dmworkbase/src/Components/VoiceInputButton/useTextareaVoice.ts`: preserve
  native selection handling and support callback-only insertion.
- Tests in the same directory: native regressions, ref-less rendering and voice delivery.
- `apps/web/vite.config.ts`: deduplicate `@octo/base` so externally sourced enterprise
  modules share the host's login, module registry and public components.
- The Docs artifact build selects this worktree explicitly; it must not silently use
  an unrelated checkout or claim a dirty local artifact is a fixed release.

## PR Scope

This is a backward-compatible shared voice-input correction. Docs' existing
`MentionComposer` already omits `inputRef` and supplies `isHotkeyActive`; its local type
shim and component mock accepted that contract, but the current real base crashed on
`inputRef.current`. Normal HTML document loading reproduced this in the production
artifact, while terminal error-page smoke tests did not.

No Docs implementation is copied into OSS Web. No visual redesign, general SDK
extraction or backend change is included. The primary Web checkout stays unchanged.
An external Docs worktree resolves its own linked base without Vite deduplication;
that can load a second base singleton and bypass the host compatibility correction.
Keep one base instance for the shell and its enterprise modules.

## Verification Plan

- Run the existing and added `VoiceInputButton` / `useTextareaVoice` tests.
- Exercise both real component and real hook, replacing only the lower voice-service
  boundary where possible; a mocked hook alone does not prove ref-less capture works.
- Rebuild the Docs artifact against this checkout, then run the Client Electron
  successful-document test with network fixtures and the original error-page smoke test.
- Rebuild Web with its existing enterprise Docs entry. Run shared voice/composer
  regressions; a successful build does not prove logged-in Web visual or audio behavior.
- Record real microphone, live backend and manual Web checks separately from fixtures.
