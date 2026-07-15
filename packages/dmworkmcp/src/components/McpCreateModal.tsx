import React, { useEffect, useMemo, useRef, useState } from "react";
import { WKModal, WKInput, WKButton, t } from "@octo/base";
import { Select, TextArea, Toast } from "@douyinfe/semi-ui";
import {
  createMcp,
  probeMcpTools,
  isProbeAvailable,
  updateMcp,
  uploadMcpIcon,
} from "../api/mcpService";
import { MCP_CATEGORY_LABELS, MCP_CATEGORY_ORDER } from "../mock/mcpMock";
import {
  applySecretSentinel,
  SECRET_PLACEHOLDER_SENTINEL,
  isSecretKey,
  slugifyServerName,
} from "../utils/constants";
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
  authType: "none",
  tools: [],
  usageExamples: [],
  faqs: [],
  notes: [],
  visibility: "public",
};

const TRANSPORT_OPTIONS: McpTransport[] = ["stdio", "streamable-http", "sse"];

function isRemote(transport: McpTransport): boolean {
  return transport === "streamable-http" || transport === "sse";
}

function parseKV(raw: string, separator: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(separator);
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

/** Convert a detail record to the flat create/update form shape. Preserves
 *  everything the wire carries; drops the redacted secret sentinel so the
 *  user sees empty inputs (submit re-applies the sentinel via
 *  applySecretSentinel, so a not-touched secret round-trips cleanly). */
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
    env: stripSecretSentinel(qs.env),
    headers: stripSecretSentinel(qs.headers),
    authType: qs.authType ?? "none",
    tools: detail.tools,
    usageExamples: detail.usageExamples,
    faqs: detail.faqs,
    notes: detail.notes,
    visibility: detail.visibility ?? "public",
  };
}

/** Replace the redacted sentinel with an empty string on secret-typed keys,
 *  so the user sees a blank input instead of the wire literal. Non-secret
 *  keys pass through untouched. */
function stripSecretSentinel(
  m: Record<string, string> | undefined
): Record<string, string> {
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = isSecretKey(k) && v === SECRET_PLACEHOLDER_SENTINEL ? "" : v;
  }
  return out;
}

/** Serialize a KV map back to the "KEY=VALUE" or "Header: value" text buffer
 *  used by the env/headers <TextArea>. */
function serializeKV(
  m: Record<string, string> | undefined,
  separator: "=" | ": "
): string {
  if (!m) return "";
  return Object.entries(m)
    .map(([k, v]) => `${k}${separator}${v}`)
    .join("\n");
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

/** Chip-based tag input — Enter/comma add, Backspace on empty removes last. */
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

  const commit = (raw: string) => {
    const trimmed = raw.trim().replace(/,+$/, "");
    if (!trimmed) return;
    if (value.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  };

  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div className="wk-mcp-tags" onClick={() => inputRef.current?.focus()}>
      {value.map((tag, i) => (
        <span className="wk-mcp-tags__chip" key={`${tag}-${i}`}>
          {tag}
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

  // Text buffers for structured connection fields — parsed on submit / probe.
  const [argsRaw, setArgsRaw] = useState("");
  const [envRaw, setEnvRaw] = useState("");
  const [headersRaw, setHeadersRaw] = useState("");

  // Icon: the selected File is held locally for an object-URL preview and only
  // uploaded to object storage on submit (POST /mcps/{id}/icon, needs the id).
  // `form.icon` keeps the persisted storage URL (or a legacy base64 icon on
  // edit) so the create → detail round-trip renders without a blank.
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState("");

  // Once the user hand-edits the slug we stop auto-deriving it from the name.
  const [slugTouched, setSlugTouched] = useState(false);

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
      setArgsRaw((seed.args ?? []).join(" "));
      setEnvRaw(serializeKV(seed.env, "="));
      setHeadersRaw(serializeKV(seed.headers, ": "));
      const hasAdvanced =
        Object.keys(seed.env ?? {}).length > 0 ||
        Object.keys(seed.headers ?? {}).length > 0;
      setAdvancedOpen(hasAdvanced);
      // An existing slug counts as "user-set" so a name edit doesn't clobber it.
      setSlugTouched(!!seed.slug);
    } else {
      setForm(EMPTY);
      setArgsRaw("");
      setEnvRaw("");
      setHeadersRaw("");
      setAdvancedOpen(false);
      setSlugTouched(false);
    }
    setIconFile(null);
    setIconPreview("");
    setStep(0);
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
    setEnvRaw("");
    setHeadersRaw("");
    setAdvancedOpen(false);
    setIconFile(null);
    setIconPreview("");
    setSlugTouched(false);
    setStep(0);
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
    const req: McpProbeRequest = isRemote(form.transport)
      ? {
          transport: form.transport,
          url: form.url,
          headers: parseKV(headersRaw, ":"),
        }
      : {
          transport: form.transport,
          command: form.command,
          args: argsRaw.trim() ? argsRaw.trim().split(/\s+/) : [],
          env: parseKV(envRaw, "="),
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
      update("tools", result.tools);
      Toast.success(
        t("mcp.create.probeSuccess", { values: { count: result.tools.length } })
      );
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
      // Per-header key / value length (parsed from the raw `key: value` lines).
      const headers = parseKV(headersRaw, ":");
      for (const [k, v] of Object.entries(headers)) {
        if (k.length > MAXLEN.headerKey)
          return {
            key: "mcp.create.headerKeyTooLong",
            values: { max: MAXLEN.headerKey },
          };
        if (v.length > MAXLEN.headerValue)
          return {
            key: "mcp.create.headerValueTooLong",
            values: { max: MAXLEN.headerValue },
          };
      }
    } else {
      // stdio → command required (args optional, per user confirmation).
      if (!(form.command ?? "").trim())
        return { key: "mcp.create.commandRequired" };
      // Per-arg length (args are whitespace-split tokens).
      const args = argsRaw.trim() ? argsRaw.trim().split(/\s+/) : [];
      if (args.some((a) => a.length > MAXLEN.arg))
        return { key: "mcp.create.argTooLong", values: { max: MAXLEN.arg } };
    }
    return null;
  };

  const handleSubmit = async () => {
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
    const payload: CreateMcpParams = {
      ...form,
      // Slug is the JSON `mcpServers` key; a manual override is run through the
      // same slugify as the auto value so Chinese / uppercase / spaces /
      // underscores can never leak into the key. Falls back to the safe default.
      slug: slugifyServerName(
        (form.slug ?? "").trim() ? form.slug! : form.name
      ),
      args: argsRaw.trim() ? argsRaw.trim().split(/\s+/) : [],
      // Substitute the shared sentinel for any blank token-like env / header so
      // an empty secret is accepted instead of tripping `secret_leaked` on the
      // backend (mcp-v1.md §5). A user-typed real token is left as-is and the
      // backend surfaces the mistake.
      env: applySecretSentinel(parseKV(envRaw, "=")) ?? {},
      headers: applySecretSentinel(parseKV(headersRaw, ":")) ?? {},
      tools: form.tools.filter((t) => t.name.trim()),
      usageExamples: (form.usageExamples ?? []).filter((s) => s.trim()),
      faqs: (form.faqs ?? []).filter((f) => f.question.trim()),
      notes: (form.notes ?? []).filter((s) => s.trim()),
    };
    setSubmitting(true);
    try {
      if (isEdit && editing) {
        const updated = await updateMcp(editing.id, payload);
        // Icon upload needs the id, so it runs after the record exists.
        if (iconFile) {
          try {
            updated.icon = await uploadMcpIcon(editing.id, iconFile);
          } catch {
            Toast.warning(t("mcp.create.iconUploadFailed"));
          }
        }
        Toast.success(t("mcp.edit.success"));
        resetAll();
        onSaved(updated);
      } else {
        const { id } = await createMcp(payload);
        if (iconFile) {
          try {
            await uploadMcpIcon(id, iconFile);
          } catch {
            Toast.warning(t("mcp.create.iconUploadFailed"));
          }
        }
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

  const authSegments = [
    { value: "none" as const, label: t("mcp.create.authTypeNone") },
    { value: "bearer" as const, label: t("mcp.create.authTypeBearer") },
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

  return (
    <WKModal
      visible={visible}
      onCancel={handleClose}
      width={720}
      className="wk-mcp-create-modal"
      bodyStyle={{ maxHeight: "78vh", overflowY: "auto" }}
      title={isEdit ? t("mcp.edit.title") : t("mcp.create.title")}
      footer={
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
              <WKButton
                variant="primary"
                loading={submitting}
                onClick={handleSubmit}
              >
                {isEdit ? t("mcp.edit.submit") : t("mcp.create.submit")}
              </WKButton>
            )}
          </div>
        </div>
      }
    >
      <div className="wk-mcp-form">
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
                  <Field label={t("mcp.create.authType")}>
                    <Segments
                      value={form.authType ?? "none"}
                      options={authSegments}
                      onChange={(v) => update("authType", v)}
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
                    <WKInput
                      value={argsRaw}
                      onChange={setArgsRaw}
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
                        <TextArea
                          value={headersRaw}
                          onChange={setHeadersRaw}
                          rows={3}
                          placeholder={t("mcp.create.headersPlaceholder")}
                        />
                      </Field>
                    ) : (
                      <Field
                        label={t("mcp.create.env")}
                        hint={t("mcp.create.envHint")}
                      >
                        <TextArea
                          value={envRaw}
                          onChange={setEnvRaw}
                          rows={3}
                          placeholder={t("mcp.create.envPlaceholder")}
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
      </div>
    </WKModal>
  );
};

export default McpCreateModal;
