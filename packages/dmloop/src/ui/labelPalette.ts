// Low-saturation label colors for long-lived task chips.
// Keep values as strict #RRGGBB hex because the backend validates this shape.
export const LABEL_PALETTE = [
  "#6B7280",
  "#7E6F8F",
  "#8A6F78",
  "#8B7A5E",
  "#6F846B",
  "#5E8078",
  "#657C9A",
  "#8D7467",
  "#77806B",
  "#7A778A",
] as const;

export const DEFAULT_LABEL_COLOR = LABEL_PALETTE[0];

export function normalizeLabelColor(color?: string | null): string {
  return /^#[0-9a-fA-F]{6}$/.test(color ?? "")
    ? (color as string)
    : DEFAULT_LABEL_COLOR;
}
