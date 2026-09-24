# Space unread

Web-only in-memory state for organization-level unread badges.

- `totalBySpace` is calibrated by the authoritative `conversation/sync` sideband;
  a Space changed during the request keeps its newer local value while unrelated
  Spaces still accept the snapshot.
- `newBySpace` counts eligible cross-Space messages since the switcher last closed.
- Muted conversations and messages without `reddot` are excluded.
- Unknown mute metadata is skipped without a hot-path request and later reconciled
  by the authoritative total snapshot.
- The store has no persistence and does not change desktop notification behavior.
