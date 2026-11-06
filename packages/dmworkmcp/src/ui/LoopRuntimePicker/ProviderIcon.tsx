import React from "react";
import { Cloud, Terminal } from "lucide-react";
// Brand assets reused from octo-loop-module / octo-multica (Apache-2.0).
import claude from "./assets/claude.svg";
import codebuddy from "./assets/codebuddy.svg";
import codex from "./assets/codex.svg";
import opencode from "./assets/opencode.svg";
import openclaw from "./assets/openclaw.svg";
import pi from "./assets/pi.svg";
import copilot from "./assets/copilot.svg";
import cursor from "./assets/cursor.svg";
import kimi from "./assets/kimi.svg";
import kiro from "./assets/kiro.svg";
import qoder from "./assets/qoder.svg";
import hermes from "./assets/hermes.webp";
const icons: Record<string, { source: string; monochrome: boolean }> = {
  claude: { source: claude, monochrome: false },
  codebuddy: { source: codebuddy, monochrome: false },
  codex: { source: codex, monochrome: true },
  opencode: { source: opencode, monochrome: false },
  openclaw: { source: openclaw, monochrome: false },
  pi: { source: pi, monochrome: false },
  copilot: { source: copilot, monochrome: true },
  cursor: { source: cursor, monochrome: false },
  kimi: { source: kimi, monochrome: false },
  kiro: { source: kiro, monochrome: false },
  qoder: { source: qoder, monochrome: true },
  hermes: { source: hermes, monochrome: false },
};

export function ProviderIcon({
  provider,
  cloud,
}: {
  provider: string;
  cloud: boolean;
}) {
  const key = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  const icon = Object.prototype.hasOwnProperty.call(icons, key)
    ? icons[key]
    : undefined;
  const className = "wk-loop-runtime-picker__provider";
  if (!icon) {
    const Fallback = cloud ? Cloud : Terminal;
    return <Fallback className={className} aria-hidden />;
  }
  return icon.monochrome ? (
    <span
      aria-hidden
      data-provider={key}
      className={`${className} is-mask`}
      style={{
        maskImage: `url("${icon.source}")`,
        WebkitMaskImage: `url("${icon.source}")`,
      }}
    />
  ) : (
    <img
      aria-hidden
      data-provider={key}
      src={icon.source}
      alt=""
      className={className}
    />
  );
}
