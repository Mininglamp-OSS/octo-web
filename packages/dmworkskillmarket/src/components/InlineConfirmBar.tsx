import React from "react";
import { AlertTriangle } from "lucide-react";
import { WKButton } from "@octo/base";

export interface InlineConfirmAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
  /** Disables the action while something else on the row is in flight. */
  disabled?: boolean;
  loading?: boolean;
}

/**
 * A confirmation that replaces a dialog's FOOTER instead of stacking a second
 * dialog on top of it.
 *
 * Stacking put a scrim over a scrim and hid the very thing the question was
 * about: "已上传的文件和填写的信息将丢失" covered up the file and the information
 * it was talking about. Swapping the footer keeps the form visible, so the
 * answer is made while looking at what is at stake, and there is only ever one
 * layer on screen.
 *
 * Use it for a yes/no decision about the dialog the user is already in. It is
 * NOT a replacement for a dialog that collects input (a reject reason) or drives
 * a task (the icon cropper) — those are their own step, not a question about
 * this one.
 */
export default function InlineConfirmBar({
  message,
  actions,
}: {
  message: string;
  actions: InlineConfirmAction[];
}) {
  return (
    <div className="skill-market-inline-confirm" role="alertdialog" aria-label={message}>
      <span className="skill-market-inline-confirm__message">
        <AlertTriangle size={15} aria-hidden="true" />
        {message}
      </span>
      <span className="skill-market-inline-confirm__actions">
        {actions.map((action) => (
          <WKButton
            key={action.label}
            variant={action.variant ?? "secondary"}
            onClick={action.onClick}
            disabled={action.disabled}
            loading={action.loading}
          >
            {action.label}
          </WKButton>
        ))}
      </span>
    </div>
  );
}
