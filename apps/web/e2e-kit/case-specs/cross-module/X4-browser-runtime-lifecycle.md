# X4 Browser Runtime Lifecycle

## Scope

Exercise the ordinary Web entry after extracting conversation ownership from
ChatVM. Use the existing authenticated MSW/IM fixture, without an Electron
bridge or desktop runtime bootstrap. Assert user-visible state only.

## Cases

1. While Contacts is active, synchronize one unread conversation. Its title
   prefix survives three Chat/Contacts transitions and a reload. Synchronizing
   a read state while outside Chat clears the prefix.
2. Contacts/Summary navigation followed by browser Back and Forward restores
   the matching page and unread title.
3. Two tabs share the same account and space. Clear unread via the second
   tab's conversation menu; the first tab updates its title without leaving
   Contacts. Returning to Chat does not restore the old unread state.

## Verification

Run the spec against the ordinary `build:e2e` output with the existing
`playwright.ci.config.ts`, one worker and `--repeat-each=3`.
The fixture does not establish real IM connections or prove native background
notification delivery. Those remain separate desktop acceptance gates.
