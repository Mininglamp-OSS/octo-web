import type { ReactNode } from "react";

export interface HtmlAttachmentPreviewPageProps {
  name: string;
  viewMode: "preview" | "source";
  onViewModeChange: (mode: "preview" | "source") => void;
  download?: { pending: boolean; onClick: () => void };
  error?: string;
  onReturn: () => void;
  children?: ReactNode;
}
