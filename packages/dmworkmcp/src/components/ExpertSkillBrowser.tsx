import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import JSZip from "jszip";
import { Download, FileText } from "lucide-react";
import { t, useI18n, WKButton } from "@octo/base";
import { fetchSkillPackage } from "../api/expertService";
import type { ExpertSkill } from "../mock/expertMock";

interface ExpertSkillBrowserProps {
  skill: ExpertSkill;
  /** Resolve the presigned package URL (package skills — enables the file browser). */
  fetchPackageUrl?: () => Promise<string>;
  /** Fetch the stored SKILL.md text (legacy content-only skills, no package). */
  fetchContent: () => Promise<string>;
  /** Open a URL as a download (new tab). */
  openDownload: (url: string) => void;
}

/** Per-file preview outcome: rendered markdown, plain text, or a notice
 *  (binary / too large / empty) shown in place of content. */
type FileView =
  | { kind: "md"; body: string }
  | { kind: "text"; body: string }
  | { kind: "notice"; body: string };

// Don't decompress a single entry larger than this into the previewer.
const MAX_PREVIEW_BYTES = 512 * 1024;
// Cap how many entries we enumerate from a package, so a pathological archive
// with a huge entry count can't bloat the file list / state.
const MAX_PACKAGE_ENTRIES = 500;
// Fetch timeout for the whole package (mirrors the app request ceiling).
const PACKAGE_FETCH_TIMEOUT_MS = 30000;

// Sanitize schema for publisher-supplied markdown. The default schema permits
// <img> with an https: src, so a SKILL.md embedding a remote image would beacon
// the viewer's IP/UA/referer to a publisher-chosen host (and could probe
// reachable hosts) the moment the skill is expanded. Skill docs are text —
// drop img entirely; script/javascript: URLs are already blocked by default.
const SKILL_MD_SCHEMA = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => tag !== "img"),
};

function stripFrontmatter(md: string): string {
  const match = /^﻿?---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/.exec(md);
  return match ? md.slice(match[0].length) : md;
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** SKILL.md first (by basename, root/nested), then alphabetical. */
function sortPaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const aSkill = baseName(a).toLowerCase() === "skill.md";
    const bSkill = baseName(b).toLowerCase() === "skill.md";
    if (aSkill !== bSkill) return aSkill ? -1 : 1;
    return a.localeCompare(b);
  });
}

/** Heuristic: a NUL byte in the first chunk means "treat as binary". */
function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i += 1) if (bytes[i] === 0) return true;
  return false;
}

/**
 * Read the total entry count from the zip's End Of Central Directory record
 * WITHOUT handing the buffer to JSZip: `loadAsync` parses the entire central
 * directory up front (building one object per entry), so the entry cap must be
 * enforced before it runs — a hostile archive with millions of entries would
 * otherwise bloat memory during the parse itself. The EOCD is a 22-byte record
 * (signature 0x06054b50) sitting within the last 22..65557 bytes of the file
 * (fixed part + up to 64 KiB comment); the total entry count is the u16 at
 * offset 10. 0xFFFF (ZIP64 sentinel or a genuine 65535) is far past our cap
 * either way. No EOCD → not a zip we should feed to the parser.
 */
function zipEntryCount(buf: ArrayBuffer): number {
  const bytes = new Uint8Array(buf);
  const last = bytes.length - 22;
  const scanFrom = Math.max(0, last - 0xffff);
  for (let i = last; i >= scanFrom; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return bytes[i + 10] | (bytes[i + 11] << 8);
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

// jszip's documented streaming API, absent from its index.d.ts (typed there
// only for `nodeStream`). Narrow surface we rely on, typed here instead of `any`.
interface ZipEntryStream {
  on(event: "data", cb: (chunk: Uint8Array) => void): ZipEntryStream;
  on(event: "error", cb: (err: Error) => void): ZipEntryStream;
  on(event: "end", cb: () => void): ZipEntryStream;
  resume(): ZipEntryStream;
  pause(): ZipEntryStream;
}

/**
 * Inflate one zip entry with the byte ceiling enforced DURING decompression.
 * The central directory's declared uncompressed size is publisher-controlled,
 * so it must not be trusted to decide whether inflating is safe — understating
 * it would let a high-ratio entry (zip bomb) expand fully into memory before
 * any post-hoc length check. Streaming caps the materialised bytes at
 * `cap` + one chunk: past that the stream is paused and dropped. Resolves
 * null when the cap is exceeded.
 */
function inflateCapped(
  entry: JSZip.JSZipObject,
  cap: number
): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const stream = (
      entry as unknown as { internalStream(type: "uint8array"): ZipEntryStream }
    ).internalStream("uint8array");
    stream
      .on("data", (chunk) => {
        if (settled) return;
        total += chunk.length;
        if (total > cap) {
          settled = true;
          stream.pause();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      })
      .on("error", (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      })
      .on("end", () => {
        if (settled) return;
        settled = true;
        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.length;
        }
        resolve(out);
      })
      .resume();
  });
}

/**
 * Inline (accordion) file browser for one skill package. On mount it resolves +
 * fetches the presigned package (abortable, timed out), unzips it client-side,
 * and lets the user switch between the bundled files. Each file is decompressed
 * LAZILY on selection (and cached) — never all at once — with per-file size and
 * binary guards. SKILL.md and any *.md render as sanitized markdown; other text
 * files as plain text. Legacy content-only skills fall back to their SKILL.md.
 * The content pane is height-bounded and scrolls.
 */
export default function ExpertSkillBrowser({
  skill,
  fetchPackageUrl,
  fetchContent,
  openDownload,
}: ExpertSkillBrowserProps) {
  useI18n();
  const zipRef = useRef<JSZip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);
  const [active, setActive] = useState<string>("");
  const [views, setViews] = useState<Record<string, FileView>>({});
  const [packageUrl, setPackageUrl] = useState<string>("");

  // Decode one zip entry into a viewable FileView, applying size/binary guards.
  const loadFile = async (path: string) => {
    if (views[path] !== undefined) return;
    const zip = zipRef.current;
    const entry = zip?.file(path);
    if (!entry) {
      setViews((v) => ({ ...v, [path]: { kind: "notice", body: t("mcp.expert.skillEmpty") } }));
      return;
    }
    // The preview cap is enforced while inflating (inflateCapped): the entry's
    // declared uncompressed size lives in the publisher-supplied central
    // directory, so it cannot be the guard — a bomb entry that understates it
    // must still be stopped mid-stream rather than fully materialised.
    const bytes = await inflateCapped(entry, MAX_PREVIEW_BYTES);
    let view: FileView;
    if (bytes === null) {
      view = { kind: "notice", body: t("mcp.expert.skillFileTooLarge") };
    } else if (looksBinary(bytes)) {
      view = { kind: "notice", body: t("mcp.expert.skillFileBinary") };
    } else {
      const text = new TextDecoder().decode(bytes);
      view = isMarkdown(path)
        ? { kind: "md", body: stripFrontmatter(text).trim() }
        : { kind: "text", body: text };
    }
    setViews((v) => ({ ...v, [path]: view }));
  };

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), PACKAGE_FETCH_TIMEOUT_MS);
    (async () => {
      setLoading(true);
      setError(false);
      try {
        if (skill.canDownload && fetchPackageUrl) {
          const url = await fetchPackageUrl();
          if (cancelled) return;
          setPackageUrl(url);
          const buf = await fetchSkillPackage(url, controller.signal);
          // Bound the entry count BEFORE JSZip parses the central directory —
          // loadAsync builds an object per entry up front, so the forEach cap
          // below cannot protect against a pathological entry count on its own.
          if (zipEntryCount(buf) > MAX_PACKAGE_ENTRIES) {
            throw new Error("package has too many entries");
          }
          const zip = await JSZip.loadAsync(buf);
          if (cancelled) return;
          zipRef.current = zip;
          const entries: string[] = [];
          zip.forEach((path, entry) => {
            if (entry.dir) return;
            if (entries.length >= MAX_PACKAGE_ENTRIES) return;
            entries.push(path);
          });
          const sorted = sortPaths(entries);
          setPaths(sorted);
          const first = sorted[0] ?? "";
          setActive(first);
          if (first) await loadFile(first);
        } else {
          const content = await fetchContent();
          if (cancelled) return;
          setPaths(["SKILL.md"]);
          setActive("SKILL.md");
          setViews({
            "SKILL.md": { kind: "md", body: stripFrontmatter(content).trim() },
          });
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
    // Mounts fresh each time the skill is expanded; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectFile = (path: string) => {
    setActive(path);
    void loadFile(path);
  };

  const view = active ? views[active] : undefined;

  return (
    <div className="wk-mcp-expert-skill__browser">
      {skill.canDownload && (
        <div className="wk-mcp-expert-skill__toolbar">
          <WKButton
            variant="secondary"
            size="sm"
            icon={<Download size={14} />}
            disabled={!packageUrl}
            onClick={() => packageUrl && openDownload(packageUrl)}
          >
            {t("mcp.expert.downloadPackage")}
          </WKButton>
        </div>
      )}

      {loading ? (
        <p className="wk-mcp-expert-skill__state">{t("mcp.expert.loading")}</p>
      ) : error ? (
        <p className="wk-mcp-expert-skill__state wk-mcp-expert-skill__state--error">
          {skill.canDownload
            ? t("mcp.expert.skillPreviewError")
            : t("mcp.expert.loadError")}
        </p>
      ) : paths.length === 0 ? (
        <p className="wk-mcp-expert-skill__state">{t("mcp.expert.skillEmpty")}</p>
      ) : (
        <div className="wk-mcp-expert-skill__browser-body">
          {paths.length > 1 && (
            <div className="wk-mcp-expert-skill__files" role="tablist">
              {paths.map((path) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={path === active}
                  className={
                    path === active
                      ? "wk-mcp-expert-skill__file is-active"
                      : "wk-mcp-expert-skill__file"
                  }
                  key={path}
                  onClick={() => selectFile(path)}
                >
                  <FileText size={13} aria-hidden="true" />
                  <span>{path}</span>
                </button>
              ))}
            </div>
          )}

          <div className="wk-mcp-expert-skill__viewer">
            {view === undefined ? (
              <p className="wk-mcp-expert-skill__state">{t("mcp.expert.loading")}</p>
            ) : view.kind === "md" ? (
              <div className="wk-mcp-expert-skill__md">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[[rehypeSanitize, SKILL_MD_SCHEMA]]}
                >
                  {view.body || t("mcp.expert.skillEmpty")}
                </ReactMarkdown>
              </div>
            ) : view.kind === "notice" ? (
              <p className="wk-mcp-expert-skill__state">{view.body}</p>
            ) : (
              <pre className="wk-mcp-expert-code wk-mcp-expert-skill__raw">{view.body}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
