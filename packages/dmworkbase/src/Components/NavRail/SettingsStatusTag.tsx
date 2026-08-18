import React from "react";
import "./SettingsStatusTag.css";

export type SettingsStatusTagTone = "success" | "attention" | "danger" | "neutral";

export interface SettingsStatusTagProps {
  tone: SettingsStatusTagTone;
  label: string;
}

/** A read-only semantic status indicator. Actions belong beside the tag. */
export default function SettingsStatusTag({ tone, label }: SettingsStatusTagProps) {
  return (
    <span className={`wk-settings-status-tag wk-settings-status-tag--${tone}`} role="status">
      <span>{label}</span>
    </span>
  );
}
