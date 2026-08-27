import type { CreateMcpParams, UpdateMcpParams } from "../types/mcp";
import { slugifyServerName } from "../utils/constants";
import {
  SECRET_PLACEHOLDER,
  goCanonicalJSON,
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
      attachments: PluginAttachmentBody[];
    };
  };
  relations: [];
}

export interface PluginUpsertOptions {
  pluginId?: string;
  categoryId?: string;
  visibility: PluginVisibilityWire;
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
    $schema: "cowork-plugin-manifest-1.0.json",
    plugin_name: name,
    plugin_type: "connector",
    name: slug || name,
    description: params.slogan ?? "",
    labels: tags,
    // Locale-neutral title: examples are persisted into manifest_json and read
    // back by every client of the unified API, so this must not bake in a locale.
    examples: usage.map((input, i) => ({ title: `Example ${i + 1}`, input })),
  };
  // The unified marketplace never persists secret VALUES. mcp.json is the
  // standard {"mcpServers": {...}} document: user-supplied env/header keys
  // carry ${KEY} placeholders (filled locally at install time), and any
  // redaction sentinel echoed from a read is blanked.
  const server: Record<string, unknown> = {};
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
  const attachments: PluginAttachmentBody[] = [
    rawAtt("mcp.json", goCanonicalJSON({ mcpServers: { [serverKey]: server } })),
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
        $schema: "cowork-plugin-package-1.0.json",
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
