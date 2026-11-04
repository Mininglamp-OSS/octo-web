import React from "react";
import { t } from "@octo/base";

/** The label must come from target_version_id's snapshot, never live metadata. */
export default function BoundVersionBadge({ versionId, version }: { versionId?: string; version?: string }) {
  return <span className="wk-mcp-bound-version" title={versionId}>
    {versionId
      ? version ? (/^v/i.test(version) ? version : `v${version}`) : t("mcp.expert.versionPinned")
      : t("mcp.expert.versionUnpinned")}
  </span>;
}
