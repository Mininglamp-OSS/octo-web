import React, { useEffect, useMemo, useRef, useState } from "react";
import { WKModal, WKInput, WKButton, t } from "@octo/base";
import { Select, Switch, TextArea, Toast } from "@douyinfe/semi-ui";
import {
  createMcp,
  probeMcpTools,
  isProbeAvailable,
  updateMcp,
  uploadMcpIcon,
} from "../api/mcpService";
import { MCP_CATEGORY_LABELS, MCP_CATEGORY_ORDER } from "../mock/mcpMock";
import {
  SECRET_PLACEHOLDER_SENTINEL,
  isSecretKey,
  slugifyServerName,
} from "../utils/constants";
import { parseImportJSON } from "../utils/importJson";
import {
  MAX_MCP_TAGS,
  validateMcpTag,
  validateMcpTags,
} from "../utils/mcpTagValidation";
import type {
  CreateMcpParams,
  McpDetail,
  McpFaq,
  McpProbeRequest,
  McpTransport,
  McpVisibility,
} from "../types/mcp";
import { isImageIcon } from "../utils/icon";

interface McpCreateModalProps {
  visible: boolean;
  onClose: () => void;
  /** Fires on both create and edit success. For an edit save, `updated` is
   *  the fresh detail from the server so the parent can patch the list in
   *  place (avoids scroll-reset from a full refetch). Create passes no arg
   *  because the new row's list position depends on the current sort/filter
   *  and is easiest to surface via a full reload. */
  onSaved: (updated?: McpDetail) => void;
  /** When set, the modal becomes an EDIT modal: prefilled from `editing`,
   *  submits via updateMcp(id), and uses the edit title/label copy. Absent =
   *  create mode (original behavior). */
  editing?: McpDetail | null;
}

const ICON_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Per-field max input lengths. Kept in sync with the backend column limits so
 * the client blocks over-long input before it ever reaches the wire (the
 * `maxLength` attribute hard-caps the field; a hint tells the user why).
 */
const MAXLEN = {
  name: 64,
  slogan: 200,
  url: 2048,
  command: 256,
  arg: 512,
  headerKey: 128,
  headerValue: 1024,
  toolName: 64,
  text: 500, // tool description / FAQ question+answer / note
} as const;

// Probe returns tool metadata from a live MCP server; some servers ship
// multi-paragraph descriptions that exceed the backend's 500-char cap and
// would make submit fail with `tools.description must be at most 500
// characters`. Clamp on ingest so the form value already satisfies the
// contract; the trailing `…` cues the user that the text was cut so they can
// rewrite it in the tool list before saving. `description` is typed string
// per McpTool but the MCP spec makes it optional — a live probe may return
// `{name: "x"}` with no description; guard against undefined so the probe
// doesn't degrade to a misleading "probe failed" toast on tools that
// legitimately ship without one.
function clampToolDescription(desc: string | undefined | null): string {
  if (!desc) return "";
  if (desc.length <= MAXLEN.text) return desc;
  return desc.slice(0, MAXLEN.text - 1) + "…";
}

const EMPTY: CreateMcpParams = {
  name: "",
  slug: "",
  category: "dev",
  icon: "",
  tags: [],
  slogan: "",
  transport: "streamable-http",
  url: "",
  command: "",
  args: [],
  env: {},
  headers: {},
  tools: [],
  usageExamples: [],
  faqs: [],
  notes: [],
  visibility: "public",
};

const TRANSPORT_OPTIONS: McpTransport[] = ["stdio", "streamable-http", "sse"];

/** One row in the structured Headers / Env editor. Replaces the earlier free-
 *  text `KEY: value` textarea buffer so each row can carry a per-key toggle
 *  for the wire's `headers_user_supplied` / `env_user_supplied` arrays.
 *  `userSupplied=true` flags the key as "consumer supplies their own value";
 *  the value itself IS persisted (§5.1 relaxation) so the owner sees it on
 *  their own edit, but non-owner reads are blanked server-side (§5.3) and
 *  the market snippet substitutes the placeholder client-side. */
interface KvEntry {
  key: string;
  value: string;
  userSupplied: boolean;
}

/** Rebuild the structured entries list from a wire map + user-supplied array.
 *  Legacy records (pre-§5.1 relaxation) may still carry the sentinel literal
 *  under user-supplied keys; we drop it to "" so the input renders blank
 *  rather than showing "__OCTO_SECRET_..." Preserves insertion order so an
 *  edit reload shows keys in the same order they were saved. */
function entriesFromWire(
  values: Record<string, string> | undefined,
  userSupplied: string[] | undefined
): KvEntry[] {
  if (!values) return [];
  const supplied = new Set(userSupplied ?? []);
  return Object.entries(values).map(([key, raw]) => {
    const isSupplied = supplied.has(key);
    const value = raw === SECRET_PLACEHOLDER_SENTINEL ? "" : raw;
    return { key, value, userSupplied: isSupplied };
  });
}

/** Collapse the structured editor into wire shape:
 *  - values map keeps `key → value` verbatim; the value is preserved even for
 *    user-supplied keys so the owner sees it again on their own edit (§5.1
 *    rule 1 relaxation). Non-owner reads are blanked server-side (§5.3).
 *  - userSupplied[] is the list of keys whose value is a "consumer supplies
 *    their own" placeholder in the marketplace snippet — the mask happens
 *    client-side via applyUserSuppliedPlaceholder, not by nulling the value
 *    here.
 *  Rows with an empty key are dropped so a stray "add" click doesn't emit
 *  `{"": ""}` and confuse validation. */
function entriesToWire(entries: KvEntry[]): {
  values: Record<string, string>;
  userSupplied: string[];
} {
  const values: Record<string, string> = {};
  // Track user-supplied membership in a Set — two rows carrying the same
  // key (both toggled ON) would otherwise emit `["Authorization",
  // "Authorization"]` on the wire. `values[k]` already collapses to last
  // write; the array needs an explicit dedup so a backend uniqueItems
  // check (or any downstream consumer expecting a set) doesn't blow up
  // on the second entry.
  const suppliedSet = new Set<string>();
  for (const e of entries) {
    const k = e.key.trim();
    if (!k) continue;
    values[k] = e.value;
    if (e.userSupplied) suppliedSet.add(k);
  }
  return { values, userSupplied: [...suppliedSet] };
}

function isRemote(transport: McpTransport): boolean {
  return transport === "streamable-http" || transport === "sse";
}

/** Convert a detail record to the flat create/update form shape. Preserves
 *  everything the wire carries; the KV entries (env / headers) are rebuilt
 *  from the wire pair (values map + user_supplied array) via entriesFromWire.
 *  The entries themselves are kept in a separate state slice — this function
 *  just fills the flat `form` shape (values + userSupplied arrays). */
function detailToForm(detail: McpDetail): CreateMcpParams {
  const qs = detail.quickStart;
  return {
    name: detail.name,
    slug: qs.slug ?? "",
    category: detail.category,
    icon: detail.icon,
    tags: detail.tags ?? [],
    slogan: detail.slogan,
    transport: qs.transport,
    url: qs.url ?? "",
    command: qs.command ?? "",
    args: qs.args ?? [],
    env: qs.env,
    envUserSupplied: qs.envUserSupplied,
    headers: qs.headers,
    headersUserSupplied: qs.headersUserSupplied,
    tools: detail.tools,
    usageExamples: detail.usageExamples,
    faqs: detail.faqs,
    notes: detail.notes,
    visibility: detail.visibility ?? "public",
  };
}

// ─── Small presentational helpers kept inline (single-use, tiny) ────────────

function Section({
  title,
  desc,
  action,
  full,
  children,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        full
          ? "wk-mcp-form-section wk-mcp-form-section--full"
          : "wk-mcp-form-section"
      }
    >
      <div className="wk-mcp-form-section__head">
        <div className="wk-mcp-form-section__heading">
          <div className="wk-mcp-form-section__title">{title}</div>
          {desc && <div className="wk-mcp-form-section__desc">{desc}</div>}
        </div>
        {action && <div>{action}</div>}
      </div>
      <div className="wk-mcp-form-section__body">{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="wk-mcp-field">
      {label && (
        <label
          className={
            required
              ? "wk-mcp-field__label wk-mcp-field__label--req"
              : "wk-mcp-field__label"
          }
        >
          {label}
        </label>
      )}
      {children}
      {hint && <div className="wk-mcp-field__hint">{hint}</div>}
    </div>
  );
}

/** Structured Headers / Env editor. One row per key with a per-key toggle
 *  that flags "the value must be filled locally by each consumer" — the
 *  form's submit path converts that flag into the wire's
 *  `headers_user_supplied` / `env_user_supplied` arrays. */
function KvEditor({
  entries,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  toggleLabel,
  removeLabel,
}: {
  entries: KvEntry[];
  onChange: (next: KvEntry[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  toggleLabel: string;
  removeLabel: string;
}) {
  const update = (idx: number, patch: Partial<KvEntry>) => {
    onChange(
      entries.map((e, i) => (i === idx ? { ...e, ...patch } : e))
    );
  };
  // Smart-default the "consumer fills locally" toggle to ON when the
  // operator types a secret-shape key (Authorization / *_token /
  // *_secret / ...). Only fires while the row is still fresh — the
  // toggle is untouched (false) AND the value is empty. Once the
  // operator flips the toggle or types a value we treat the row as
  // "explicit" and never auto-adjust again. Guards against pasting a
  // Bearer token under an Authorization key and publishing it verbatim.
  const setKey = (idx: number, k: string) => {
    const row = entries[idx];
    const shouldAutoToggle =
      !row.userSupplied && !row.value && isSecretKey(k);
    update(idx, {
      key: k,
      ...(shouldAutoToggle ? { userSupplied: true } : {}),
    });
  };
  const remove = (idx: number) =>
    onChange(entries.filter((_, i) => i !== idx));
  const add = () =>
    onChange([...entries, { key: "", value: "", userSupplied: false }]);

  return (
    <div className="wk-mcp-kv">
      {entries.length > 0 && (
        <div className="wk-mcp-kv__rows">
          {entries.map((e, idx) => (
            <div className="wk-mcp-kv__row" key={idx}>
              <WKInput
                className="wk-mcp-kv__key"
                value={e.key}
                onChange={(v) => setKey(idx, v)}
                placeholder={keyPlaceholder}
                maxLength={128}
              />
              <WKInput
                className="wk-mcp-kv__value"
                value={e.value}
                onChange={(v) => update(idx, { value: v })}
                placeholder={valuePlaceholder}
                maxLength={1024}
              />
              <label className="wk-mcp-kv__toggle">
                <Switch
                  checked={e.userSupplied}
                  onChange={(checked) =>
                    update(idx, { userSupplied: checked })
                  }
                />
                <span className="wk-mcp-kv__toggle-label">{toggleLabel}</span>
              </label>
              <WKButton
                size="sm"
                variant="ghost"
                onClick={() => remove(idx)}
                aria-label={removeLabel}
              >
                −
              </WKButton>
            </div>
          ))}
        </div>
      )}
      <WKButton
        size="sm"
        variant="secondary"
        className="wk-mcp-kv__add"
        onClick={add}
      >
        + {addLabel}
      </WKButton>
    </div>
  );
}

function Segments<T extends string>({
  value,
  options,
  onChange,
  full,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  full?: boolean;
}) {
  return (
    <div
      className={
        full ? "wk-mcp-segments wk-mcp-segments--full" : "wk-mcp-segments"
      }
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={
            opt.value === value
              ? "wk-mcp-segments__item wk-mcp-segments__item--active"
              : "wk-mcp-segments__item"
          }
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Chip-based tag input — Enter/comma add, Backspace on empty removes last.
 *  Also enforces MAX_MCP_TAGS + per-tag length/charset (mirrors dmworkskillmarket
 *  after PR #1026). Invalid tags are rejected inline with a Toast so the user
 *  gets immediate feedback; the outer submit path re-validates as a defense
 *  against legacy oversized rows loaded into the edit form. */
function TagsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commitOne = (raw: string, existing: string[]): string[] | null => {
    const trimmed = raw.trim().replace(/,+$/, "");
    if (!trimmed) return null;
    if (existing.includes(trimmed)) return null;
    if (existing.length >= MAX_MCP_TAGS) {
      Toast.warning(t("mcp.form.tagLimit", { values: { count: MAX_MCP_TAGS } }));
      return null;
    }
    const tagError = validateMcpTag(trimmed);
    if (tagError) {
      Toast.warning(tagError);
      return null;
    }
    return [...existing, trimmed];
  };

  /** Accepts either a single tag or a comma-separated batch (from paste).
   *  Splits on commas, validates each segment, and drops the whole batch's
   *  draft only after processing so a mid-batch validation error still
   *  clears the input (matches the keyboard-comma UX). */
  const commit = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) {
      setDraft("");
      return;
    }
    let next = value;
    for (const part of parts) {
      const result = commitOne(part, next);
      if (result === null) {
        // Batch aborted on the first invalid segment; keep whatever we already
        // appended (parity with per-keystroke behavior).
        break;
      }
      next = result;
    }
    if (next !== value) onChange(next);
    setDraft("");
  };

  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div className="wk-mcp-tags" onClick={() => inputRef.current?.focus()}>
      {value.map((tag, i) => (
        <span className="wk-mcp-tags__chip" key={`${tag}-${i}`}>
          <span className="wk-mcp-tags__chip-text" title={tag}>{tag}</span>
          <button
            type="button"
            className="wk-mcp-tags__chip-remove"
            onClick={(e) => {
              e.stopPropagation();
              remove(i);
            }}
            aria-label="remove"
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="wk-mcp-tags__input"
        value={draft}
        placeholder={value.length === 0 ? placeholder : ""}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && value.length > 0) {
            remove(value.length - 1);
          }
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}

/**
 * Create-MCP modal. Fields map 1:1 onto the detail page's display fields so
 * a freshly-created MCP renders end-to-end without blanks.
 *
 * Layout: single-column card-per-section — same rhythm as SpaceCreate but
 * scales to a long form. Advanced connection params (env / headers) collapse
 * behind a toggle so the default view stays short.
 */
const McpCreateModal: React.FC<McpCreateModalProps> = ({
  visible,
  onClose,
  onSaved,
  editing,
}) => {
  const [form, setForm] = useState<CreateMcpParams>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Text buffer for the free-text args field; env / headers use structured
  // rows below.
  const [argsRaw, setArgsRaw] = useState("");
  // Structured Headers / Env editors — one row per key, with a per-key
  // "needs user config" toggle. The submit path converts these back into the
  // wire pair (values map + user_supplied array) via entriesToWire; the edit
  // path rehydrates via entriesFromWire.
  const [envEntries, setEnvEntries] = useState<KvEntry[]>([]);
  const [headersEntries, setHeadersEntries] = useState<KvEntry[]>([]);

  // Icon: the selected File is held locally for an object-URL preview and only
  // uploaded to object storage on submit (POST /mcps/{id}/icon, needs the id).
  // `form.icon` keeps the persisted storage URL (or a legacy base64 icon on
  // edit) so the create → detail round-trip renders without a blank.
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState("");

  // Once the user hand-edits the slug we stop auto-deriving it from the name.
  const [slugTouched, setSlugTouched] = useState(false);

  // Create-mode toggle (issue #867): manual = existing wizard, json = paste an
  // mcpServers / server.json snippet to seed the form. Edit mode always stays
  // in manual — JSON import is a create-time seeding aid, not an edit affordance.
  const [createMode, setCreateMode] = useState<"manual" | "json">("manual");
  const [jsonRaw, setJsonRaw] = useState("");

  const iconInputRef = useRef<HTMLInputElement>(null);

  const isEdit = !!editing;

  // Prefill on open. When `editing` is set, hydrate the form from the detail;
  // otherwise reset to EMPTY so re-opening always starts fresh. Also drives
  // the "back to step 0 on every open" behavior so a partial previous session
  // doesn't leak into the next one.
  useEffect(() => {
    if (!visible) return;
    if (editing) {
      const seed = detailToForm(editing);
      setForm(seed);
      setArgsRaw((seed.args ?? []).join("\n"));
      setEnvEntries(entriesFromWire(seed.env, seed.envUserSupplied));
      setHeadersEntries(
        entriesFromWire(seed.headers, seed.headersUserSupplied)
      );
      const hasAdvanced =
        Object.keys(seed.env ?? {}).length > 0 ||
        Object.keys(seed.headers ?? {}).length > 0;
      setAdvancedOpen(hasAdvanced);
      // An existing slug counts as "user-set" so a name edit doesn't clobber it.
      setSlugTouched(!!seed.slug);
    } else {
      setForm(EMPTY);
      setArgsRaw("");
      setEnvEntries([]);
      setHeadersEntries([]);
      setAdvancedOpen(false);
      setSlugTouched(false);
    }
    setIconFile(null);
    setIconPreview("");
    setStep(0);
    // JSON import mode + textarea reset. Edit sessions never enter JSON mode.
    setCreateMode("manual");
    setJsonRaw("");
  }, [visible, editing]);

  // Object-URL preview lifecycle: create on file pick, revoke on replace/unmount
  // so we never leak blob URLs.
  useEffect(() => {
    if (!iconFile) {
      setIconPreview("");
      return;
    }
    const url = URL.createObjectURL(iconFile);
    setIconPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [iconFile]);

  const update = <K extends keyof CreateMcpParams>(
    key: K,
    value: CreateMcpParams[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetAll = () => {
    setForm(EMPTY);
    setArgsRaw("");
    setEnvEntries([]);
    setHeadersEntries([]);
    setAdvancedOpen(false);
    setIconFile(null);
    setIconPreview("");
    setSlugTouched(false);
    setStep(0);
    setCreateMode("manual");
    setJsonRaw("");
  };

  /** Name edit also seeds the slug while the user hasn't hand-edited it, so the
   *  JSON `mcpServers` key stays a sensible ASCII slug by default. */
  const handleNameChange = (v: string) => {
    setForm((prev) => ({
      ...prev,
      name: v,
      slug: slugTouched ? prev.slug : slugifyServerName(v),
    }));
  };

  /** Sanitize the manual slug as the user types so the field can never hold a
   *  value that would be rejected/rewritten later: lowercase, spaces → `-`, and
   *  only `[a-z0-9-]` survive. Empty is allowed (submit falls back to the name /
   *  safe default); we keep in-progress trailing `-` so typing feels natural. */
  const handleSlugChange = (v: string) => {
    setSlugTouched(true);
    const cleaned = v
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-");
    update("slug", cleaned);
  };

  /** Close = also wipe local form state so re-opening always starts fresh
   *  (avoids leaked draft from a previous cancelled create). Blocked while
   *  the create request is in flight so an accidental Esc doesn't strand
   *  the user with a half-submitted payload. */
  const handleClose = () => {
    if (submitting) return;
    resetAll();
    onClose();
  };

  // ── Step navigation ────────────────────────────────────────────────────
  const goNext = () => {
    if (step === 0 && !form.name.trim()) {
      Toast.warning(t("mcp.create.nameRequired"));
      return;
    }
    setStep((s) => Math.min(s + 1, 2));
  };
  const goPrev = () => setStep((s) => Math.max(s - 1, 0));

  // ── Icon upload ────────────────────────────────────────────────────────
  // Preview uses an object URL; the real upload to object storage happens on
  // submit once we have an MCP id (POST /mcps/{id}/icon).
  const handleIconPick = () => iconInputRef.current?.click();

  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      Toast.error(t("mcp.create.iconTypeError"));
      return;
    }
    if (file.size > ICON_MAX_BYTES) {
      Toast.error(t("mcp.create.iconSizeError"));
      return;
    }
    setIconFile(file);
  };

  const handleIconRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIconFile(null);
    update("icon", "");
  };

  // ── Probe ──────────────────────────────────────────────────────────────
  const handleProbe = async () => {
    // Probe sends the REAL values from the editor — user-supplied included —
    // so the handshake actually reaches the remote server. This is a
    // separate transient request; the persisted body is built by
    // entriesToWire in handleSubmit (which also preserves the value now,
    // §5.1 rule 1 relaxation).
    const probeHeaders: Record<string, string> = {};
    for (const e of headersEntries) {
      const k = e.key.trim();
      if (k) probeHeaders[k] = e.value;
    }
    const probeEnv: Record<string, string> = {};
    for (const e of envEntries) {
      const k = e.key.trim();
      if (k) probeEnv[k] = e.value;
    }
    const req: McpProbeRequest = isRemote(form.transport)
      ? {
          transport: form.transport,
          url: form.url,
          headers: probeHeaders,
        }
      : {
          transport: form.transport,
          command: form.command,
          args: argsRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
          env: probeEnv,
        };
    setProbing(true);
    try {
      const result = await probeMcpTools(req);
      if (!result.ok) {
        const code = result.error?.code;
        Toast.error(
          code
            ? t(`mcp.create.probeError.${code}`)
            : t("mcp.create.probeFailed")
        );
        return;
      }
      let truncated = 0;
      const tools = result.tools.map((tool) => {
        const clamped = clampToolDescription(tool.description);
        if (clamped !== tool.description) truncated += 1;
        return { ...tool, description: clamped };
      });
      update("tools", tools);
      Toast.success(
        t("mcp.create.probeSuccess", { values: { count: tools.length } })
      );
      if (truncated > 0) {
        Toast.info(
          t("mcp.create.probeTruncated", {
            values: { count: truncated, max: MAXLEN.text },
          })
        );
      }
    } catch (err: unknown) {
      Toast.error(
        err instanceof Error ? err.message : t("mcp.create.probeFailed")
      );
    } finally {
      setProbing(false);
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────────

  /** Transport-aware required-field check (LSC-80 #3) + per-item length limits
   *  for the free-text args / headers fields whose granularity a plain
   *  `maxLength` can't express (LSC-80 #2). `args` stays optional.
   *  Returns an i18n message key (+ interpolation values) on the first failure,
   *  else null. */
  const firstValidationError = (): {
    key: string;
    values?: Record<string, number>;
  } | null => {
    if (!form.name.trim()) return { key: "mcp.create.nameRequired" };
    if (isRemote(form.transport)) {
      if (!(form.url ?? "").trim()) return { key: "mcp.create.urlRequired" };
      // Per-row key / value length. The KV editor caps typed input via
      // `maxLength`, but a paste or a JSON-import seed can exceed the cap;
      // the explicit check turns that into a friendly toast instead of a
      // backend `too_long` reject later.
      for (const e of headersEntries) {
        const k = e.key.trim();
        if (!k) continue;
        if (k.length > MAXLEN.headerKey)
          return {
            key: "mcp.create.headerKeyTooLong",
            values: { max: MAXLEN.headerKey },
          };
        if (e.value.length > MAXLEN.headerValue)
          return {
            key: "mcp.create.headerValueTooLong",
            values: { max: MAXLEN.headerValue },
          };
      }
    } else {
      // stdio → command required (args optional, per user confirmation).
      if (!(form.command ?? "").trim())
        return { key: "mcp.create.commandRequired" };
      // Per-arg length (args are one-per-line tokens).
      const args = argsRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (args.some((a) => a.length > MAXLEN.arg))
        return { key: "mcp.create.argTooLong", values: { max: MAXLEN.arg } };
      for (const e of envEntries) {
        const k = e.key.trim();
        if (!k) continue;
        if (k.length > MAXLEN.headerKey)
          return {
            key: "mcp.create.headerKeyTooLong",
            values: { max: MAXLEN.headerKey },
          };
        if (e.value.length > MAXLEN.headerValue)
          return {
            key: "mcp.create.headerValueTooLong",
            values: { max: MAXLEN.headerValue },
          };
      }
    }
    return null;
  };

  const handleSubmit = async () => {
    const tagError = validateMcpTags(form.tags);
    if (tagError) {
      Toast.warning(tagError);
      setStep(0);
      return;
    }
    const err = firstValidationError();
    if (err) {
      Toast.warning(
        t(err.key, err.values ? { values: err.values } : undefined)
      );
      // Connection fields live on step 1; jump there so the user sees the gap.
      if (err.key !== "mcp.create.nameRequired") setStep(1);
      else setStep(0);
      return;
    }

    // Collapse the structured editors down to the wire pair. Backend no
    // longer rejects secret-shaped shared values (rule 2 was removed);
    // non-owner blanking (§5.3) is the sole guard keeping author tokens
    // out of consumer-facing responses. The inline warning next to the
    // Submit button (see sharedSecretLeaks below) is the frontend's
    // advisory signal for the edge case where the operator explicitly
    // published a secret-shape shared value; non-blocking on purpose.
    const envWire = entriesToWire(envEntries);
    const headersWire = entriesToWire(headersEntries);

    setSubmitting(true);
    // Upload icon FIRST so the URL can ride in the create/update body. The
    // marketplace endpoint no longer accepts multipart icon uploads; uploads
    // go through the main IM (mcpService.uploadMcpIconReal) and return a URL
    // that only the caller can persist by writing it back onto the icon
    // field. The prior "upload after create" flow silently dropped the URL.
    let iconOverride: string | undefined;
    if (iconFile) {
      try {
        // `uploadMcpIcon` uses its id arg only as an object-storage key
        // prefix, so a synthetic value for the create case is fine.
        const prefix = isEdit && editing ? editing.id : "new";
        iconOverride = await uploadMcpIcon(prefix, iconFile);
      } catch {
        Toast.warning(t("mcp.create.iconUploadFailed"));
        // Fall through — submit the record without a fresh icon rather than
        // blocking the whole create/edit on a transient upload failure.
      }
    }
    const payload: CreateMcpParams = {
      ...form,
      icon: iconOverride ?? form.icon,
      // Slug is the JSON `mcpServers` key; a manual override is run through the
      // same slugify as the auto value so Chinese / uppercase / spaces /
      // underscores can never leak into the key. Falls back to the safe default.
      slug: slugifyServerName(
        (form.slug ?? "").trim() ? form.slug! : form.name
      ),
      args: argsRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      // The structured editor already decides per-row whether the value is
      // "shared" (persist as-is) or "user-supplied" (persist empty). We do
      // NOT gate env/headers on transport — validate() enforces coherent
      // state (stdio requires command, remote requires url), and gating at
      // submit was found to silently wipe legacy records whose wire data
      // doesn't match the current transport strictly.
      env: envWire.values,
      envUserSupplied: envWire.userSupplied,
      headers: headersWire.values,
      headersUserSupplied: headersWire.userSupplied,
      tools: form.tools.filter((t) => t.name.trim()),
      usageExamples: (form.usageExamples ?? []).filter((s) => s.trim()),
      faqs: (form.faqs ?? []).filter((f) => f.question.trim()),
      notes: (form.notes ?? []).filter((s) => s.trim()),
    };
    try {
      if (isEdit && editing) {
        const updated = await updateMcp(editing.id, payload);
        Toast.success(t("mcp.edit.success"));
        resetAll();
        onSaved(updated);
      } else {
        await createMcp(payload);
        Toast.success(t("mcp.create.success"));
        resetAll();
        onSaved();
      }
      onClose();
    } catch (err: unknown) {
      const fallback = isEdit ? t("mcp.edit.failed") : t("mcp.create.failed");
      Toast.error(err instanceof Error ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Dynamic-list handlers ──────────────────────────────────────────────
  const addExample = () =>
    update("usageExamples", [...(form.usageExamples ?? []), ""]);
  const removeExample = (idx: number) =>
    update(
      "usageExamples",
      (form.usageExamples ?? []).filter((_, i) => i !== idx)
    );
  const updateExample = (idx: number, v: string) =>
    update(
      "usageExamples",
      (form.usageExamples ?? []).map((s, i) => (i === idx ? v : s))
    );

  const addNote = () => update("notes", [...(form.notes ?? []), ""]);
  const removeNote = (idx: number) =>
    update(
      "notes",
      (form.notes ?? []).filter((_, i) => i !== idx)
    );
  const updateNote = (idx: number, v: string) =>
    update(
      "notes",
      (form.notes ?? []).map((s, i) => (i === idx ? v : s))
    );

  const addFaq = () =>
    update("faqs", [...(form.faqs ?? []), { question: "", answer: "" }]);
  const removeFaq = (idx: number) =>
    update(
      "faqs",
      (form.faqs ?? []).filter((_, i) => i !== idx)
    );
  const updateFaq = (idx: number, patch: Partial<McpFaq>) =>
    update(
      "faqs",
      (form.faqs ?? []).map((f, i) => (i === idx ? { ...f, ...patch } : f))
    );

  const addTool = () =>
    update("tools", [...form.tools, { name: "", description: "" }]);
  const removeTool = (idx: number) =>
    update(
      "tools",
      form.tools.filter((_, i) => i !== idx)
    );
  const updateTool = (
    idx: number,
    patch: { name?: string; description?: string }
  ) =>
    update(
      "tools",
      form.tools.map((tool, i) => (i === idx ? { ...tool, ...patch } : tool))
    );

  // Derived warning list: secret-shape keys the operator kept toggled OFF
  // (i.e. published as shared values) with a non-empty value. Rendered
  // inline next to the Submit button so the operator sees the exposure
  // before clicking, without a blocking modal. Non-blocking on purpose —
  // the KvEditor auto-toggles ON when a secret-shape key is typed into a
  // fresh row, so hitting this state requires an explicit override; the
  // warning is here for the operator's own audit, not to gate publish.
  const sharedSecretLeaks = useMemo(() => {
    const leaks: string[] = [];
    for (const e of [...headersEntries, ...envEntries]) {
      const k = e.key.trim();
      if (!k) continue;
      if (e.userSupplied) continue;
      if (!e.value) continue;
      if (isSecretKey(k)) leaks.push(k);
    }
    return leaks;
  }, [headersEntries, envEntries]);

  // ── Static options ─────────────────────────────────────────────────────
  const categoryOptions = useMemo(
    () =>
      MCP_CATEGORY_ORDER.filter((k) => k !== "all").map((k) => ({
        value: k,
        label: MCP_CATEGORY_LABELS[k],
      })),
    []
  );

  const transportOptions = TRANSPORT_OPTIONS.map((tr) => ({
    value: tr,
    label: t(`mcp.create.transport.${tr}`),
  }));

  const visibilitySegments = [
    { value: "public" as McpVisibility, label: t("mcp.create.visPublic") },
    { value: "private" as McpVisibility, label: t("mcp.create.visPrivate") },
  ];

  // Preview src: the freshly-picked file's object URL wins; otherwise the
  // stored icon (a persisted storage URL, or a legacy base64 icon on edit).
  const iconSrc = iconPreview || form.icon;
  const iconIsImage = !!iconPreview || isImageIcon(form.icon);

  const AddBtn = ({ onClick }: { onClick: () => void }) => (
    <WKButton size="sm" variant="secondary" onClick={onClick}>
      + {t("mcp.create.usageExampleAdd")}
    </WKButton>
  );

  const stepDefs = [
    { key: "basic", label: t("mcp.create.stepBasic") },
    { key: "connect", label: t("mcp.create.stepConnect") },
    { key: "docs", label: t("mcp.create.stepDocs") },
  ];

  // ── JSON import (issue #867) ──────────────────────────────────────────
  // Live-parse the textarea on every keystroke so error / preview /
  // warnings update inline. Empty input keeps the panel clean (no
  // "please paste" error shown until the user actually tries to apply).
  const jsonParseResult = useMemo(
    () => (jsonRaw.trim() ? parseImportJSON(jsonRaw) : null),
    [jsonRaw]
  );

  /** Which parsed fields will actually be written to the form when the user
   *  clicks "Parse and fill". We only fill EMPTY fields so toggling modes
   *  never clobbers work the user has already done in the wizard. Transport is
   *  always applied — it's a small enum and switching it is the point of a
   *  JSON seed. */
  const importPreviewFlags = useMemo(() => {
    if (!jsonParseResult || jsonParseResult.error) return null;
    const f = jsonParseResult.fields;
    return {
      name: !!(f.name && !form.name.trim()),
      // slug: skip when the user has hand-edited (slugTouched) OR when a
      // non-empty auto-derived slug already exists — otherwise a JSON import
      // silently clobbers the slug the user was content with.
      slug: !!(
        f.slug &&
        !slugTouched &&
        !(form.slug ?? "").trim()
      ),
      // Transport only counts when it actually differs from the current form
      // value — otherwise every valid JSON would keep the Apply button enabled
      // and the "Filled N field(s)" toast would overstate no-op re-applies.
      transport: !!(f.transport && f.transport !== form.transport),
      command: !!(f.command && !(form.command ?? "").trim()),
      args: !!(f.args && f.args.length > 0 && !argsRaw.trim()),
      envKeys: !!(f.envKeys && f.envKeys.length > 0 && envEntries.length === 0),
      url: !!(f.url && !(form.url ?? "").trim()),
      headerKeys: !!(
        f.headerKeys &&
        f.headerKeys.length > 0 &&
        headersEntries.length === 0
      ),
    };
  }, [jsonParseResult, form, argsRaw, envEntries, headersEntries, slugTouched]);

  const importPreviewCount = importPreviewFlags
    ? Object.values(importPreviewFlags).filter(Boolean).length
    : 0;

  const handleApplyImport = () => {
    if (!jsonParseResult || jsonParseResult.error || !importPreviewFlags) {
      return;
    }
    const f = jsonParseResult.fields;
    // Clamp against the per-field MAXLENs so a wrapper key / command / url
    // longer than the input's cap can't sneak past the character-by-character
    // maxLength enforcement (which only limits KEYING, not initial values).
    // Args are validated per-item at submit; JSON has no MAXLEN, so those
    // don't need clamping here.
    const clamp = (s: string | undefined, max: number) =>
      s == null ? s : s.length > max ? s.slice(0, max) : s;
    setForm((prev) => ({
      ...prev,
      name: importPreviewFlags.name ? clamp(f.name!, MAXLEN.name)! : prev.name,
      slug: importPreviewFlags.slug ? clamp(f.slug!, MAXLEN.name)! : prev.slug,
      transport: importPreviewFlags.transport ? f.transport! : prev.transport,
      command: importPreviewFlags.command
        ? clamp(f.command!, MAXLEN.command)!
        : prev.command,
      url: importPreviewFlags.url ? clamp(f.url!, MAXLEN.url)! : prev.url,
    }));
    // Writing slug counts as an explicit user decision — pin slugTouched so a
    // subsequent name edit in handleNameChange doesn't silently re-derive slug
    // from the display name and clobber the imported one.
    if (importPreviewFlags.slug) setSlugTouched(true);
    // args: one-per-line so args that legitimately contain spaces (e.g.
    // `--config "a b"`) round-trip through the argsRaw buffer without being
    // re-tokenized on the whitespace-split at submit.
    if (importPreviewFlags.args) setArgsRaw(f.args!.join("\n"));
    // env / headers: only populate the buffer that matches the imported
    // transport. Filling both would leave stale content in the buffer the
    // active transport doesn't render.
    //
    // Emit one row per key with an empty value; smart-default the
    // "needs user config" toggle ON for keys whose name matches the
    // secret-key pattern (Authorization / apikey / *_token / ...) so
    // paste-and-save doesn't accidentally publish shared blanks.
    const importedTransport = f.transport ?? form.transport;
    const importedIsRemote =
      importedTransport === "streamable-http" || importedTransport === "sse";
    const seedEntries = (keys: string[]): KvEntry[] =>
      keys.map((k) => ({ key: k, value: "", userSupplied: isSecretKey(k) }));
    if (importPreviewFlags.envKeys && !importedIsRemote) {
      setEnvEntries(seedEntries(f.envKeys!));
      setAdvancedOpen(true);
    }
    if (importPreviewFlags.headerKeys && importedIsRemote) {
      setHeadersEntries(seedEntries(f.headerKeys!));
      setAdvancedOpen(true);
    }
    Toast.success(
      t("mcp.create.import.applied", { values: { count: importPreviewCount } })
    );
    setCreateMode("manual");
    setStep(0);
  };

  // Format the pasted JSON in place. Best-effort — parse fails silently
  // surface as a toast; keeps the raw text untouched so the user can fix
  // and retry. Uses 2-space indent to match the placeholder sample.
  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonRaw);
      setJsonRaw(JSON.stringify(parsed, null, 2));
    } catch {
      Toast.error(t("mcp.create.import.formatFailed"));
    }
  };

  const modeSegments = [
    { value: "manual" as const, label: t("mcp.create.modeManual") },
    { value: "json" as const, label: t("mcp.create.modeJson") },
  ];

  return (
    <WKModal
      visible={visible}
      onCancel={handleClose}
      width={720}
      className="wk-mcp-create-modal"
      bodyStyle={{ maxHeight: "78vh", overflowY: "auto" }}
      title={isEdit ? t("mcp.edit.title") : t("mcp.create.title")}
      footer={
        createMode === "json" ? null : (
        <div className="wk-mcp-form-footer">
          <div>
            {step > 0 && (
              <WKButton variant="secondary" onClick={goPrev}>
                ← {t("mcp.create.prev")}
              </WKButton>
            )}
          </div>
          <div className="wk-mcp-form-footer__right">
            {step < stepDefs.length - 1 ? (
              <WKButton variant="primary" onClick={goNext}>
                {t("mcp.create.next")} →
              </WKButton>
            ) : (
              <>
                {sharedSecretLeaks.length > 0 && (
                  <span
                    className="wk-mcp-form-footer__warning"
                    title={t("mcp.create.sharedSecretWarning", {
                      values: { keys: sharedSecretLeaks.join(", ") },
                    })}
                  >
                    ⚠️{" "}
                    {t("mcp.create.sharedSecretWarning", {
                      values: { keys: sharedSecretLeaks.join(", ") },
                    })}
                  </span>
                )}
                <WKButton
                  variant="primary"
                  loading={submitting}
                  onClick={handleSubmit}
                >
                  {isEdit ? t("mcp.edit.submit") : t("mcp.create.submit")}
                </WKButton>
              </>
            )}
          </div>
        </div>
        )
      }
    >
      <div className="wk-mcp-form">
        {!isEdit && (
          <div className="wk-mcp-form-mode">
            <Segments
              full
              value={createMode}
              options={modeSegments}
              onChange={(v) => setCreateMode(v)}
            />
          </div>
        )}

        {createMode === "json" && (
          <div className="wk-mcp-import-panel">
            <div className="wk-mcp-import-panel__desc">
              {t("mcp.create.import.desc")}
            </div>
            <TextArea
              value={jsonRaw}
              onChange={setJsonRaw}
              rows={10}
              spellCheck={false}
              placeholder={t("mcp.create.import.placeholder")}
              style={{ fontFamily: "var(--wk-font-mono, monospace)" }}
            />
            {jsonParseResult?.error && (
              <div className="wk-mcp-import-panel__error">
                {t(jsonParseResult.error)}
              </div>
            )}
            {jsonParseResult && !jsonParseResult.error &&
              jsonParseResult.warnings.length > 0 && (
                <ul className="wk-mcp-import-panel__warnings">
                  {jsonParseResult.warnings.map((w) => (
                    <li key={w}>{t(w)}</li>
                  ))}
                </ul>
              )}
            <div className="wk-mcp-import-panel__actions">
              <WKButton
                variant="secondary"
                disabled={!jsonRaw.trim()}
                onClick={handleFormatJson}
              >
                {t("mcp.create.import.format")}
              </WKButton>
              <WKButton
                variant="primary"
                disabled={
                  !jsonParseResult ||
                  !!jsonParseResult.error ||
                  importPreviewCount === 0
                }
                onClick={handleApplyImport}
              >
                {t("mcp.create.import.apply")}
              </WKButton>
            </div>
          </div>
        )}

        {createMode === "manual" && (
          <>
        <div className="wk-mcp-form-steps">
          {stepDefs.map((s, i) => (
            <React.Fragment key={s.key}>
              {i > 0 && <div className="wk-mcp-form-steps__sep" />}
              <button
                type="button"
                className={
                  i === step
                    ? "wk-mcp-form-step wk-mcp-form-step--active"
                    : i < step
                    ? "wk-mcp-form-step wk-mcp-form-step--done"
                    : "wk-mcp-form-step"
                }
                onClick={() => setStep(i)}
              >
                <span className="wk-mcp-form-step__num">{i + 1}</span>
                {s.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        {step === 0 && (
          <>
            {/* 1. 基本信息 */}
            <Section
              title={t("mcp.create.sectionBasics")}
              desc={t("mcp.create.sectionBasicsDesc")}
            >
              <div className="wk-mcp-field-row">
                <div
                  className={
                    iconIsImage
                      ? "wk-mcp-icon-picker"
                      : "wk-mcp-icon-picker wk-mcp-icon-picker--empty"
                  }
                  onClick={handleIconPick}
                  tabIndex={0}
                  role="button"
                  aria-label={t("mcp.create.icon")}
                >
                  {iconIsImage ? (
                    <img
                      className="wk-mcp-icon-picker__img"
                      src={iconSrc}
                      alt=""
                    />
                  ) : (
                    <span className="wk-mcp-icon-picker__placeholder">
                      {t("mcp.create.iconEmpty")}
                    </span>
                  )}
                  <div className="wk-mcp-icon-picker__overlay">
                    <span className="wk-mcp-icon-picker__action">
                      {iconIsImage
                        ? t("mcp.create.iconChange")
                        : t("mcp.create.iconUpload")}
                    </span>
                    {iconIsImage && (
                      <span
                        className="wk-mcp-icon-picker__action"
                        onClick={handleIconRemove}
                      >
                        {t("mcp.create.iconRemove")}
                      </span>
                    )}
                  </div>
                  <input
                    ref={iconInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleIconChange}
                  />
                </div>

                <div className="wk-mcp-field-row__grow">
                  <Field label={t("mcp.create.name")} required>
                    <WKInput
                      value={form.name}
                      onChange={handleNameChange}
                      placeholder={t("mcp.create.namePlaceholder")}
                      maxLength={MAXLEN.name}
                    />
                  </Field>
                </div>
              </div>

              <Field
                label={t("mcp.create.slug")}
                hint={t("mcp.create.slugHint")}
              >
                <WKInput
                  value={form.slug ?? ""}
                  onChange={handleSlugChange}
                  placeholder={t("mcp.create.slugPlaceholder")}
                  maxLength={MAXLEN.name}
                />
              </Field>

              <div className="wk-mcp-field-grid">
                <Field label={t("mcp.create.category")}>
                  <Select
                    style={{ width: "100%" }}
                    value={form.category}
                    optionList={categoryOptions}
                    onChange={(v) => update("category", v as string)}
                  />
                </Field>
                <Field label={t("mcp.create.tags")}>
                  <TagsInput
                    value={form.tags}
                    onChange={(next) => update("tags", next)}
                    placeholder={t("mcp.create.tagsInputPlaceholder")}
                  />
                </Field>
              </div>

              <Field label={t("mcp.create.slogan")}>
                <WKInput
                  value={form.slogan}
                  onChange={(v) => update("slogan", v)}
                  placeholder={t("mcp.create.sloganPlaceholder")}
                  maxLength={MAXLEN.slogan}
                />
              </Field>
            </Section>
          </>
        )}

        {step === 1 && (
          <>
            {/* 2. 接入方式 */}
            <Section
              title={t("mcp.create.sectionConnect")}
              desc={t("mcp.create.sectionConnectDesc")}
            >
              <Field label={t("mcp.create.transportLabel")}>
                <Select
                  style={{ width: "100%" }}
                  value={form.transport}
                  optionList={transportOptions}
                  onChange={(v) => update("transport", v as McpTransport)}
                />
              </Field>

              {isRemote(form.transport) ? (
                <>
                  <Field label={t("mcp.create.url")} required>
                    <WKInput
                      value={form.url ?? ""}
                      onChange={(v) => update("url", v)}
                      placeholder={t("mcp.create.urlPlaceholder")}
                      maxLength={MAXLEN.url}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label={t("mcp.create.command")} required>
                    <WKInput
                      value={form.command ?? ""}
                      onChange={(v) => update("command", v)}
                      placeholder={t("mcp.create.commandPlaceholder")}
                      maxLength={MAXLEN.command}
                    />
                  </Field>
                  <Field
                    label={t("mcp.create.args")}
                    hint={t("mcp.create.argsHint")}
                  >
                    <TextArea
                      value={argsRaw}
                      onChange={setArgsRaw}
                      rows={3}
                      autosize={{ minRows: 2, maxRows: 6 }}
                      placeholder={t("mcp.create.argsPlaceholder")}
                    />
                  </Field>
                </>
              )}

              <div className="wk-mcp-advanced">
                <button
                  type="button"
                  className="wk-mcp-advanced__toggle"
                  onClick={() => setAdvancedOpen((v) => !v)}
                >
                  <span
                    className={
                      advancedOpen
                        ? "wk-mcp-advanced__caret wk-mcp-advanced__caret--open"
                        : "wk-mcp-advanced__caret"
                    }
                  >
                    ▸
                  </span>
                  {advancedOpen
                    ? t("mcp.create.advancedHide")
                    : t("mcp.create.advancedShow")}
                </button>
                {advancedOpen && (
                  <div className="wk-mcp-advanced__body">
                    {isRemote(form.transport) ? (
                      <Field
                        label={t("mcp.create.headers")}
                        hint={t("mcp.create.headersHint")}
                      >
                        <KvEditor
                          entries={headersEntries}
                          onChange={setHeadersEntries}
                          keyPlaceholder={t("mcp.create.headerKeyPlaceholder")}
                          valuePlaceholder={t(
                            "mcp.create.headerValuePlaceholder"
                          )}
                          addLabel={t("mcp.create.headerAdd")}
                          toggleLabel={t("mcp.create.kvUserSuppliedToggle")}
                          removeLabel={t("mcp.create.headerRemove")}
                        />
                      </Field>
                    ) : (
                      <Field
                        label={t("mcp.create.env")}
                        hint={t("mcp.create.envHint")}
                      >
                        <KvEditor
                          entries={envEntries}
                          onChange={setEnvEntries}
                          keyPlaceholder={t("mcp.create.envKeyPlaceholder")}
                          valuePlaceholder={t("mcp.create.envValuePlaceholder")}
                          addLabel={t("mcp.create.envAdd")}
                          toggleLabel={t("mcp.create.kvUserSuppliedToggle")}
                          removeLabel={t("mcp.create.envRemove")}
                        />
                      </Field>
                    )}
                  </div>
                )}
              </div>
            </Section>

            {/* 3. 工具清单 */}
            <Section
              title={t("mcp.create.sectionTools")}
              desc={t("mcp.create.sectionToolsDesc")}
              action={
                <div style={{ display: "flex", gap: "8px" }}>
                  <WKButton size="sm" variant="secondary" onClick={addTool}>
                    + {t("mcp.create.toolAdd")}
                  </WKButton>
                  {/* Probe only works in mock mode today; the marketplace REST
                      surface has no /probe and the Electron IPC (LSC-70) has not
                      landed. Hide the button when it would only fail so users
                      fall back to adding tools manually. */}
                  {isProbeAvailable && (
                    <WKButton
                      size="sm"
                      variant="secondary"
                      loading={probing}
                      onClick={handleProbe}
                    >
                      {t("mcp.create.probe")}
                    </WKButton>
                  )}
                </div>
              }
            >
              {form.tools.length === 0 ? (
                <div className="wk-mcp-rows__empty">
                  {t("mcp.create.toolsEmpty")}
                </div>
              ) : (
                <div className="wk-mcp-rows">
                  {form.tools.map((tool, idx) => (
                    <div className="wk-mcp-tool-editor" key={idx}>
                      <div className="wk-mcp-tool-editor__head">
                        <span className="wk-mcp-row__index">#{idx + 1}</span>
                        <WKButton
                          size="sm"
                          variant="ghost"
                          onClick={() => removeTool(idx)}
                        >
                          {t("mcp.create.toolRemove")}
                        </WKButton>
                      </div>
                      <WKInput
                        value={tool.name}
                        onChange={(v) => updateTool(idx, { name: v })}
                        placeholder={t("mcp.create.toolNamePlaceholder")}
                        maxLength={MAXLEN.toolName}
                      />
                      <WKInput
                        value={tool.description}
                        onChange={(v) => updateTool(idx, { description: v })}
                        placeholder={t("mcp.create.toolDescPlaceholder")}
                        maxLength={MAXLEN.text}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="wk-mcp-field__hint">
                {t("mcp.create.toolsHint")}
              </div>
            </Section>
          </>
        )}

        {step === 2 && (
          <>
            {/* 4. 使用示例 */}
            <Section
              title={t("mcp.create.sectionExamples")}
              desc={t("mcp.create.sectionExamplesDesc")}
              action={<AddBtn onClick={addExample} />}
            >
              {(form.usageExamples ?? []).length === 0 ? (
                <div className="wk-mcp-rows__empty">
                  {t("mcp.create.emptyExamples")}
                </div>
              ) : (
                <div className="wk-mcp-rows">
                  {(form.usageExamples ?? []).map((ex, idx) => (
                    <div className="wk-mcp-row" key={idx}>
                      <span className="wk-mcp-row__index">#{idx + 1}</span>
                      <div className="wk-mcp-row__grow">
                        <WKInput
                          value={ex}
                          onChange={(v) => updateExample(idx, v)}
                          placeholder={t("mcp.create.usageExamplePlaceholder")}
                        />
                      </div>
                      <WKButton
                        size="sm"
                        variant="ghost"
                        onClick={() => removeExample(idx)}
                      >
                        {t("mcp.create.usageExampleRemove")}
                      </WKButton>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* 5. 常见问题 */}
            <Section
              title={t("mcp.create.sectionFaqs")}
              desc={t("mcp.create.sectionFaqsDesc")}
              action={
                <WKButton size="sm" variant="secondary" onClick={addFaq}>
                  + {t("mcp.create.faqAdd")}
                </WKButton>
              }
            >
              {(form.faqs ?? []).length === 0 ? (
                <div className="wk-mcp-rows__empty">
                  {t("mcp.create.emptyFaqs")}
                </div>
              ) : (
                <div className="wk-mcp-rows">
                  {(form.faqs ?? []).map((faq, idx) => (
                    <div className="wk-mcp-faq-card" key={idx}>
                      <div className="wk-mcp-faq-card__head">
                        <span className="wk-mcp-faq-card__index">
                          #{idx + 1}
                        </span>
                        <WKButton
                          size="sm"
                          variant="ghost"
                          onClick={() => removeFaq(idx)}
                        >
                          {t("mcp.create.faqRemove")}
                        </WKButton>
                      </div>
                      <WKInput
                        value={faq.question}
                        onChange={(v) => updateFaq(idx, { question: v })}
                        placeholder={t("mcp.create.faqQuestionPlaceholder")}
                        maxLength={MAXLEN.text}
                      />
                      <TextArea
                        value={faq.answer}
                        onChange={(v) => updateFaq(idx, { answer: v })}
                        rows={2}
                        maxLength={MAXLEN.text}
                        placeholder={t("mcp.create.faqAnswerPlaceholder")}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* 6. 注意事项 */}
            <Section
              title={t("mcp.create.sectionNotes")}
              desc={t("mcp.create.sectionNotesDesc")}
              action={
                <WKButton size="sm" variant="secondary" onClick={addNote}>
                  + {t("mcp.create.notesAdd")}
                </WKButton>
              }
            >
              {(form.notes ?? []).length === 0 ? (
                <div className="wk-mcp-rows__empty">
                  {t("mcp.create.emptyNotes")}
                </div>
              ) : (
                <div className="wk-mcp-rows">
                  {(form.notes ?? []).map((note, idx) => (
                    <div className="wk-mcp-row" key={idx}>
                      <span className="wk-mcp-row__index">#{idx + 1}</span>
                      <div className="wk-mcp-row__grow">
                        <WKInput
                          value={note}
                          onChange={(v) => updateNote(idx, v)}
                          placeholder={t("mcp.create.notesPlaceholder")}
                          maxLength={MAXLEN.text}
                        />
                      </div>
                      <WKButton
                        size="sm"
                        variant="ghost"
                        onClick={() => removeNote(idx)}
                      >
                        {t("mcp.create.notesRemove")}
                      </WKButton>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* 7. 可见范围 */}
            <Section full title={t("mcp.create.sectionVisibility")}>
              <Segments
                full
                value={form.visibility}
                options={visibilitySegments}
                onChange={(v) => update("visibility", v)}
              />
            </Section>
          </>
        )}
        </>
        )}
      </div>
    </WKModal>
  );
};

export default McpCreateModal;
