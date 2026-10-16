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
import { createChatSendOutcome, type ChatSendRequest } from "../../domain";

vi.mock("../../../../Components/WKModal/confirm", () => ({
  wkConfirm: vi.fn(),
}));
vi.mock("../../../../App", () => ({
  default: {
    mittBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    shared: { avatarChannel: vi.fn() },
    dataSource: { commonDataSource: { getImageURL: vi.fn(() => "") } },
  },
}));
vi.mock("react-virtuoso", () => ({
  Virtuoso: () => null,
  TableVirtuoso: () => null,
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const scope = { server: "test", account: "alice", space: "s" };
function fixture() {
  vi.stubGlobal("File", NodeFile);
  const factory = new IDBFactory();
  const connections: IDBDatabase[] = [];
  const open = factory.open.bind(factory);
  vi.spyOn(factory, "open").mockImplementation((...args) => {
    const request = open(...args);
    request.addEventListener("success", () => connections.push(request.result));
    return request;
  });
  const db = new DraftDatabase(() => factory);
  const repository = new ConversationDraftRepository(db);
  const port = (id: string, repo = repository) =>
    withConversationDocument(
      createBrowserAttachmentDraftPort(scope, { id, type: 2 }, repo),
      scope,
      { id, type: 2 },
      repo
    );
  return { db, repository, port, factory, connections };
}

import { draftKey, type DraftRecord } from "../../local-drafts/model";

it("never restores or sends a removed file from a fresh repository after deletion failure", async () => {
  const { db, repository, port } = fixture();
  const drafts = port("a");
  let context!: MessageInputContext;
  const first = render(
    <ChatComposer
      host={createTestViewHost("a")}
      attachmentDrafts={drafts}
      onContext={(next) => {
        context = next;
      }}
    />
  );
  await waitFor(() => expect(context).toBeDefined());
  await act(async () => {
    await context.addAttachment([new File(["zip"], "deleted.zip")]);
  });
  await waitFor(() =>
    expect(
      drafts.canLeave(
        [...repository.records.values()][0].draft.topAttachments.map(
          (item) => item.id
        )
      )
    ).toBe(true)
  );
  const original = db.changeAttachments.bind(db);
  vi.spyOn(db, "changeAttachments").mockImplementation((key, change, session) =>
    original(
      key,
      (records) => {
        const next = change(records);
        if (next.length < records.length)
          throw new Error("attachment deletion failed");
        return next;
      },
      session
    )
  );
  const remove = first
    .getAllByRole("button")
    .find((button) =>
      /移除|Remove/.test(button.getAttribute("aria-label") ?? "")
    );
  fireEvent.click(remove!);
  await waitFor(() => expect(context.getAttachmentFiles()).toEqual([]));
  await act(async () => {
    await drafts.flushDocument!();
  });
  const key = draftKey(scope, { id: "a", type: 2 });
  expect(
    (await db.read<DraftRecord>("drafts", key))!.draft.topAttachments
  ).toEqual([]);
  expect(await db.list("attachments", "conversation", key)).toHaveLength(1);
  expect(drafts.canLeave([])).toBe(false);
  let restored!: MessageInputContext;
  const onSend = vi.fn(async () => createChatSendOutcome());
  const second = render(
    <ChatComposer
      host={createTestViewHost("a")}
      attachmentDrafts={port("a", new ConversationDraftRepository(db))}
      onSend={onSend}
      onContext={(next) => {
        restored = next;
      }}
    />
  );
  await waitFor(() => expect(restored).toBeDefined());
  expect(restored.getAttachmentFiles()).toEqual([]);
  act(() => restored.insertText("safe text"));
  await act(async () => {
    await restored.send();
  });
  expect(onSend).toHaveBeenCalledWith(
    expect.objectContaining({ topFiles: undefined })
  );
  first.unmount();
  second.unmount();
});

it("retries a transient restore failure and enables typing and sending", async () => {
  const { port } = fixture();
  const drafts = port("a");
  const restore = vi
    .spyOn(drafts, "restore")
    .mockRejectedValueOnce(new Error("transient read failure"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let context: MessageInputContext | undefined;
  const onSend = vi.fn(async () => createChatSendOutcome());
  const view = render(
    <ChatComposer
      host={createTestViewHost("a")}
      attachmentDrafts={drafts}
      onSend={onSend}
      onContext={(next) => {
        context = next;
      }}
    />
  );
  const retry = await view.findByRole("button", {
    name: /重新读取|Retry loading/,
  });
  expect(context).toBeUndefined();
  expect(
    view.container.querySelector(".tiptap")?.getAttribute("contenteditable")
  ).toBe("false");
  fireEvent.click(retry);
  await waitFor(() => expect(context).toBeDefined());
  expect(restore).toHaveBeenCalledTimes(2);
  expect(
    view.container.querySelector(".tiptap")?.getAttribute("contenteditable")
  ).toBe("true");
  act(() => context!.insertText("after retry"));
  await act(async () => {
    await context!.send();
  });
  expect(onSend).toHaveBeenCalledOnce();
  view.unmount();
});

it("sends in temporary mode without modifying unread saved drafts or attachments", async () => {
  const { db, port } = fixture();
  const drafts = port("a");
  await drafts.stage({
    id: "saved",
    file: new File(["saved"], "saved.zip"),
    source: "upload",
  });
  await drafts.saveDocument!({
    document: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "saved text" }] },
      ],
    },
    topAttachments: [{ id: "saved", name: "saved.zip", position: 1 }],
  });
  const key = draftKey(scope, { id: "a", type: 2 });
  const before = await db.read<DraftRecord>("drafts", key);
  const fail = vi
    .spyOn(drafts, "restore")
    .mockRejectedValue(new Error("storage unavailable"));
  const save = vi.spyOn(drafts, "saveDocument");
  const stage = vi.spyOn(drafts, "stage");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let context: MessageInputContext | undefined;
  const onSend = vi.fn(async () =>
    createChatSendOutcome({ editorConsumed: true })
  );
  const view = render(
    <ChatComposer
      host={createTestViewHost("a")}
      attachmentDrafts={drafts}
      onSend={onSend}
      onContext={(next) => {
        context = next;
      }}
    />
  );
  fireEvent.click(
    await view.findByRole("button", {
      name: /使用临时草稿|Use temporary draft/,
    })
  );
  await waitFor(() => expect(context).toBeDefined());
  act(() => context!.insertText("temporary text"));
  await act(async () => {
    await context!.addAttachment([new File(["new"], "temporary.zip")]);
    await context!.send();
  });
  expect(onSend).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(stage).not.toHaveBeenCalled();
  expect(await db.read("drafts", key)).toEqual(before);
  expect(await db.list("attachments", "conversation", key)).toHaveLength(1);
  view.unmount();
  fail.mockRestore();
  const restored = await port(
    "a",
    new ConversationDraftRepository(db)
  ).restore();
  expect(restored.document).toEqual(before!.draft);
  expect(restored.attachments.map((item) => item.file.name)).toEqual([
    "saved.zip",
  ]);
});

it("keeps the visible retry action fenced after failed generation capture and other-window logout", async () => {
  const { db, port } = fixture();
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(db, "session").mockRejectedValueOnce(new Error("session read failed"));
  const drafts = port("a");
  let context: MessageInputContext | undefined;
  const view = render(<ChatComposer host={createTestViewHost("a")} attachmentDrafts={drafts}
    onContext={next => { context = next; }} />);
  const retry = await view.findByRole("button", { name: /重新读取|Retry loading/ });
  await new ConversationDraftRepository(db).clearAccount(scope);
  fireEvent.click(retry);
  await view.findByRole("button", { name: /重新读取|Retry loading/ });
  expect(context).toBeUndefined();
  expect(view.container.querySelector(".tiptap")?.getAttribute("contenteditable")).toBe("false");
  expect(await db.list("drafts", "account", JSON.stringify([scope.server, scope.account]))).toEqual([]);
  expect(await drafts.stage({ id: "revoked", file: new File(["x"], "revoked.zip"), source: "upload" })).toBe(false);
  view.unmount();
});

it("preserves a failed temporary send and consumes the durable copy after success", async () => {
  const { db, port } = fixture();
  const drafts = port("a");
  let context!: MessageInputContext;
  const onSend = vi.fn(async () => createChatSendOutcome({ editorConsumed: true }));
  const view = render(<ChatComposer host={createTestViewHost("a")} attachmentDrafts={drafts}
    onSend={onSend} onContext={next => { context = next; }} />);
  await waitFor(() => expect(context).toBeDefined());
  act(() => context.insertText("saved text"));
  await act(async () => { await drafts.flushDocument!(); });
  const key = draftKey(scope, { id: "a", type: 2 });
  const saved = await db.read<DraftRecord>("drafts", key);
  vi.spyOn(db, "writeDraft").mockRejectedValue(new DOMException("full", "QuotaExceededError"));
  act(() => context.insertText(" current edit"));
  const temporary = await view.findByRole("button", { name: /使用临时草稿|Use temporary draft/ });
  await act(async () => { await context.send(); });
  expect(onSend).not.toHaveBeenCalled();
  expect(context.canLeaveWithAttachments()).toBe(false);
  const liveText = view.container.querySelector(".tiptap")!.textContent;
  fireEvent.click(temporary);
  await waitFor(() => expect(context.canLeaveWithAttachments()).toBe(true));
  expect(view.container.querySelector(".tiptap")!.textContent).toBe(liveText);
  onSend.mockRejectedValueOnce(new Error("network offline"));
  await act(async () => { await context.send(); });
  expect(view.container.querySelector(".tiptap")!.textContent).toBe(liveText);
  expect(await db.read("drafts", key)).toEqual(saved);
  await act(async () => { await context.send(); });
  expect(onSend).toHaveBeenCalledTimes(2);
  expect(view.container.querySelector(".tiptap")!.textContent).toBe("");
  expect(await db.read<DraftRecord>("drafts", key)).toMatchObject({
    revision: saved!.revision + 1,
    consumed: true,
    preview: "",
    draft: { topAttachments: [] },
  });
  view.unmount();
  let restored: MessageInputContext | undefined;
  const reopened = render(<ChatComposer host={createTestViewHost("a")}
    legacyDraft="saved text" attachmentDrafts={port("a", new ConversationDraftRepository(db))}
    onContext={next => { restored = next; }} />);
  await waitFor(() => expect(restored).toBeDefined());
  expect(reopened.container.querySelector(".tiptap")!.textContent).toBe("");
  reopened.unmount();
});

it("preserves a replacement draft when an older temporary send settles late", async () => {
  const { db, port } = fixture();
  const seed = port("a");
  await seed.saveDocument!({
    document: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "original" }] }],
    },
    topAttachments: [],
  });
  const first = port("a", new ConversationDraftRepository(db));
  await first.restore();
  first.stopDocumentSaving!();

  let releaseSend!: (outcome: ReturnType<typeof createChatSendOutcome>) => void;
  let sendStarted!: () => void;
  const heldSend = new Promise<ReturnType<typeof createChatSendOutcome>>(resolve => {
    releaseSend = resolve;
  });
  const started = new Promise<void>(resolve => {
    sendStarted = resolve;
  });
  const onSend = vi.fn(() => {
    sendStarted();
    return heldSend;
  });
  const late = port("a", new ConversationDraftRepository(db));
  let context!: MessageInputContext;
  const view = render(<ChatComposer host={createTestViewHost("a")}
    attachmentDrafts={late} onSend={onSend}
    onContext={next => { context = next; }} />);
  await waitFor(() => expect(context).toBeDefined());
  const failedWrite = vi.spyOn(db, "writeDraft").mockRejectedValueOnce(
    new DOMException("full", "QuotaExceededError")
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  act(() => context.insertText(" pending"));
  const temporary = await view.findByRole("button", {
    name: /使用临时草稿|Use temporary draft/,
  });
  fireEvent.click(temporary);
  let sending!: ReturnType<MessageInputContext["send"]>;
  await act(async () => {
    sending = context.send();
    await started;
  });

  await first.consumeStoppedDocument!();
  const replacement = new ConversationDraftRepository(db);
  await replacement.load(scope, { id: "a", type: 2 });
  await replacement.save(scope, { id: "a", type: 2 }, {
    document: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "replacement" }] }],
    },
    topAttachments: [],
  });
  failedWrite.mockRestore();
  await act(async () => {
    releaseSend(createChatSendOutcome({ editorConsumed: true }));
    await sending;
  });

  expect(onSend).toHaveBeenCalledOnce();
  expect(
    await new ConversationDraftRepository(db).load(scope, { id: "a", type: 2 })
  ).toMatchObject({
    document: {
      content: [{ content: [{ text: "replacement" }] }],
    },
  });
  view.unmount();
});

it("can retry saving without reloading over live edits", async () => {
  const { db, port } = fixture();
  const drafts = port("a");
  let context!: MessageInputContext;
  const view = render(<ChatComposer host={createTestViewHost("a")} attachmentDrafts={drafts}
    onContext={next => { context = next; }} />);
  await waitFor(() => expect(context).toBeDefined());
  await act(async () => { await drafts.flushDocument!(); });
  const fault = vi.spyOn(db, "writeDraft").mockRejectedValue(new Error("disk busy"));
  act(() => context.insertText("keep current edit"));
  const retry = await view.findByRole("button", { name: /重试保存|Retry saving/ });
  fault.mockRestore();
  fireEvent.click(retry);
  await waitFor(() => expect(view.queryByRole("button", { name: /重试保存|Retry saving/ })).toBeNull());
  expect(view.container.querySelector(".tiptap")!.textContent).toBe("keep current edit");
  expect(JSON.stringify(await db.read("drafts", draftKey(scope, { id: "a", type: 2 })))).toContain("keep current edit");
  view.unmount();
});

it("retains attachment readiness checks in temporary document mode", async () => {
  const { db, port } = fixture();
  const drafts = port("a");
  let context!: MessageInputContext;
  const onSend = vi.fn(async () => createChatSendOutcome());
  const view = render(<ChatComposer host={createTestViewHost("a")} attachmentDrafts={drafts}
    onSend={onSend} onContext={next => { context = next; }} />);
  await waitFor(() => expect(context).toBeDefined());
  await act(async () => { await drafts.flushDocument!(); });
  vi.spyOn(db, "writeDraft").mockRejectedValue(new Error("document disk full"));
  act(() => context.insertText("text"));
  fireEvent.click(await view.findByRole("button", { name: /使用临时草稿|Use temporary draft/ }));
  const begin = vi.spyOn(drafts, "beginSend");
  vi.spyOn(db, "changeAttachments").mockRejectedValue(new Error("attachment disk full"));
  await act(async () => { await context.addAttachment([new File(["x"], "pending.zip")]); });
  await act(async () => { await context.send(); });
  expect(begin).toHaveBeenCalled();
  expect(onSend).not.toHaveBeenCalled();
  expect(context.getAttachmentFiles().map(file => file.name)).toContain("pending.zip");
  expect(context.canLeaveWithAttachments()).toBe(false);
  view.unmount();
});

import { DraftConflictError } from "../../local-drafts/database";
import { wkConfirm } from "../../../../Components/WKModal/confirm";
it("does not bypass a cross-window conflict through save recovery", async () => {
  const { db, port } = fixture();
  const drafts = port("a");
  let context!: MessageInputContext;
  const onSend = vi.fn(async () => createChatSendOutcome());
  const view = render(<ChatComposer host={createTestViewHost("a")} attachmentDrafts={drafts}
    onSend={onSend} onContext={next => { context = next; }} />);
  await waitFor(() => expect(context).toBeDefined());
  await act(async () => { await drafts.flushDocument!(); });
  vi.spyOn(db, "writeDraft").mockRejectedValue(new DraftConflictError());
  act(() => context.insertText("conflicting text"));
  await waitFor(() => expect(wkConfirm).toHaveBeenCalled());
  await act(async () => { await context.send(); });
  expect(onSend).not.toHaveBeenCalled();
  expect(view.queryByRole("button", { name: /使用临时草稿|Use temporary draft/ })).toBeNull();
  view.unmount();
});

it("fences a held document write and consumes the protected copy after temporary sending", async () => {
  const { db, repository, port } = fixture();
  const drafts = port("a");
  let context!: MessageInputContext;
  const onSend = vi.fn(async () => createChatSendOutcome({ editorConsumed: true }));
  const view = render(<ChatComposer host={createTestViewHost("a")} attachmentDrafts={drafts}
    onSend={onSend} onContext={next => { context = next; }} />);
  await waitFor(() => expect(context).toBeDefined());
  act(() => context.insertText("last saved copy"));
  await act(async () => { await drafts.flushDocument!(); });
  const key = draftKey(scope, { id: "a", type: 2 });
  const write = db.writeDraft.bind(db);
  const fault = vi.spyOn(db, "writeDraft").mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
  act(() => context.clear());
  const temporary = await view.findByRole("button", { name: /使用临时草稿|Use temporary draft/ });
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  fault.mockImplementationOnce(async (...args) => { entered(); await gate; return write(...args); });
  act(() => context.insertText("temporary sent message"));
  await started;
  fireEvent.click(temporary);
  await act(async () => { await context.send(); });
  expect(onSend).toHaveBeenCalledOnce();
  expect(view.container.querySelector(".tiptap")!.textContent).toBe("");
  expect(await db.read<DraftRecord>("drafts", key)).toMatchObject({
    consumed: true,
    preview: "",
  });
  await act(async () => { release(); await repository.flush(key); });
  expect(await db.read<DraftRecord>("drafts", key)).toMatchObject({
    consumed: true,
    preview: "",
  });
  view.unmount();
  let restored: MessageInputContext | undefined;
  const reopened = render(<ChatComposer host={createTestViewHost("a")}
    attachmentDrafts={port("a", new ConversationDraftRepository(db))}
    onContext={next => { restored = next; }} />);
  await waitFor(() => expect(restored).toBeDefined());
  expect(reopened.container.querySelector(".tiptap")!.textContent).toBe("");
  reopened.unmount();
});

it.each(["restore", "temporary"])("offers an explicit choice for interrupted sends: %s", async choice => {
  const { db, port } = fixture();
  const old = port("crash");
  const upload = { id: "zip", file: new File(["zip"], "crash.zip"), source: "upload" as const };
  const image = { id: "image", file: new File(["image"], "crash.png", { type: "image/png" }), source: "paste" as const };
  await old.stage(upload);
  await old.stage(image);
  const send = old.beginSend([upload.id, image.id]);
  await send.ready;
  // The composer already consumed its document, but the process died before settlement.
  await old.saveDocument!({ document: { type: "doc", content: [{ type: "paragraph" }] }, topAttachments: [] });
  const reopened = port("crash", new ConversationDraftRepository(db));
  let context!: MessageInputContext;
  const view = render(<ChatComposer host={createTestViewHost("crash")} attachmentDrafts={reopened}
    onContext={next => { context = next; }} />);
  const recovery = await view.findByRole("button", { name: /恢复待确认附件|Restore unconfirmed attachments/ });
  expect(view.getByText(/有 2 个附件|Unconfirmed attachment deliveries: 2/)).toBeTruthy();
  expect(view.container.querySelector('[contenteditable="true"]')).toBeNull();
  expect(context).toBeUndefined();
  if (choice === "temporary") {
    fireEvent.click(view.getByRole("button", { name: /使用临时草稿|Use temporary draft/ }));
    await waitFor(() => expect(view.container.querySelector('[contenteditable="true"]')).not.toBeNull());
    expect(context.getAttachmentFiles()).toHaveLength(0);
    expect((await port("crash", new ConversationDraftRepository(db)).restore()).pendingSendRecovery?.count).toBe(2);
  } else {
    vi.spyOn(db, "recoverAttachmentReservations").mockRejectedValueOnce(new Error("disk busy"));
    fireEvent.click(recovery);
    await waitFor(() => expect(recovery).not.toBeDisabled());
    expect(view.container.querySelector('[contenteditable="true"]')).toBeNull();
    fireEvent.click(recovery);
    await waitFor(() => expect(context.getAttachmentFiles()).toHaveLength(2));
    await act(async () => { await send.settle([]); });
    const files = (await port("crash", new ConversationDraftRepository(db)).restore()).attachments;
    expect(files.map(item => item.id)).toEqual(["zip", "image"]);
    expect(view.container.querySelector('[data-type="attachment"]')).not.toBeNull();
  }
});

it("sends a small file after removing a large file rejected by storage quota", async () => {
  const { db, port } = fixture();
  const drafts = port("quota");
  const change = db.changeAttachments.bind(db);
  vi.spyOn(db, "changeAttachments").mockImplementation((key, update, session) =>
    change(key, records => {
      const next = update(records);
      if (next.some(file => file.file.size > 16))
        throw new DOMException("Blob capacity exceeded", "QuotaExceededError");
      return next;
    }, session));
  const onSend = vi.fn(async (request: ChatSendRequest) => createChatSendOutcome({ editorConsumed: true, consumedTopIds: request.topFiles?.map(file => file.id) ?? [] }));
  let context!: MessageInputContext;
  const view = render(<ChatComposer host={createTestViewHost("quota")} attachmentDrafts={drafts}
    onSend={onSend} onContext={next => { context = next; }} />);
  await waitFor(() => expect(context).toBeDefined());
  await act(async () => { await context.addAttachment([new File(["x".repeat(32)], "large.zip")]); });
  expect(context.canLeaveWithAttachments()).toBe(false);
  fireEvent.click(view.getByRole("button", { name: /移除|Remove/ }));
  await waitFor(() => expect(context.getAttachmentFiles()).toHaveLength(0));
  await act(async () => { await context.addAttachment([new File(["small"], "small.zip")]); });
  await waitFor(() => expect(context.canLeaveWithAttachments()).toBe(true));
  expect((await db.restoreAttachments(draftKey(scope, { id: "quota", type: 2 }))).map(file => file.name)).toEqual(["small.zip"]);
  await act(async () => { await context.send(); });
  expect(onSend).toHaveBeenCalledOnce();
  expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ topFiles: [expect.objectContaining({ file: expect.objectContaining({ name: "small.zip" }) })] }));
  expect(context.getAttachmentFiles()).toHaveLength(0);
  expect((await port("quota", new ConversationDraftRepository(db)).restore()).attachments).toEqual([]);
});


it("retries visible restore after a closed connection becomes available without refreshing the session", async () => {
  const { db, repository, port, connections, factory } = fixture();
  const drafts = port("closed");
  await drafts.stage({ id: "saved", file: new File(["saved"], "saved.zip"), source: "upload" });
  await drafts.saveDocument!({ document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "saved text" }] }] }, topAttachments: [{ id: "saved", name: "saved.zip", position: 1 }] });
  const session = await repository.session(scope);
  const captures = vi.spyOn(db, "session");
  connections[0].close();
  connections[0].onclose?.call(connections[0], new Event("close"));
  vi.mocked(factory.open).mockImplementationOnce(() => { throw new DOMException("Storage unavailable", "UnknownError"); });
  let context: MessageInputContext | undefined;
  const onSend = vi.fn(async (request: ChatSendRequest) => createChatSendOutcome({ editorConsumed: true, consumedTopIds: request.topFiles?.map(file => file.id) ?? [] }));
  const view = render(<ChatComposer host={createTestViewHost("closed")} attachmentDrafts={drafts}
    onSend={onSend} onContext={next => { context = next; }} />);
  const retry = await view.findByRole("button", { name: /重新读取|Retry loading/ });
  expect(context).toBeUndefined();
  fireEvent.click(retry);
  await waitFor(() => expect(context).toBeDefined());
  expect(context!.text()).toContain("saved text");
  expect(context!.getAttachmentFiles().map(file => file.name)).toEqual(["saved.zip"]);
  await act(async () => { await context!.send(); });
  expect(onSend).toHaveBeenCalledOnce();
  expect(context!.getAttachmentFiles()).toHaveLength(0);
  expect(await repository.session(scope)).toEqual(session);
  expect(captures).not.toHaveBeenCalled();
});
