// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }));
import ThreadPanel, { type ThreadPanelProps } from "../index";
import type { FilePreviewInfo } from "../../FilePreviewPanel/types";
import type { ConversationFile } from "../../FilePreviewPanel/FilePreviewHeader";
import { parseMessageAttachmentLocator } from "../../../features/filePreview/attachmentHost";

type Reply = NonNullable<ThreadPanelProps["onReplyFile"]>;
interface ChildContext { replyToFileMessage?: Reply }
interface PanelActions {
  fileReplyAction(): (() => void) | undefined;
  handleChildContext(context: ChildContext): () => void;
  handleFileSelect(file: ConversationFile): void;
  forceUpdate(): void;
}
const file: FilePreviewInfo = {
  url: "https://cdn/report.txt", name: "report.txt", extension: "txt",
  sourceChannelId: "group____thread", sourceChannelType: 5,
  messageId: "9223372036854775807", messageSeq: 42, fromUID: "user",
  attachmentIndex: 0, conversationDigest: "report.txt",
};
const create = (props: Partial<ThreadPanelProps> = {}) => {
  const panel = new ThreadPanel({ onClose: vi.fn(), filePreview: file, ...props }) as unknown as PanelActions;
  panel.forceUpdate = vi.fn();
  return panel;
};
const expectedReply = {
  messageId: file.messageId, messageSeq: 42, fromUID: "user", conversationDigest: "report.txt",
  channelId: file.sourceChannelId, channelType: 5,
};

describe("thread attachment reply ownership", () => {
  it("disables a thread reply without a bound child even when a parent callback exists", () => {
    const parent = vi.fn<Reply>();
    const panel = create({ previewInThreadContext: true, onReplyFile: parent });
    expect(panel.fileReplyAction()).toBeUndefined();
    panel.handleChildContext({});
    expect(panel.fileReplyAction()).toBeUndefined();
    expect(parent).not.toHaveBeenCalled();
  });

  it("refreshes reply availability on bind/unbind and only replies through the bound child", () => {
    const parent = vi.fn<Reply>();
    const child = vi.fn<Reply>();
    const panel = create({ previewInThreadContext: true, onReplyFile: parent });
    const unbind = panel.handleChildContext({ replyToFileMessage: child });
    expect(panel.forceUpdate).toHaveBeenCalledTimes(1);
    const action = panel.fileReplyAction();
    expect(action).toBeTypeOf("function");
    action!();
    expect(child).toHaveBeenCalledExactlyOnceWith(expectedReply);
    expect(parent).not.toHaveBeenCalled();
    unbind();
    expect(panel.forceUpdate).toHaveBeenCalledTimes(2);
    expect(panel.fileReplyAction()).toBeUndefined();
    action!();
    expect(child).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
  });

  it("does not retarget an old reply to a replacement child or clear its binding", () => {
    const first = vi.fn<Reply>();
    const second = vi.fn<Reply>();
    const parent = vi.fn<Reply>();
    const panel = create({ previewInThreadContext: true, onReplyFile: parent });
    const unbindFirst = panel.handleChildContext({ replyToFileMessage: first });
    const staleAction = panel.fileReplyAction()!;
    panel.handleChildContext({ replyToFileMessage: second });
    unbindFirst();
    staleAction();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(parent).not.toHaveBeenCalled();
    panel.fileReplyAction()!();
    expect(second).toHaveBeenCalledExactlyOnceWith(expectedReply);
  });

  it("preserves normal parent replies and disables the action without a recipient", () => {
    const parent = vi.fn<Reply>();
    create({ onReplyFile: parent }).fileReplyAction()!();
    expect(parent).toHaveBeenCalledExactlyOnceWith(expectedReply);
    expect(create().fileReplyAction()).toBeUndefined();
  });
});

it("keeps a file-list selection eligible for the native attachment host", () => {
  const changed = vi.fn<NonNullable<ThreadPanelProps["onFilePreviewChange"]>>();
  const panel = create({ onFilePreviewChange: changed });
  panel.handleFileSelect({
    id: "123", messageSeq: 7, name: "next.txt", extension: "txt",
    url: "https://cdn/next.txt", size: 10, senderUid: "peer", category: "file",
  });
  const next = changed.mock.calls[0][0];
  expect(next).toBeTruthy();
  expect(parseMessageAttachmentLocator({
    kind: "message-attachment", channelId: next.sourceChannelId, channelType: next.sourceChannelType,
    messageId: next.messageId, messageSeq: next.messageSeq, attachmentIndex: next.attachmentIndex,
  })).toEqual({
    kind: "message-attachment", channelId: file.sourceChannelId, channelType: 5,
    messageId: "123", messageSeq: 7, attachmentIndex: 0,
  });
});
