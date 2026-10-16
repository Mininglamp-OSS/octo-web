import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Conversation } from "../index";
import WKApp from "../../../App";
import ChatComposer, { type MessageInputContext } from "../../../features/chat-composer/ui/ChatComposer";
import { createTestViewHost } from "../../../features/chat-composer/ui/__tests__/testViewHost";
import { DraftDatabase } from "../../../features/chat-composer/local-drafts/database";
import { ConversationDraftRepository } from "../../../features/chat-composer/local-drafts/repository";
import { createBrowserAttachmentDraftPort } from "../../../features/chat-composer/local-drafts/browserPort";
import { withConversationDocument } from "../../../features/chat-composer/local-drafts/documentPort";
import { emptyConversationDraft } from "../../../features/chat-composer/local-drafts/model";

vi.mock("react-virtuoso", () => ({
  Virtuoso: () => null,
  TableVirtuoso: () => null,
  VirtuosoGrid: () => null,
}));

const originalDataSource = WKApp.dataSource;
afterEach(() => {
  WKApp.dataSource = originalDataSource;
  vi.restoreAllMocks();
});

const scope = { server: "legacy-migration", account: "alice", space: "s" };
const channel = { id: "migration", type: 2 };
const legacy = "existing unsent legacy draft";

function fixture() {
  const factory = new IDBFactory();
  const db = new DraftDatabase(() => factory);
  const repository = new ConversationDraftRepository(db);
  const drafts = withConversationDocument(
    createBrowserAttachmentDraftPort(scope, channel, repository), scope, channel, repository,
  );
  const remoteExtra = { draft: legacy, keepMessageSeq: 7, keepOffsetY: 13 };
  // Model the metadata backend as a replacement: omitting draft clears it too.
  // Preserving an unmigrated legacy value must therefore send that exact value.
  let serverDraft = legacy;
  const update = vi.fn(async (extra: { draft?: string }) => {
    serverDraft = extra.draft ?? "";
  });
  WKApp.dataSource = {
    channelDataSource: { conversationExtraUpdate: update },
    commonDataSource: { getImageURL: () => "" },
  } as any;
  const conversation = new Conversation({
    channel: { channelID: channel.id, channelType: channel.type } as any,
  });
  (conversation as any)._attachmentDrafts = drafts;
  (conversation as any).vm = {
    currentConversation: { remoteExtra },
    draft: () => remoteExtra.draft,
    messageContainerId: "migration-viewport",
    conversationLastMessageSeq: () => 0,
    markUnread: vi.fn(),
    releaseOpenConversationOwnership: vi.fn(),
  };
  let context: MessageInputContext | undefined;
  const mount = () => render(
    <ChatComposer
      host={createTestViewHost(channel.id)}
      attachmentDrafts={drafts}
      legacyDraft={(conversation as any).legacyComposerDraft()}
      onContext={next => {
        context = next;
        (conversation as any)._messageInputContext = next;
      }}
    />,
  );
  const leave = async () => {
    conversation.componentWillUnmount();
    await waitFor(() => expect(update).toHaveBeenCalled());
  };
  return { db, repository, drafts, remoteExtra, update, mount, leave,
    context: () => context, serverDraft: () => serverDraft };
}

describe("legacy migration through Composer restoration and Conversation teardown", () => {
  it("preserves the only legacy copy after failed read, temporary mode and leaving", async () => {
    const f = fixture();
    const read = vi.spyOn(f.repository, "load").mockRejectedValue(new Error("document read failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = f.mount();
    fireEvent.click(await view.findByRole("button", { name: /使用临时草稿|Use temporary draft/ }));
    await waitFor(() => expect(f.context()).toBeDefined());
    expect(f.context()!.text()).toBe("");
    act(() => f.context()!.insertText("temporary edit"));
    expect(await new ConversationDraftRepository(f.db).load(scope, channel)).toBeUndefined();

    await f.leave();

    expect(f.remoteExtra.draft).toBe(legacy);
    expect(f.serverDraft()).toBe(legacy);
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({
      draft: legacy, keepMessageSeq: 7, keepOffsetY: 13,
    }));
    view.unmount();
    read.mockRestore();
  });

  it("preserves legacy while its first local write fails and temporary mode abandons it", async () => {
    const f = fixture();
    vi.spyOn(f.db, "writeDraft").mockRejectedValue(new Error("document write failed"));
    const view = f.mount();
    await waitFor(() => expect(f.context()).toBeDefined());
    expect(f.context()!.text()).toBe(legacy);
    fireEvent.click(await view.findByRole("button", { name: /使用临时草稿|Use temporary draft/ }));
    expect(await new ConversationDraftRepository(f.db).load(scope, channel)).toBeUndefined();

    await f.leave();

    expect(f.remoteExtra.draft).toBe(legacy);
    expect(f.serverDraft()).toBe(legacy);
    view.unmount();
  });

  it("does not mistake a restored optimistic cache from a failed write for a durable document", async () => {
    const f = fixture();
    vi.spyOn(f.db, "writeDraft").mockRejectedValue(new Error("document write failed"));
    const unsaved = {
      ...emptyConversationDraft(),
      document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "unsaved cached draft" }] }] },
    };
    await expect(f.repository.save(scope, channel, unsaved)).rejects.toThrow("document write failed");
    expect(await f.repository.load(scope, channel)).toEqual(unsaved);
    const view = f.mount();
    await waitFor(() => expect(f.context()).toBeDefined());
    expect(f.context()!.text()).toBe("unsaved cached draft");
    fireEvent.click(await view.findByRole("button", { name: /使用临时草稿|Use temporary draft/ }));
    expect(await new ConversationDraftRepository(f.db).load(scope, channel)).toBeUndefined();

    await f.leave();

    expect(f.serverDraft()).toBe(legacy);
    view.unmount();
  });

  it("clears remote metadata after the imported legacy document commits locally", async () => {
    const f = fixture();
    const view = f.mount();
    await waitFor(() => expect(f.context()).toBeDefined());
    await act(async () => { await f.drafts.flushDocument!(); });
    const durable = await new ConversationDraftRepository(f.db).load(scope, channel);
    expect(JSON.stringify(durable)).toContain(legacy);

    await f.leave();

    expect(f.remoteExtra.draft).toBe("");
    expect(f.serverDraft()).toBe("");
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ draft: "" }));
    view.unmount();
  });

  it.each([false, true])("does not acknowledge a pending initial write before leaving (aborted: %s)", async aborted => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const write = f.db.writeDraft.bind(f.db);
    const pending = vi.spyOn(f.db, "writeDraft").mockImplementation(async (...args) => {
      await gate;
      await write(...args);
    });
    const view = f.mount();
    await waitFor(() => expect(f.context()).toBeDefined());
    await waitFor(() => expect(pending).toHaveBeenCalled());
    expect(f.context()!.text()).toBe(legacy);
    expect(await new ConversationDraftRepository(f.db).load(scope, channel)).toBeUndefined();
    if (aborted) f.drafts.stopDocumentSaving!();

    await f.leave();

    expect(f.serverDraft()).toBe(legacy);
    await act(async () => {
      release();
      await f.drafts.flushDocument!();
    });
    // A cancelled save resolves too, but only a committed import authorizes
    // clearing the retained remote copy on a later metadata update.
    expect(f.drafts.hasDurableDocument!()).toBe(!aborted);
    const durable = await new ConversationDraftRepository(f.db).load(scope, channel);
    if (aborted) expect(durable).toBeUndefined();
    else expect(JSON.stringify(durable)).toContain(legacy);
    view.unmount();
  });

  it("clears legacy only after a failed first write is retried successfully", async () => {
    const f = fixture();
    const write = vi.spyOn(f.db, "writeDraft").mockRejectedValue(new Error("document write failed"));
    const view = f.mount();
    await waitFor(() => expect(f.context()).toBeDefined());
    const retry = await view.findByRole("button", { name: /重试保存|Retry saving/ });
    write.mockRestore();
    fireEvent.click(retry);
    await act(async () => { await f.drafts.flushDocument!(); });
    expect(JSON.stringify(await new ConversationDraftRepository(f.db).load(scope, channel))).toContain(legacy);

    await f.leave();

    expect(f.serverDraft()).toBe("");
    view.unmount();
  });

  it("keeps a previously durable empty local draft authoritative over stale legacy text", async () => {
    const f = fixture();
    await f.repository.save(scope, channel, emptyConversationDraft());
    const view = f.mount();
    await waitFor(() => expect(f.context()).toBeDefined());
    expect(f.context()!.text()).toBe("");

    await f.leave();

    expect(f.serverDraft()).toBe("");
    view.unmount();
  });

  it("does not revoke a durable local tombstone when a later edit fails and becomes temporary", async () => {
    const f = fixture();
    await f.repository.save(scope, channel, emptyConversationDraft());
    const view = f.mount();
    await waitFor(() => expect(f.context()).toBeDefined());
    expect(f.context()!.text()).toBe("");
    vi.spyOn(f.db, "writeDraft").mockRejectedValue(new Error("later write failed"));
    act(() => f.context()!.insertText("temporary newer edit"));
    fireEvent.click(await view.findByRole("button", { name: /使用临时草稿|Use temporary draft/ }));

    await f.leave();

    expect(f.serverDraft()).toBe("");
    expect(await new ConversationDraftRepository(f.db).load(scope, channel)).toEqual(emptyConversationDraft());
    view.unmount();
  });

  it("does not reuse a durable acknowledgement after the local account session is revoked", async () => {
    const f = fixture();
    const view = f.mount();
    await waitFor(() => expect(f.context()).toBeDefined());
    await act(async () => { await f.drafts.flushDocument!(); });
    expect(f.drafts.hasDurableDocument!()).toBe(true);
    await f.repository.clearAccount(scope);
    expect(f.drafts.hasDurableDocument!()).toBe(false);

    await f.leave();

    expect(f.serverDraft()).toBe(legacy);
    view.unmount();
  });
});
