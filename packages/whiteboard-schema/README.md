# @octo/whiteboard-schema (vendored)

Frozen shared whiteboard schema package defined by the XIN-16 single-authority
contract (§3): the top-level Y.Doc field names, `WB_SCHEMA_VERSION`, the element
`type` whitelist, and the shared `normalizeElement` rule set + CAS arbitration
(`elementSupersedes`) + whiteboard key codec.

## Provenance

Vendored **verbatim** from the canonical frozen repo
`boris-clark/octo-whiteboard-schema` @ **v0.2.0** (`WB_SCHEMA_VERSION = 2`). The
only change from canonical is the internal import-specifier extension
(`./x.js` → `./x.ts`) to match this repo's bundler/`tsc` resolution; the
constants, types and rule logic are byte-identical.

The **same source** is shared by all three consumers so none hard-codes field
names or rules:

1. **FE Excalidraw binding (XIN-25)** — local, render-time defensive
   `normalizeElement` (this package, consumed by `@octo/docs` board collab).
2. **BE authoritative repair** (`octo-docs-backend` `src/whiteboard/repair.ts`).
3. **BE Agent conversion path** (Element ↔ Y.Map).

The only difference between FE and BE is **who writes the normalized result
back**: the backend repair is the single authoritative writer (§4); the FE only
normalizes for local render and never writes the repaired result to the Y.Doc.

## Schema version history

- **v1** (`WB_SCHEMA_VERSION = 1`) — baseline: id/type validation,
  `version`/`versionNonce`, numeric clamps, fractional-index strip, dangling
  `boundElements` + `frameId` pruning.
- **v2** (`WB_SCHEMA_VERSION = 2`, M-5) — clears a dangling `containerId` (a bound
  text whose container element was deleted → `containerId: null`), the same shape
  as the v1 `frameId` rule. No new element type; unknown-field passthrough
  unchanged. Released to FE and BE together (freeze policy below).

## Freeze policy (§3.2)

Changing the element layout or the `normalizeElement` rule set **requires bumping
`WB_SCHEMA_VERSION`**, released to FE and BE together. This vendored copy MUST
stay in lockstep with the canonical package — bump together, never edit one side
only. When a shared registry/publish home is ratified, replace this vendored copy
with the published dependency.
