# @octo/chat-core

Framework-free chat client core. No React, no `wukongimjssdk` dependency.

Exports:

- `ChatChannelRef`, `chatChannelKey`
- `ChatClientStatus`, `ChatClientBootstrap`, `ChatClientEvent`
- `ChatConversationHandle` (opaque adapter contract)
- `ChatConversationLease` (consumer-facing idempotent `release()`)
- `ChatClient` (start/stop/openConversation/getSnapshot/subscribe + `messages` port)
- `ManagedChatClient`, `ChatConnectionContext`, `ManagedChatClientOptions`
- Adapter interfaces: `ChatConnectionAdapter`, `ChatConversationAdapter`,
  `ChatSubscribeAdapter`, `ChatMessageAdapter`
- Generic message port: `ChatMessagePort<TMessage, TContent, TStatus>`,
  `ChatMessageLoadOptions`

## Bootstrap

`ChatClientBootstrap` is connection-level and does not require a channel.
The optional `initialChannel` is bootstrap metadata for adapters or hosts;
conversation ownership is still acquired explicitly with `openConversation`.

```ts
client.start({ endpoint: "wss://...", token: "abc", space: "spc_123" });
client.start({
  session: "sess_1",
  initialChannel: { channelId: "gid", channelType: 2 },
});
```

## Design

`ManagedChatClient` wires the adapters together and owns cross-cutting
lifecycle concerns:

- `start` / `stop` are idempotent.
- The connection adapter receives a `ChatConnectionContext` so it can report
  involuntary drops and restores.
- A single active conversation lease is owned at a time. Switching releases
  the previous lease before subscribing the replacement. Concurrent opens use
  latest-request-wins semantics until the commit phase begins; once teardown
  starts, that operation completes before a later open or stop is processed.
- Connection, conversation and lease teardown operations are serialized, so
  `stop()` is a complete teardown barrier before a later restart.
- Each `connect` call receives an epoch-scoped `ChatConnectionContext`; delayed
  callbacks from an older transport cannot overwrite the current status.
- Adapter failures surface through the `failed` status and the returned
  promise.
- The `messages` port delegates to an optional `ChatMessageAdapter`; a
  clear error is thrown if no adapter is configured.
