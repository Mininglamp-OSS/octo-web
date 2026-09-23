const FORBIDDEN_DISPLAY_NAME_CHARACTERS =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const FORBIDDEN_DISPLAY_NAME_CHARACTERS_GLOBAL = new RegExp(
  FORBIDDEN_DISPLAY_NAME_CHARACTERS.source, "g",
);

export function stripWorkspaceGroupDisplayControls(value: unknown): string {
  return typeof value === "string"
    ? value.replace(FORBIDDEN_DISPLAY_NAME_CHARACTERS_GLOBAL, "").trim()
    : "";
}

export function isWorkspaceGroupDisplayText(value: unknown): value is string {
  return typeof value === "string" && !FORBIDDEN_DISPLAY_NAME_CHARACTERS.test(value);
}

export function normalizeWorkspaceGroupDisplayName(value: unknown): string {
  const normalized = stripWorkspaceGroupDisplayControls(value);
  return normalized.length <= 256 ? normalized : "";
}

export function isWorkspaceGroupDisplayName(value: unknown): value is string {
  return isWorkspaceGroupDisplayText(value) && value.length <= 256;
}
