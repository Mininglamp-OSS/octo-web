import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { File as NodeFile } from "node:buffer";
import { IDBFactory } from "fake-indexeddb";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";
import { createTestViewHost } from "./testViewHost";
import { DraftDatabase } from "../../local-drafts/database";
import { ConversationDraftRepository } from "../../local-drafts/repository";
import { createBrowserAttachmentDraftPort } from "../../local-drafts/browserPort";
import { withConversationDocument } from "../../local-drafts/documentPort";
import { draftKey } from "../../local-drafts/model";
import { createChatSendOutcome, type ChatSendRequest } from "../../domain";

vi.mock("../../../../App", () => ({
  default: {
    mittBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    shared: { avatarChannel: vi.fn() },
    dataSource: { commonDataSource: { getImageURL: vi.fn(() => "") } },
  },
}));
vi.mock("react-virtuoso", () => ({ Virtuoso: () => null, TableVirtuoso: () => null }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const scope = { server: "test", account: "alice", space: "s" };
const channel = { id: "composer-attachment-membership", type: 2 };
const key = draftKey(scope, channel);

function fixture() {
  vi.stubGlobal("File", NodeFile);
  const factory = new IDBFactory();
  const client = () => {
    const database = new DraftDatabase(() => factory);
    const repository = new ConversationDraftRepository(database);
    const port = withConversationDocument(
      createBrowserAttachmentDraftPort(scope, channel, repository), scope, channel, repository,
    );
    return { database, repository, port };
  };
  return { client };
}

it("captures the file generation before publishing it to the Composer and preserves another window's replacement on Remove", async () => {
  const { client } = fixture();
  const original = client();
  const writes = vi.spyOn(original.database, "writeDraft");
  let context!: MessageInputContext;
  const view = render(<ChatComposer host={createTestViewHost(channel.id)} attachmentDrafts={original.port}
    onContext={next => { context = next; }} />);
  await waitFor(() => expect(context).toBeDefined());
  await act(async () => {
    await context.addAttachment([new File(["original bytes"], "report.txt")]);
    await original.port.flushDocument!();
  });
  const [attachment] = original.repository.records.get(key)!.draft.topAttachments;
  const revision = original.port.attachmentRevisions!().get(attachment.id)?.[0];
  expect(revision).toBeDefined();
  const firstMembershipWrite = writes.mock.calls.find(([record]) =>
    record.draft.topAttachments.some(item => item.id === attachment.id));
  // The first document mutation already needs a generation, before async stage
  // finishes, so an immediately removed attachment cannot outlive its intent.
  expect(firstMembershipWrite?.[4]?.get(attachment.id)).toEqual([revision]);

  const replacement = client();
  await replacement.port.restore();
  expect(await replacement.port.stage({
    id: attachment.id, file: new File(["replacement bytes"], "report.txt"), source: "upload",
  })).toBe(true);
  expect(replacement.port.attachmentRevisions!().get(attachment.id)).not.toContain(revision);
  writes.mockClear();

  fireEvent.click(view.getByRole("button", { name: /移除|Remove/ }));
  await waitFor(() => expect(context.getAttachmentFiles()).toEqual([]));
  await act(async () => {
    await original.port.flushDocument!();
    await original.repository.flush(key + ":files");
  });
  expect(writes.mock.calls.some(([record, , , , revisions]) =>
    record.draft.topAttachments.length === 0 && revisions?.get(attachment.id)?.includes(revision!))).toBe(true);
  const restored = await client().port.restore();
  expect(restored.attachments).toHaveLength(1);
  expect(await restored.attachments[0].file.text()).toBe("replacement bytes");
  expect(restored.pendingSendRecovery).toBeUndefined();
  view.unmount();
});

it("preserves a foreign same-ID replacement when a failed older send is retained and then removed", async () => {
  const { client } = fixture();
  const original = client();
  let context!: MessageInputContext;
  let releaseSend!: () => void;
  const sendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
  const onSend = vi.fn(async () => {
    await sendGate;
    return createChatSendOutcome();
  });
  const view = render(<ChatComposer host={createTestViewHost(channel.id)}
    attachmentDrafts={original.port} onSend={onSend}
    onContext={next => { context = next; }} />);
  await waitFor(() => expect(context).toBeDefined());
  await act(async () => {
    await context.addAttachment([new File(["original bytes"], "report.txt")]);
    await original.port.flushDocument!();
  });
  const [attachment] = original.repository.records.get(key)!.draft.topAttachments;

  let sending!: ReturnType<MessageInputContext["send"]>;
  act(() => { sending = context.send(); });
  await waitFor(() => expect(onSend).toHaveBeenCalledOnce());

  const replacement = client();
  await replacement.port.restore();
  expect(await replacement.port.stage({
    id: attachment.id,
    file: new File(["replacement bytes"], "report.txt"),
    source: "upload",
  })).toBe(true);

  await act(async () => {
    releaseSend();
    await sending;
  });
  await waitFor(() =>
    expect(context.getAttachmentFiles().map(file => file.name)).toEqual(["report.txt"])
  );
  let restored = await client().port.restore();
  expect(await restored.attachments[0].file.text()).toBe("replacement bytes");

  fireEvent.click(view.getByRole("button", { name: /移除|Remove/ }));
  await waitFor(() => expect(context.getAttachmentFiles()).toEqual([]));
  await act(async () => { await original.repository.flush(key + ":files"); });

  restored = await client().port.restore();
  expect(restored.attachments).toHaveLength(1);
  expect(await restored.attachments[0].file.text()).toBe("replacement bytes");
  view.unmount();
});

it.each([false, true])("retains unsent files after real send recovery writes fail and temporary mode is chosen (partial: %s)", async partial => {
  const { client } = fixture();
  const current = client();
  let context!: MessageInputContext;
  const onSend = vi.fn(async (request: ChatSendRequest) => {
    // The send wrapper has already committed the consumed snapshot. Only the
    // subsequent restoration writes fail, leaving its removal intents durable.
    expect(request.topFiles).toHaveLength(2);
    vi.spyOn(current.database, "writeDraft").mockRejectedValue(new DOMException("full", "QuotaExceededError"));
    return createChatSendOutcome({
      editorConsumed: partial,
      consumedTopIds: partial ? [request.topFiles![0].id] : [],
    });
  });
  const view = render(<ChatComposer host={createTestViewHost(channel.id)} attachmentDrafts={current.port}
    onSend={onSend} onContext={next => { context = next; }} />);
  await waitFor(() => expect(context).toBeDefined());
  await act(async () => {
    context.insertText("send with files");
    await context.addAttachment([
      new File(["first bytes"], "first.txt"), new File(["retry bytes"], "retry.txt"),
    ]);
    await current.port.flushDocument!();
  });
  await act(async () => { await context.send(); });
  expect(onSend).toHaveBeenCalledOnce();
  const names = partial ? ["retry.txt"] : ["first.txt", "retry.txt"];
  expect(context.getAttachmentFiles().map(file => file.name)).toEqual(names);
  expect(context.canLeaveWithAttachments()).toBe(false);
  fireEvent.click(await view.findByRole("button", { name: /使用临时草稿|Use temporary draft/ }));
  await waitFor(() => expect(context.canLeaveWithAttachments()).toBe(true));

  const restored = await client().port.restore();
  expect(restored.attachments.map(item => item.file.name)).toEqual(names);
  expect(await Promise.all(restored.attachments.map(item => item.file.text())))
    .toEqual(partial ? ["retry bytes"] : ["first bytes", "retry bytes"]);
  expect(restored.pendingSendRecovery).toBeUndefined();
  view.unmount();
});
