import React, { useState } from "react";
import { Tag } from "lucide-react";
import { useI18n } from "@octo/base";
import type { IssueLabel } from "../api/types";
import LabelChips from "./LabelChips";
import LabelManagementModal from "./LabelManagementModal";

export default function LabelEditor({
  issueId,
  labels,
  onChanged,
  className,
}: {
  issueId: string;
  labels?: IssueLabel[] | null;
  onChanged: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const [manageOpen, setManageOpen] = useState(false);
  const attachedLabels = labels ?? [];

  return (
    <>
      <div className={`loop-label-editor${className ? ` ${className}` : ""}`}>
        {attachedLabels.length > 0 ? (
          <button
            type="button"
            className="loop-label-chipbutton"
            onClick={() => setManageOpen(true)}
          >
            <LabelChips labels={attachedLabels} />
          </button>
        ) : (
          <button
            type="button"
            className="loop-label-add"
            onClick={() => setManageOpen(true)}
          >
            <Tag size={13} />
            {t("loop.label.add")}
          </button>
        )}
      </div>
      <LabelManagementModal
        visible={manageOpen}
        onClose={() => setManageOpen(false)}
        issueId={issueId}
        attachedLabelIds={attachedLabels.map((label) => label.id)}
        onChanged={() => {
          onChanged();
        }}
      />
    </>
  );
}
