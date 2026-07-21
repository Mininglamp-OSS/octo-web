// Hash-based color + text generation for skill default avatars.
// Adapted from GroupAvatarPreview/text.ts approach.

const AVATAR_COLORS = [
  "#34C759", // 绿
  "#6569E8", // 紫
  "#FA8C16", // 橙
  "#1AC4B3", // 青
  "#B3D600", // 黄绿
  "#5B9BF5", // 蓝
];

/** Hash full name to pick a stable color index. */
function hashName(name: string): number {
  let h = 0;
  for (const ch of name) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return h;
}

/** Get avatar background color for a skill name. */
export function getSkillAvatarColor(name: string): string {
  return AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
}

/** Check if character is wide (CJK/kana/hangul/fullwidth). */
function isWideChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xff00 && c <= 0xff60)
  );
}

/** Get visible characters (skip whitespace/control/zero-width). */
function visibleChars(s: string): string[] {
  const out: string[] = [];
  for (const ch of s) {
    if (!/\s/.test(ch)) out.push(ch);
  }
  return out;
}

/**
 * Extract display text for skill avatar:
 * - Contains CJK → first 2 wide chars
 * - All digits → first 2 digits
 * - Contains letters → up to 2 uppercase initials (split by - / _ / space)
 * - Otherwise → first char uppercase
 */
export function getSkillAvatarText(name: string): string {
  const chars = visibleChars(name);
  if (chars.length === 0) return "S";

  const wide = chars.filter(isWideChar);
  if (wide.length > 0) return wide.slice(0, 2).join("");

  if (chars.every((c) => /[0-9]/.test(c))) return chars.slice(0, 2).join("");

  if (chars.some((c) => /[a-zA-Z]/.test(c))) {
    // Split by common separators and take initials
    const parts = name.split(/[-_\s.]+/).filter(Boolean);
    const initials = parts
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join("");
    return initials || chars[0].toUpperCase();
  }

  return chars[0].toUpperCase();
}
