import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
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
    // Skip decompression entirely when the entry's DECLARED uncompressed size is
    // already over the preview cap — a high-ratio entry must not be expanded
    // into memory just to measure it. (Falls through to the post-check below for
    // entries whose declared size is missing/understated.)
    const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
      ?.uncompressedSize;
    if (typeof declared === "number" && declared > MAX_PREVIEW_BYTES) {
      setViews((v) => ({ ...v, [path]: { kind: "notice", body: t("mcp.expert.skillFileTooLarge") } }));
      return;
    }
    const bytes = await entry.async("uint8array");
    let view: FileView;
    if (bytes.length > MAX_PREVIEW_BYTES) {
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
                  rehypePlugins={[rehypeSanitize]}
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
