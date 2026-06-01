# Bot as First-Class + Runtimes Page Split (PoC4)

**Status:** Design (pending user review)
**Date:** 2026-06-01
**Touches:** octo-server / octo-daemon-cli / octo-matter (no changes) / octo-web

## Why

PoC1 introduced a two-step UX — user first creates an "openclaw agent
workspace", then attaches one or more bots to it. Review feedback: that's
leaky abstraction. Users in octo should reason about **bots** (the
identity they @ in a matter, the thing that has a name, owner, and
history). The fact that openclaw runtime happens to need an internal
"agent workspace" is implementation detail.

PoC4 collapses agent + bot into a single "bot" concept and pivots the
Runtimes page from "runtime-centric" to "runtime + bot" — two tabs, the
way multica does it.

## Out of scope (P+1 or later)

- non-openclaw runtimes actually running tasks (claude/codex/hermes) —
  UI lets you pick them but a "暂不支持" tag is shown and task dispatch
  returns "runtime not supported yet" error
- skills / instructions / env vars / custom params / model selection /
  concurrency on the bot detail page — these are P+1 features
- bot avatar upload — uses generated icon
- migrating existing PoC bot data — table rename drops old rows
  (all `created_by='poc'`, all test data, no production users)
- WS / SSE push of bot status — keep 3s polling
- bot detail page "Skills" tab actual functionality — render an empty
  state placeholder so the IA matches multica but PoC doesn't implement

## Concepts (after)

```
runtime (claude / codex / hermes / openclaw)
  └── host: detected on a daemon machine, has health + version
  └── bot: 0..N — only openclaw runtime can host bots in PoC

bot (1st-class)
  ├── runtime: which runtime hosts me (openclaw for PoC)
  ├── owner: real user uid
  ├── name: user-chosen
  ├── bot_uid: minted IM identity ({...}_bot)
  ├── workspace: openclaw agent_id (auto-derived from name, hidden from UI)
  ├── tasks: bot_task[] (1-N matter-driven task runs)
  └── activities: timeline mentions / dispatches
```

What disappears from the UI:
- "Add bot to existing agent" — gone, bots are atomic
- "Agent workspace" as a separate object — internal detail only
- managed_runtime_agent table → `bot` table (rename + simplify)

What's new in the UI:
- "智能体" tab on Runtimes page (sibling of "运行时" tab)
- Bot detail page with 4 sections (info / 动态 / Tasks / Skills-stub)
- Cross-machine bot listing (a bot belongs to a runtime, not a host)

## Architecture

### Backend changes (octo-server)

**SQL migration** (`runtime-20260602-01.sql`):
- `CREATE TABLE bot` with columns inherited from `managed_runtime_agent`
  minus the two-step `command_kind` field; PoC adds:
  - `runtime_kind VARCHAR(32)` — "openclaw" / "claude" / "codex" / "hermes"
    (denormalized from agent_runtime.provider, for filter/grouping)
  - `workspace_id VARCHAR(64)` — internal openclaw agent_id (was agent_id),
    `''` for non-openclaw runtimes
- `DROP TABLE managed_runtime_agent` — wipes PoC data, accepted loss
- `bot_task.agent_id` column kept as-is (it stores workspace_id, which is
  still what daemon needs to spawn `openclaw agent --agent X`)

**API changes** (`modules/runtime/`):
- `POST /v1/runtimes/bots` — create bot (replaces `managed-agents`)
  body: `{ runtime_id, name, runtime_kind }` — name is bot display name,
  runtime_kind validates the picked runtime; server derives workspace_id
  from name + random suffix
- `GET /v1/runtimes/bots` — list all bots in space, optionally filtered
  by runtime_kind / owner_uid / runtime_id
- `GET /v1/runtimes/bots/:id` — detail
- `DELETE /v1/runtimes/bots/:id` — soft-delete (status=archived)
- old `POST /v1/runtimes/managed-agents` + `POST /v1/runtimes/:runtime_id/agents/:agent_id/bots` — removed
- `POST /v1/runtimes/bots/:id/tasks` — list this bot's recent bot_task
  rows (for the "Tasks" tab on bot detail)
- heartbeat handler renames `pending_command` field to align: still
  dispatches the same openclaw side-effects (add workspace + mint bot +
  bind), but now it's a single combined command instead of two

**Daemon command shape change** (`internal/exec_openclaw.go`):
- new command `bot.provision` replaces the old `agent.create` + `bot.add`
  pair — daemon does in one call: `openclaw agents add <workspace> --
  workspace ~/.openclaw/...` + `openclaw config patch` (channels.octo
  account) + `openclaw agents bind --agent <workspace> --bind
  octo:<bot_uid>`
- old `agent.create` / `bot.add` action handlers removed
- non-openclaw runtime_kind: server doesn't queue any daemon command at
  all (bot row inserted with status=active immediately, runtime acts as
  "registered but inert")

**Non-openclaw bot create flow**:
- server validates runtime_kind ∈ {claude, codex, hermes, openclaw}
- if not openclaw: mint bot (botfather.MintBotOBO) + insert bot row
  status=active + no daemon dispatch
- bot_task dispatch handler: if target bot.runtime_kind != openclaw,
  immediately writes agent_task_failed activity with error="runtime
  not supported yet" — no daemon involvement

### Frontend changes (octo-web)

**Routing**:
- `/runtimes` — defaults to "运行时" tab (current page)
- `/runtimes?tab=bots` — "智能体" tab (new)
- `/runtimes/bots/:id` — bot detail page (new)

**RuntimesPage**:
- top-level tab bar: 「运行时」 / 「智能体」
- 「运行时」content: existing left list + RuntimeDetail, but **delete**
  the PoC1 managed-agent embedded card (the AgentsList component goes
  away from RuntimeDetail)
- 「智能体」content: new BotsTab component

**BotsTab** (new component):
- left: bot list (across all hosts + runtimes in current space)
  - filter chips: runtime_kind / owner (me / all) / status
  - "+ 新建智能体" button (top-right)
- right: bot detail panel (or empty state if none selected)

**Bot detail panel** (new component):
- header: avatar (generated icon) + name + status pill + runtime tag
- properties card: runtime / owner / workspace (small/grayed if openclaw)
  / created_at / updated_at
- tab bar: 动态 / Tasks / Skills (Skills shown as placeholder)
- 动态 tab: reuse FeedPanel — but the data source is different:
  - timeline = all bot's outgoing comments across all matters
  - activities = agent_dispatched/completed/failed events for this bot
  - new endpoint `GET /api/v1/internal/bots/:bot_uid/feed` on octo-matter
    (returns merged timeline+activities filtered by user_id=bot_uid OR
    actor_id=bot_uid, ordered desc by created_at, default limit 50);
    octo-server's bot detail handler proxies through it with the
    X-Internal-Token shared secret already used for the writeback
    endpoints — keeps web from needing to hit two services
- Tasks tab: table of bot_task rows for this bot, columns: created_at /
  matter_id (clickable) / status / elapsed_ms / result_summary (truncated)

**Create bot modal** (new component):
- field 1: runtime dropdown (4 options, non-openclaw show "暂不支持" tag,
  disabled in PoC)
- field 2: bot name (text input)
- field 3 (auto-computed, readonly): workspace_id preview ("openclaw
  workspace 名: claude-1a2b")
- submit: POST /v1/runtimes/bots, on success closes modal + refreshes
  bot list + auto-selects new bot

### Cross-service interactions

```
Web "create bot" → octo-server POST /v1/runtimes/bots
  ├── runtime_kind=openclaw:
  │     mint bot → insert bot(status=provisioning) → daemon heartbeat
  │     pulls bot.provision cmd → openclaw agents add + config patch +
  │     agents bind → ack → bot(status=active)
  └── runtime_kind=other:
        mint bot → insert bot(status=active) — no daemon, no openclaw

Web "bot detail / 动态 tab" → octo-server GET /v1/runtimes/bots/:id/feed
  → octo-server fans out to matter service: GET /api/v1/internal/bots/
    :bot_uid/feed (new matter internal endpoint, returns
    timelines+activities filtered by user_id=bot_uid OR actor_id=bot_uid)
  → web renders FeedPanel
```

Matter <-> server contract is unchanged for the dispatch direction (PoC2
mention dispatch still works). Only adds a new read endpoint on matter
to support bot's cross-matter feed.

## Migration

This is a hard cut on PoC data. Migration script:

```sql
-- runtime-20260602-01.sql
DROP TABLE IF EXISTS managed_runtime_agent;

CREATE TABLE bot (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  space_id VARCHAR(40) NOT NULL DEFAULT '',
  owner_uid VARCHAR(40) NOT NULL DEFAULT '',
  runtime_id BIGINT NOT NULL DEFAULT 0,
  runtime_kind VARCHAR(32) NOT NULL DEFAULT '',
  daemon_id VARCHAR(100) NOT NULL DEFAULT '',
  name VARCHAR(120) NOT NULL DEFAULT '',
  bot_uid VARCHAR(64) NOT NULL DEFAULT '',
  bot_token VARCHAR(120) NOT NULL DEFAULT '',
  workspace_id VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'provisioning',
  claim_token VARCHAR(64) NOT NULL DEFAULT '',
  error_msg text NOT NULL DEFAULT (''),
  created_by VARCHAR(32) NOT NULL DEFAULT 'poc',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_space (space_id, owner_uid),
  KEY idx_runtime (runtime_id, status),
  KEY idx_bot_uid (bot_uid)
);

-- bot_task table is NOT migrated — column agent_id still stores the
-- workspace_id, which is exactly what daemon needs. The semantic name
-- is wrong but renaming would force a downstream cascade. PoC accepts.
```

The bot.provision daemon command and `bot.runtime_kind != openclaw`
inert path together replace the old PoC1 `agent.create`/`bot.add`
two-step.

## Error handling

- Create bot with non-openclaw runtime in PoC: bot created (status=active
  immediately) but a `agent_task_failed` activity is recorded on the
  first dispatch attempt with `error="runtime <kind> not supported yet"`
- Daemon `bot.provision` failure: bot row stays `status=failed`,
  error_msg populated, Web UI shows red status pill
- Bot deleted while matter dispatch in flight: bot_task continues; ack
  succeeds but writeback to matter timeline may render with deleted bot
  uid (degraded UX, acceptable for PoC)

## Testing

- Backend unit tests: bot CRUD service, bot.provision command builder,
  non-openclaw inert path
- Daemon test: bot.provision composite command runs all three openclaw
  CLI calls in sequence + rolls back on partial failure (delete
  workspace if mint succeeded but bind failed)
- E2E smoke: create openclaw bot → see status=provisioning → wait for
  active → assign to matter @mention → bot replies
- E2E negative: create claude bot → status=active → @mention → see
  "runtime not supported yet" activity

## Open questions (none — all decisions confirmed)

—
