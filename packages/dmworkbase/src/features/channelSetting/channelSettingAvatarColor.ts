export function parseAvatarColorIndex(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }

  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;

  const colorIndex = Number(trimmed);
  return Number.isInteger(colorIndex) && colorIndex >= 0 ? colorIndex : undefined;
}
