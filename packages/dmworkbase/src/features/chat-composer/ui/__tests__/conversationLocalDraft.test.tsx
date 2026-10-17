import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { File as NodeFile } from "node:buffer";
import { IDBFactory } from "fake-indexeddb";
import { wkConfirm } from "../../../../Components/WKModal/confirm";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";
import { createTestViewHost } from "./testViewHost";
import { DraftDatabase } from "../../local-drafts/database";
import { ConversationDraftRepository } from "../../local-drafts/repository";
import { createBrowserAttachmentDraftPort } from "../../local-drafts/browserPort";
import { withConversationDocument } from "../../local-drafts/documentPort";
import { createChatSendOutcome } from "../../domain";

vi.mock("../../../../Components/WKModal/confirm", () => ({ wkConfirm: vi.fn() }));
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

describe("conversation local drafts in the real composer", () => {
  it("imports a legacy draft once and respects the local empty tombstone on return", async () => {
    const { db, port } = fixture();
    let context!: MessageInputContext;
    const drafts = port("a");
    let view = render(<ChatComposer host={createTestViewHost("a")} legacyDraft="old draft @[ada:Ada]" attachmentDrafts={drafts} onContext={next => { context = next; }} />);
    await waitFor(() => expect(context).toBeDefined());
    expect(context.text()).toContain("old draft");
    expect(view.container.querySelector('[data-type="mention"]')).toBeTruthy();
    await act(async () => { context.clear(); await drafts.flushDocument!(); });
    view.unmount();
    let restored: MessageInputContext | undefined;
    view = render(<ChatComposer host={createTestViewHost("a")} legacyDraft="old draft @[ada:Ada]" attachmentDrafts={port("a", new ConversationDraftRepository(db))} onContext={next => { restored = next; }} />);
    await waitFor(() => expect(restored).toBeDefined());
    expect(restored!.text()).toBe("");
    view.unmount();
  });
  it("merges a cross-window conflict in the editor and can send afterwards", async () => {
    const { db, repository, port } = fixture();
    const drafts = port("a");
    let context!: MessageInputContext;
    const onSend = vi.fn(async () => createChatSendOutcome({ editorConsumed: true }));
    const view = render(<ChatComposer host={createTestViewHost("a")} attachmentDrafts={drafts} onSend={onSend} onContext={next => { context = next; }} />);
    await waitFor(() => expect(context).toBeDefined());
    await drafts.flushDocument!();
    const other = new ConversationDraftRepository(db);
    await other.load(scope, {id: "a", type: 2});
    const otherPort = port("a", other);
    await otherPort.stage({id: "remote-file", file: new File(["remote"], "remote.txt"), source: "upload"});
    await other.save(scope, {id: "a", type: 2}, {document: {type: "doc", content: [{type: "paragraph", content: [{type: "text", text: "other"}]}]}, topAttachments: [{id: "remote-file", name: "remote.txt", position: 1}]});
    act(() => context.insertText("local"));
    await waitFor(() => expect(wkConfirm).toHaveBeenCalled());
    const calls = vi.mocked(wkConfirm).mock.calls;
    const dialog = calls[calls.length - 1][0];
    await act(async () => { await dialog.onOk?.({} as React.MouseEvent<HTMLButtonElement>); });
    await waitFor(() => expect(context.text()).toContain("other"));
    expect(context.text()).toContain("local");
    expect(repository.preview(scope, {id: "a", type: 2})).toBe("local [remote.txt]other");
    expect(context.getAttachmentFiles().map(file => file.name)).toEqual(["remote.txt"]);
    await act(async () => { await context.send(); });
    expect(onSend).toHaveBeenCalledOnce();
    view.unmount();
  });
  it("restores the original upload anchor after a failed send", async () => {
    const { repository, port } = fixture();
    let context!: MessageInputContext;
    const view = render(<ChatComposer host={createTestViewHost("a")} attachmentDrafts={port("a")} onSend={async () => createChatSendOutcome()} onContext={next => { context = next; }} />);
    await waitFor(() => expect(context).toBeDefined());
    await act(async () => {
      context.insertText("before");
      await context.addAttachment([new File(["zip"], "a.zip")]);
      context.insertText("after");
      await context.send();
    });
    expect(repository.preview(scope, {id: "a", type: 2})).toBe("before[a.zip]after");
    view.unmount();
  });
  it("restores text, inline images and upload ordering through A-B-A and a repository reload", async () => {
    const { db, repository, port } = fixture();
    const draftA = port("a");
    let context!: MessageInputContext;
    let view = render(
      <ChatComposer
        host={createTestViewHost("a")}
        attachmentDrafts={draftA}
        onContext={(next) => {
          context = next;
        }}
      />
    );
    await waitFor(() => expect(context).toBeDefined());
    await act(async () => {
      await context.addAttachment([new File(["zip"], "a.zip")]);
      context.insertText("between");
      await context.addAttachment([new File(["md"], "b.md")]);
      context.insertText("after");
      await context.addAttachment(
        [new File(["png"], "shot.png", { type: "image/png" })],
        "paste"
      );
    });
    await waitFor(() =>
      expect(repository.preview(scope, { id: "a", type: 2 })).toBe(
        "[a.zip]between[b.md]after[shot.png]"
      )
    );
    await act(async () => {
      await draftA.flushDocument!();
    });
    view.unmount();
    const draftB = port("b");
    let contextB: MessageInputContext | undefined;
    view = render(
      <ChatComposer
        host={createTestViewHost("b")}
        attachmentDrafts={draftB}
        onContext={(next) => {
          contextB = next;
        }}
      />
    );
    await waitFor(() => expect(contextB).toBeDefined());
    expect(contextB!.text()).toBe("");
    view.unmount();
    const reload = new ConversationDraftRepository(db);
    const restoredPort = port("a", reload);
    let restored: MessageInputContext | undefined;
    view = render(
      <ChatComposer
        host={createTestViewHost("a")}
        attachmentDrafts={restoredPort}
        onContext={(next) => {
          restored = next;
        }}
      />
    );
    await waitFor(() => expect(restored).toBeDefined());
    expect(restored!.text()).toBe("betweenafter");
    expect(
      restored!
        .getAttachmentFiles()
        .map((file) => file.name)
        .sort()
    ).toEqual(["a.zip", "b.md", "shot.png"]);
    expect(view.container.querySelector('img[alt="shot.png"]')).toBeTruthy();
    expect(reload.preview(scope, { id: "a", type: 2 })).toBe(
      "[a.zip]between[b.md]after[shot.png]"
    );
    view.unmount();
  });

  it("removes an attachment without resurrecting it on return", async () => {
    const { repository, port } = fixture();
    const drafts = port("a");
    let context: MessageInputContext | undefined;
    const view = render(
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
      await context!.addAttachment([
        new File(["a"], "a.zip"),
        new File(["b"], "b.md"),
      ]);
    });
    const remove = view
      .getAllByRole("button")
      .filter(
        (button) =>
          button.getAttribute("aria-label")?.includes("移除") ||
          button.getAttribute("aria-label")?.includes("Remove")
      );
    expect(remove).toHaveLength(2);
    fireEvent.click(remove[0]);
    await waitFor(() =>
      expect(repository.preview(scope, { id: "a", type: 2 })).toBe("[b.md]")
    );
    await waitFor(() =>
      expect(
        drafts.canLeave(
          context!.getAttachmentFiles().length
            ? [
                repository.records.values().next().value!.draft
                  .topAttachments[0].id,
              ]
            : []
        )
      ).toBe(true)
    );
    view.unmount();
    expect(
      (await port("a").restore()).attachments.map((item) => item.file.name)
    ).toEqual(["b.md"]);
  });

  it("does not clear newly typed text when an older send settles", async () => {
    const { repository, port } = fixture();
    const drafts = port("a");
    let context: MessageInputContext | undefined;
    let finish!: (value: ReturnType<typeof createChatSendOutcome>) => void;
    const onSend = vi.fn(
      () =>
        new Promise<ReturnType<typeof createChatSendOutcome>>((resolve) => {
          finish = resolve;
        })
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
    await waitFor(() => expect(context).toBeDefined());
    act(() => context!.insertText("old"));
    let sending!: ReturnType<MessageInputContext["send"]>;
    act(() => {
      sending = context!.send();
    });
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    act(() => context!.insertText("new"));
    await act(async () => {
      finish(createChatSendOutcome({ editorConsumed: true }));
      await sending;
    });
    await waitFor(() =>
      expect(repository.preview(scope, { id: "a", type: 2 })).toBe("new")
    );
    expect(context!.text()).toBe("new");
    view.unmount();
  });

  it("persists an unmounted failed send ahead of a newer draft without overwriting it", async () => {
    const { repository, port } = fixture();
    const drafts = port("a");
    let context: MessageInputContext | undefined;
    let finish!: (value: ReturnType<typeof createChatSendOutcome>) => void;
    const onSend = vi.fn(
      () =>
        new Promise<ReturnType<typeof createChatSendOutcome>>((resolve) => {
          finish = resolve;
        })
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
    await waitFor(() => expect(context).toBeDefined());
    act(() => context!.insertText("old"));
    let sending!: ReturnType<MessageInputContext["send"]>;
    act(() => {
      sending = context!.send();
    });
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    view.unmount();
    await repository.save(
      scope,
      { id: "a", type: 2 },
      {
        document: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "new" }] },
          ],
        },
        topAttachments: [],
      }
    );
    await act(async () => {
      finish(createChatSendOutcome());
      await sending;
      await drafts.flushDocument!();
    });
    expect(repository.preview(scope, { id: "a", type: 2 })).toBe("old new");
    let restored: MessageInputContext | undefined;
    const returned = render(
      <ChatComposer
        host={createTestViewHost("a")}
        attachmentDrafts={port("a")}
        onContext={(next) => {
          restored = next;
        }}
      />
    );
    await waitFor(() => expect(restored).toBeDefined());
    expect(restored!.text()).toContain("old");
    expect(restored!.text()).toContain("new");
    returned.unmount();
  });
});
