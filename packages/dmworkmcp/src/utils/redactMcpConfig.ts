/** Mask literal secret values in an mcp.json for read-only display.
 *
 * The unified backend has NO secret scanner (it was deliberately removed), and an
 * expert's `mcp_config` is rendered verbatim in its detail view to every viewer —
 * including on a `public` / `system` expert readable by any authenticated caller.
 * A hand-written literal credential in an `env` / `headers` value would therefore
 * be exposed. Blank each `env` / `headers` string value that is not already a
 * `${...}` placeholder, keeping the keys and structure so the viewer still sees
 * which variables the server needs. If nothing was masked the original string is
 * returned unchanged (so a placeholder-only config keeps its authored formatting).
 * This is a display-only guard; the owner's edit/copy flow reads the raw config.
 */
const PLACEHOLDER = /\$\{[^}]+\}/;
const MASK = "••••••";

export function redactMcpConfig(raw: string): string {
  if (!raw || !raw.trim()) return raw;
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    // Not JSON we can safely round-trip — leave as-is rather than mangle it.
    return raw;
  }
  const servers = (doc as { mcpServers?: unknown })?.mcpServers;
  if (!servers || typeof servers !== "object") return raw;
  let masked = false;
  for (const server of Object.values(servers as Record<string, unknown>)) {
    if (!server || typeof server !== "object") continue;
    for (const field of ["env", "headers"] as const) {
      const map = (server as Record<string, unknown>)[field];
      if (!map || typeof map !== "object") continue;
      for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
        if (typeof v === "string" && v !== "" && !PLACEHOLDER.test(v)) {
          (map as Record<string, unknown>)[k] = MASK;
          masked = true;
        }
      }
    }
  }
  if (!masked) return raw;
  try {
    return JSON.stringify(doc, null, 2);
  } catch {
    return raw;
  }
}
