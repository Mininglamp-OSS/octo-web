# Personal summary UI fixture

Run from the repository root:

```sh
pnpm exec vite --config apps/web/vite.personal-parity.config.ts
```

Open the printed local address. The host renders the actual summary workspace
against synthetic HTTP/SSE data, with no real login or external API requests.
It is a manual UI fixture, not real-model or deployment acceptance.

Use `?task=1` for a configured Agent summary, `?task=2` for missing configuration
and `?task=3` for a Workflow summary. Add `&lang=en-US` or `&theme=dark` to inspect
those variants. Reloading does not reset fixture data; restart Vite to reset it.

Check prompt prefill, missing-configuration fields, edit/history, full-generation
progress and streamed body. Scheduling and continue-optimize can be inspected
visually, but this fixture does not implement their backend execution.
