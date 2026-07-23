import React from "react";
import { Check } from "lucide-react";
import { LABEL_PALETTE, normalizeLabelColor } from "./labelPalette";

export default function LabelColorPicker({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (color: string) => void;
  ariaLabel: string;
}) {
  const selected = normalizeLabelColor(value);
  return (
    <div className="loop-label-color" role="radiogroup" aria-label={ariaLabel}>
      {LABEL_PALETTE.map((color) => {
        const active = selected.toLowerCase() === color.toLowerCase();
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={active}
            className={`loop-label-color__swatch${active ? " is-active" : ""}`}
            style={{ "--loop-chip-color": color } as React.CSSProperties}
            onClick={() => onChange(color)}
            title={color}
          >
            {active && <Check size={12} strokeWidth={2.5} />}
          </button>
        );
      })}
    </div>
  );
}
