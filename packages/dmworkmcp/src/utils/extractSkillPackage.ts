import JSZip from "jszip";

/**
 * Client-side extraction of a Skill package (.zip / .skill) into the single
 * SKILL.md document an expert skill stores. Mirrors the Skills-marketplace
 * upload contract ("包内需包含 SKILL.md"): the package is a zip whose payload is
 * a SKILL.md; the expert backend has no async parse pipeline, so we unzip in the
 * browser and send the extracted markdown text inline (2B object-storage path).
 */

/** Accepted package extensions (case-insensitive). Matches the skills market. */
export const SKILL_PACKAGE_ACCEPT = ".zip,.skill";

/** Max size of the uploaded package. Mirrors the skills market's 20 MiB cap. */
export const MAX_SKILL_PACKAGE_BYTES = 20 * 1024 * 1024;

/** Max size of the extracted SKILL.md text — matches the backend write cap. */
export const MAX_SKILL_CONTENT_BYTES = 1 << 20; // 1 MiB

/** Stable codes so the caller can localize; message is a non-localized fallback. */
export type SkillPackageErrorCode =
  | "invalidFormat"
  | "fileTooLarge"
  | "noSkillMd"
  | "contentTooLarge"
  | "readFailed";

export class SkillPackageError extends Error {
  code: SkillPackageErrorCode;
  constructor(code: SkillPackageErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SkillPackageError";
    this.code = code;
  }
}

export interface ExtractedSkill {
  /** Skill name: SKILL.md frontmatter `name`, else the package filename stem. */
  name: string;
  /** The SKILL.md text. */
  content: string;
  /** Manifest of regular-file paths inside the package (dirs excluded). */
  files: string[];
}

/** UTF-8 byte length without allocating an intermediate encoder per call site. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Read the value of a top-level `name:` key from a leading YAML frontmatter
 *  block (`---\n…\n---`). Returns "" when absent. */
function frontmatterName(md: string): string {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(md);
  if (!match) return "";
  for (const rawLine of match[1].split(/\r?\n/)) {
    const idx = rawLine.indexOf(":");
    if (idx <= 0) continue;
    if (rawLine.slice(0, idx).trim() !== "name") continue;
    return rawLine
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
  }
  return "";
}

/** Filename without directories or the final extension. */
function fileStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.[^.]+$/, "") || base;
}

/**
 * Validate and unzip a Skill package, returning the SKILL.md name + content.
 * Throws {@link SkillPackageError} on any invalid input so the caller can show a
 * localized, per-file error instead of failing silently.
 */
export async function extractSkillPackage(file: File): Promise<ExtractedSkill> {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".zip") && !lower.endsWith(".skill")) {
    throw new SkillPackageError("invalidFormat");
  }
  if (file.size > MAX_SKILL_PACKAGE_BYTES) {
    throw new SkillPackageError("fileTooLarge");
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new SkillPackageError("readFailed");
  }

  // Find SKILL.md case-insensitively; prefer the shallowest match (root over a
  // nested folder) so a package with one canonical SKILL.md resolves cleanly.
  // Collect the file manifest (regular files only) for the detail file list.
  let target: JSZip.JSZipObject | null = null;
  let targetDepth = Infinity;
  const files: string[] = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    files.push(path);
    const base = path.split("/").pop() ?? path;
    if (base.toLowerCase() !== "skill.md") return;
    const depth = path.split("/").length;
    if (depth < targetDepth) {
      target = entry;
      targetDepth = depth;
    }
  });
  if (!target) {
    throw new SkillPackageError("noSkillMd");
  }

  let content: string;
  try {
    content = await (target as JSZip.JSZipObject).async("string");
  } catch {
    throw new SkillPackageError("readFailed");
  }

  if (byteLength(content) > MAX_SKILL_CONTENT_BYTES) {
    throw new SkillPackageError("contentTooLarge");
  }

  const name = frontmatterName(content) || fileStem(file.name);
  return { name, content, files };
}
