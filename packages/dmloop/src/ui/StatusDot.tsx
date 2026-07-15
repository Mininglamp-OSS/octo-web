import React from "react";
import { useI18n } from "@octo/base";
import { normalizeAgentStatus } from "./meta";

export function StatusDot({ status, className, decorative }: { status?: string; className?: string; decorative?: boolean }) {
  const { t } = useI18n();
  const s = normalizeAgentStatus(status);
  const cls = `loop-status-dot${className ? ` ${className}` : ""}`;
  if (decorative) {
    return <i className={cls} data-status={s} aria-hidden="true" />;
  }
  const label = t(`loop.agentStatus.${s}`);
  return <i className={cls} data-status={s} role="img" title={label} aria-label={label} />;
}
