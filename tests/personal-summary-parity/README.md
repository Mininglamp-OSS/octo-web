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

Use `?view=schedules` to inspect the legacy schedule list (also with
`&lang=en-US`). It offers edit, pause, resume, and confirmed deletion for recovery,
but no standalone create control. Mutation behavior is covered
by the schedule-list unit tests, not this read-only HTTP fixture.
Task 1's detail still opens the scheduling dialog without source controls;
task 2 must refuse scheduling rather than offering a chat picker.
