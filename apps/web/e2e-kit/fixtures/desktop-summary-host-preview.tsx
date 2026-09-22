import React, { useEffect, useState } from "react";
import { Channel } from "wukongimjssdk";
import { WKApp, WKLayout } from "@octo/base";
import { ChatContentPage } from "../../../../packages/dmworkbase/src/Pages/Chat";
import {
  notifyHostAttachmentClosed,
  setWebAttachmentHost,
} from "../../../../packages/dmworkbase/src/features/filePreview/attachmentHost";
import ChatSummaryPanel from "../../../../packages/dmworksummary/src/components/ChatSummaryPanel";
import "../../src/client-communication/index.css";

if (!import.meta.env.DEV) throw new Error("Test fixture requires a development server");

const channel = new Channel("fixture-channel", 2);
let activeRequestId = "";

class FixtureChat extends ChatContentPage {
  render() {
    const tree = super.render();
    if (!React.isValidElement<React.HTMLAttributes<HTMLDivElement>>(tree)) {
      throw new Error("Missing chat root");
    }
    // Replace only message transport/rendering. Panel state, bridge lifecycle,
    // layout attributes and the Summary subtree come from ChatContentPage.
    const children = React.Children.map(tree.props.children, child => {
      if (!React.isValidElement<{ conversationProps?: unknown }>(child) || !child.props.conversationProps) {
        return child;
      }
      return (
        <div className="wk-chat-content-chat">
          <div data-desktop-chrome="header">Conversation</div>
          <button data-testid="fixture-summary-open" onClick={() => WKApp.mittBus.emit("wk:toggle-summary-panel", {
            channelId: channel.channelID, channelType: channel.channelType, summaryPanelView: "new",
          })}>Open summary</button>
          <button data-testid="fixture-attachment" onClick={() => WKApp.mittBus.emit("wk:file-preview", {
            url: "https://example.com/report.pdf", name: "report.pdf", extension: "pdf",
            sourceChannelId: channel.channelID, sourceChannelType: channel.channelType,
            messageId: "123456789012345678", messageSeq: 42, attachmentIndex: 0,
          })}>report.pdf</button>
          <button data-testid="fixture-preview-close" onClick={() => notifyHostAttachmentClosed(activeRequestId)}>
            Close preview
          </button>
          <input aria-label="Conversation draft" />
        </div>
      );
    });
    return React.cloneElement(tree, { style: { width: "100%", height: "100%" } }, children);
  }
}

export default function HostPreviewFixture({ width, clientShell = false }: { width: number; clientShell?: boolean }) {
  const [presentation, setPresentation] = useState("conversation");
  useEffect(() => {
    const previousSummary = WKApp.endpoints.chatSummaryPanel;
    WKApp.endpoints.chatSummaryPanel = (summaryChannel, onClose, summaryPanelView) => (
      <ChatSummaryPanel visible channel={summaryChannel} onClose={onClose} summaryPanelView={summaryPanelView} />
    );
    setWebAttachmentHost({
      openFilePreview: async request => {
        activeRequestId = request.requestId;
        return { status: "accepted" };
      },
      cancelFilePreview: async () => { activeRequestId = ""; },
    });
    return () => {
      setWebAttachmentHost(null);
      WKApp.endpoints.chatSummaryPanel = previousSummary;
    };
  }, []);
  if (clientShell) {
    return (
      <div className={`communication-shell communication-shell--${presentation}`}>
        <button data-testid="fixture-presentation" style={{ position: "absolute", bottom: 0, left: 0, zIndex: 1000 }}
          onClick={() => setPresentation(value => value === "conversation" ? "workspace" : "conversation")}>
          Change presentation
        </button>
        <WKLayout
          embedded
          contentMinWidth={presentation === "conversation" ? undefined : 432}
          contentLeft={<div>Web conversation list</div>}
          contentRight={<div />}
          onRightContext={context => context.replaceToRoot(<FixtureChat channel={channel} />)}
        />
      </div>
    );
  }
  return (
    <div style={{ width: `min(100%, ${width + 432}px)`, marginLeft: "auto", height: "100%" }}>
      <FixtureChat channel={channel} />
    </div>
  );
}
