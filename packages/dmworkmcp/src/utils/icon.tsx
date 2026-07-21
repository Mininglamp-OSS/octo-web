import React from "react";

/**
 * Whether an icon string is a URL / data URL (image) rather than emoji/text.
 * Kept dumb-simple so a pasted image URL "just works": data: / http(s): / a
 * leading "/" wins; anything else is treated as text (emoji or short label).
 */
export function isImageIcon(icon: string | undefined): boolean {
  if (!icon) return false;
  return /^(data:|https?:\/\/|\/)/.test(icon);
}

/** Render an icon as <img> if it looks like a URL, else as the raw string. */
export function IconGlyph({
  icon,
  className,
  alt = "",
}: {
  icon: string;
  className?: string;
  alt?: string;
}) {
  if (isImageIcon(icon)) {
    return <img src={icon} alt={alt} className={className} />;
  }
  return <>{icon}</>;
}
