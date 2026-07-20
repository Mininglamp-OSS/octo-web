import React from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import type { PersonalWorkspaceStateRenderArgs } from "../bridge/types";

export default function PersonalWorkspaceState({
  status,
  title,
  desc,
}: PersonalWorkspaceStateRenderArgs) {
  const icon =
    status === "loading" ? <Loader2 size={36} /> : <AlertCircle size={40} />;

  return (
    <div className="loop-page">
      <div className="dmpersonal-state">
        <div className="dmpersonal-state__icon">{icon}</div>
        <div className="dmpersonal-state__title">{title}</div>
        {desc && <div className="dmpersonal-state__desc">{desc}</div>}
      </div>
    </div>
  );
}
