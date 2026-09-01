import type { CreateMcpParams, UpdateMcpParams } from "../types/mcp";
import { slugifyServerName } from "../utils/constants";
import {
  SECRET_PLACEHOLDER,
  goCanonicalJSON,
  type PluginAttachmentWire,
  type PluginManifestWire,
  type PluginVisibilityWire,
} from "./pluginWire";

// The upsert body of the unified plugin API. The legacy flat MCP create body
// is reshaped into manifest_json (display document) + plugin_json (package of
// connector/* attachments, mirroring the backfill layout) so old and new rows
// share one shape.

interface PluginAttachmentBody {
  path: string;
  content_type: "raw";
  mime_type: string;
  raw_content: string;
}

/** The connector-package attachments this form fully models and rebuilds from
 *  the current form on every write. Any OTHER stored attachment is preserved
 *  verbatim (opts.extraAttachments): the upsert replaces plugin_json wholesale,
 *  so a path we neither model nor re-emit would be silently dropped on edit. */
const MODELED_ATTACHMENT_PATHS = new Set([
  "mcp.json",
  "connector/tools.json",
  "connector/examples.json",
  "connector/faqs.json",
  "connector/notes.json",
]);

/** Modeled server-object keys the form owns; everything else on the stored
 *  server (cwd, disabled, timeout, autoApprove, …) is seeded back from
 *  opts.rawServer so a metadata edit doesn't destroy it. */
const MODELED_SERVER_KEYS = ["type", "url", "command", "args", "env", "headers"];

export interface PluginUpsertBody {
  plugin: {
    plugin_id?: string;
    plugin_name: string;
    plugin_type: "connector";
    category_id?: string;
    tags: string[];
    icon: string;
    visibility: PluginVisibilityWire;
    manifest_json: PluginManifestWire;
    plugin_json: {
      $schema: string;
      connector: { type: "mcp"; source: string };
      attachments: (PluginAttachmentBody | PluginAttachmentWire)[];
    };
  };
  relations: [];
}

export interface PluginUpsertOptions {
  pluginId?: string;
  categoryId?: string;
  visibility: PluginVisibilityWire;
  /** The RAW stored modeled-server object, seeded into the write so keys this
   *  form doesn't model (cwd/disabled/timeout/autoApprove/…) survive an edit. */
  rawServer?: Record<string, unknown>;
  /** Other mcpServers entries, re-emitted verbatim so a multi-server document
   *  isn't collapsed to one on a metadata edit. */
  extraServers?: Record<string, unknown>;
  /** Stored attachments outside MODELED_ATTACHMENT_PATHS, re-emitted verbatim. */
  extraAttachments?: PluginAttachmentWire[];
}

export function toPluginUpsert(
  params: CreateMcpParams | UpdateMcpParams,
  opts: PluginUpsertOptions
): PluginUpsertBody {
  const name = params.name.trim();
  const slug = slugifyServerName(params.slug?.trim() ? params.slug : name);
  // Pre-normalize exactly like the backend (trim, drop empties, dedupe) so
  // manifest_json.labels matches the tags column invariant the server
  // enforces (tags == labels).
  const tags = [
    ...new Set((params.tags ?? []).map((t) => t.trim()).filter(Boolean)),
  ];
  const usage = (params.usageExamples ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const manifest: PluginManifestWire = {
    $schema: "cowork-plugin-manifest-2.0.json",
    plugin_name: name,
    plugin_type: "connector",
    name: slug || name,
    description: params.slogan ?? "",
    labels: tags,
    // Locale-neutral title: examples are persisted into manifest_json and read
    // back by every client of the unified API, so this must not bake in a locale.
    examples: usage.map((input, i) => ({ title: `Example ${i + 1}`, input })),
  };
  // Secret handling on the unified surface is a CLIENT-side control, not a
  // backend guarantee: the marketplace has no secret scanner (the heuristic one
  // was deliberately removed), so it stores whatever value it receives. This
  // client therefore never SENDS secret values — user-supplied env/header keys
  // are emitted as ${KEY} placeholders (filled locally at install time), and a
  // redaction sentinel echoed from a read is blanked before write.
  // Seed from the RAW stored modeled-server object so keys this form does not
  // model (cwd, disabled, timeout, autoApprove, …) survive a metadata edit; then
  // drop the modeled keys and overlay the form, so clearing a field (deleting
  // env/headers, clearing args) doesn't leave a stale seeded value behind.
  const server: Record<string, unknown> = { ...(opts.rawServer ?? {}) };
  for (const k of MODELED_SERVER_KEYS) delete server[k];
  if (params.transport) server.type = params.transport;
  if (params.url) server.url = params.url;
  if (params.command) server.command = params.command;
  if (params.args?.length) server.args = params.args;
  const env = placeholderSecretMap(params.env, params.envUserSupplied);
  if (env) server.env = env;
  const headers = placeholderSecretMap(
    params.headers,
    params.headersUserSupplied
  );
  if (headers) server.headers = headers;
  // Contract layout: the manifest lives only in manifest_json — no embedded
  // manifest.json attachment (the old byte-match rule is retired).
  // The mcpServers object MUST be keyed by the ASCII slug, not the display
  // name: a Chinese/spaced display name produces an invalid copy-paste config
  // key, and it must agree with manifest.name / connector.source (both slug).
  // mapDetail reads serverName back from this key, so a display-name key would
  // regress the detail snippet too.
  const serverKey = slug || name;
  // Re-emit any other stored servers verbatim (minus the one we're writing) so a
  // multi-server document isn't collapsed on a metadata edit.
  const mcpServers: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts.extraServers ?? {})) {
    if (k !== serverKey) mcpServers[k] = v;
  }
  mcpServers[serverKey] = server;
  const attachments: (PluginAttachmentBody | PluginAttachmentWire)[] = [
    rawAtt("mcp.json", goCanonicalJSON({ mcpServers })),
    rawAtt("connector/tools.json", goCanonicalJSON(params.tools ?? [])),
    rawAtt("connector/examples.json", goCanonicalJSON(usage)),
    rawAtt(
      "connector/faqs.json",
      goCanonicalJSON((params.faqs ?? []).filter((f) => f.question.trim()))
    ),
    rawAtt(
      "connector/notes.json",
      goCanonicalJSON((params.notes ?? []).map((s) => s.trim()).filter(Boolean))
    ),
  ];
  // Preserve any stored attachment this form doesn't model (guard against a
  // stale extra colliding with a modeled path — the modeled rebuild wins).
  for (const att of opts.extraAttachments ?? []) {
    if (!MODELED_ATTACHMENT_PATHS.has(att.path)) attachments.push(att);
  }
  return {
    plugin: {
      ...(opts.pluginId ? { plugin_id: opts.pluginId } : {}),
      plugin_name: name,
      plugin_type: "connector",
      ...(opts.categoryId ? { category_id: opts.categoryId } : {}),
      tags,
      icon: params.icon ?? "",
      visibility: opts.visibility,
      manifest_json: manifest,
      plugin_json: {
        $schema: "cowork-plugin-package-2.0.json",
        connector: { type: "mcp", source: `connector.${slug || name}` },
        attachments,
      },
    },
    relations: [],
  };
}

function rawAtt(path: string, content: string): PluginAttachmentBody {
  return {
    path,
    content_type: "raw",
    mime_type: "application/json",
    raw_content: content,
  };
}

/** Renders the ${KEY} install-time placeholder for one user-supplied key,
 *  mirroring the backend normalization (uppercase, non-alphanumerics -> _). */
export function placeholderFor(key: string): string {
  const normalized = key
    .trim()
    .replace(/[^A-Za-z0-9]/g, "_")
    .toUpperCase();
  return "${" + (normalized || "VALUE") + "}";
}

/** Build the persisted env/header map from the form values and the
 *  user-supplied key set. Exported so the secret round-trip contract can be
 *  pinned in unit tests. */
export function placeholderSecretMap(
  map: Record<string, string> | undefined,
  userSupplied: string[] | undefined
): Record<string, string> | undefined {
  const supplied = new Set(userSupplied ?? []);
  if ((!map || !Object.keys(map).length) && !supplied.size) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map ?? {})) {
    // A user-supplied key regenerates its self-referential ${KEY} placeholder;
    // every other value — including a cross-referential ${SHARED_TOKEN} that
    // splitUserSupplied preserved verbatim — passes through unchanged, so no
    // install-time variable is renamed on round-trip.
    out[key] = supplied.has(key)
      ? placeholderFor(key)
      : value === SECRET_PLACEHOLDER
        ? ""
        : value;
  }
  for (const key of supplied) {
    if (!(key in out)) out[key] = placeholderFor(key);
  }
  return Object.keys(out).length ? out : undefined;
}
