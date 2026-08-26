// Hash-based color + text generation for MCP default avatars, used when
// item.icon is empty. Mirrors dmworkskillmarket's skillAvatar.ts approach
// but keys color off `id` (per issue #1009 clarification) so two MCPs with
// the same display name still get distinct backgrounds.

const AVATAR_COLORS = [
  "#34C759", // 绿
  "#6569E8", // 紫
  "#FA8C16", // 橙
  "#1AC4B3", // 青
  "#B3D600", // 黄绿
  "#5B9BF5", // 蓝
];

function hashString(s: string): number {
  let h = 0;
  for (const ch of s) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return h;
}

/** Deterministic background color for an MCP with no icon. Keyed on id
 *  (not name) so duplicate-named rows still get distinct swatches. */
export function getMcpAvatarColor(id: string): string {
  return AVATAR_COLORS[hashString(id || "") % AVATAR_COLORS.length];
}

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

function visibleChars(s: string): string[] {
  const out: string[] = [];
  for (const ch of s) {
    if (!/\s/.test(ch)) out.push(ch);
  }
  return out;
}

/**
 * Extract 1-2 display chars for the MCP avatar fallback:
 *   - Contains CJK → first 2 wide chars
 *   - All digits → first 2 digits
 *   - Contains letters → up to 2 uppercase initials (split on `- _ . space`)
 *   - Otherwise → first char uppercase
 */
export function getMcpAvatarText(name: string): string {
  const chars = visibleChars(name);
  if (chars.length === 0) return "M";

  const wide = chars.filter(isWideChar);
  if (wide.length > 0) return wide.slice(0, 2).join("");

  if (chars.every((c) => /[0-9]/.test(c))) return chars.slice(0, 2).join("");

  if (chars.some((c) => /[a-zA-Z]/.test(c))) {
    const parts = name.split(/[-_\s.]+/).filter(Boolean);
    const initials = parts
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join("");
    return initials || chars[0].toUpperCase();
  }

  return chars[0].toUpperCase();
}
