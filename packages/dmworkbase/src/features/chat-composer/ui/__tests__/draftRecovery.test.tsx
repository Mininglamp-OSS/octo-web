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
import { createChatSendOutcome } from "../../domain";

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
  const db = new DraftDatabase(() => factory);
  const repository = new ConversationDraftRepository(db);
  const port = (id: string, repo = repository) =>
    withConversationDocument(
      createBrowserAttachmentDraftPort(scope, { id, type: 2 }, repo),
      scope,
      { id, type: 2 },
      repo
    );
  return { db, repository, port };
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
