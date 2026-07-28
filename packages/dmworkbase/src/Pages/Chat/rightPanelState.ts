import type { FilePreviewInfo } from "../../Components/FilePreviewPanel";
import type { Thread } from "../../Service/Thread";
import type { WebhookIssuePreviewTarget } from "../../bridge/message/webhookPreview";

export type ChatRightPanelKind =
  | "channelSetting"
  | "thread"
  | "summary"
  | "channelSearch"
  | "filePreview"
  | "webhookPreview";

export interface ChatRightPanelStatePatch {
  showChannelSetting: boolean;
  showThreadPanel: boolean;
  activeThread: Thread | null;
  previewFile: FilePreviewInfo | null;
  activePreviewMessageId: string | null;
  previewHadThreadShell: boolean;
  showSummaryPanel: boolean;
  showChannelSearch: boolean;
  channelSearchPreviewFile: FilePreviewInfo | null;
  previewReturnChannelSearch: boolean;
  webhookIssuePreviewTarget: WebhookIssuePreviewTarget | null;
}

const CLOSED_RIGHT_PANEL_STATE: ChatRightPanelStatePatch = {
  showChannelSetting: false,
  showThreadPanel: false,
  activeThread: null,
  previewFile: null,
  activePreviewMessageId: null,
  previewHadThreadShell: false,
  showSummaryPanel: false,
  showChannelSearch: false,
  channelSearchPreviewFile: null,
  previewReturnChannelSearch: false,
  webhookIssuePreviewTarget: null,
};

export function closeChatRightPanels(): ChatRightPanelStatePatch {
  return { ...CLOSED_RIGHT_PANEL_STATE };
}

export function openChatRightPanel(
  kind: ChatRightPanelKind,
  overrides: Partial<ChatRightPanelStatePatch> = {}
): ChatRightPanelStatePatch {
  const patch = closeChatRightPanels();

  switch (kind) {
    case "channelSetting":
      patch.showChannelSetting = true;
      break;
    case "thread":
      patch.showThreadPanel = true;
      break;
    case "summary":
      patch.showSummaryPanel = true;
      break;
    case "channelSearch":
      patch.showChannelSearch = true;
      break;
    case "filePreview":
      patch.showThreadPanel = true;
      break;
    case "webhookPreview":
      break;
  }

  return { ...patch, ...overrides };
}
