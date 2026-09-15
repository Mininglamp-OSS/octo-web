# Forwarding Presentation

`WKBase.showConversationSelect` remains the sole compatibility entry. It still owns
completion, document grants and sends. `ConversationSelect` still owns all candidate,
search, selection and Bot hooks.

Ordinary Web renders the existing modal. The desktop communication entry may install
a `ForwardSurfacePort` before UI mount. Only then does the picker render headlessly
and publish a serializable UI model to Client's independent overlay.

`surfaceSession` accepts allowlisted UI commands against current authoritative
callbacks and candidate identities. Confirmation requires the latest revision and
a committed selection render. Closing or publishing failure cancels the owner.
There is no second IM connection, message payload construction, or credential
transfer in the standalone renderer.

Keep `surfaceContract.ts` in sync with Client's
`shared/forward-surface-contract.ts`. New wire behavior requires capability/version
review in both repositories.
