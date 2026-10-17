import { afterEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { File as NodeFile } from "node:buffer";
import { DraftDatabase } from "./database";
import { ConversationDraftRepository } from "./repository";
import { createBrowserAttachmentDraftPort } from "./browserPort";
import { withConversationDocument } from "./documentPort";
import { draftKey, type ConversationDraft } from "./model";

const scope = { server: "test", account: "alice", space: "s" };
const channel = { id: "chat", type: 2 };
const key = draftKey(scope, channel);
const empty: ConversationDraft = {
  document: { type: "doc", content: [{ type: "paragraph" }] },
  topAttachments: [],
};
const draft: ConversationDraft = {
  ...empty,
  topAttachments: [{ id: "unsent", name: "unsent.zip", position: 3 }],
};
function setup() {
  vi.stubGlobal("File", NodeFile);
  vi.stubGlobal("BroadcastChannel", undefined);
  const factory = new IDBFactory();
  const db = new DraftDatabase(() => factory);
  const repository = new ConversationDraftRepository(db);
  const port = (repo = repository) => withConversationDocument(
    createBrowserAttachmentDraftPort(scope, channel, repo), scope, channel, repo
  );
  return { db, repository, port };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["before-settlement", "after-settlement"])(
  "preserves unsent bytes when document restoration fails and consumption commits %s",
  async timing => {
    const { db, repository, port } = setup();
    const current = port();
    await current.restore();
    const file = {
      id: "unsent",
      file: new File(["still unsent"], "unsent.zip", { lastModified: 123 }),
      source: "upload" as const,
    };
    await current.stage(file, 3);
    current.syncLive([file.id], [file]);
    await current.saveDocument!(draft);
    const send = current.beginSend([file.id]);
    await send.ready;
    const consumedRevision = send.attachmentRevisions!.get(file.id);
    expect(consumedRevision).toBeDefined();

    const entered = deferred(), gate = deferred();
    const write = db.writeDraft.bind(db);
    vi.spyOn(db, "writeDraft").mockImplementation(async (...args) => {
      if (args[0].draft.topAttachments.length) {
        throw new Error("restored document write failed");
      }
      if (timing === "after-settlement") {
        entered.resolve();
        await gate.promise;
      }
      return write(...args);
    });
    // Consumption and its document write are independent of the file queue.
    current.syncLive([]);
    const consumed = current.saveDocument!(empty);
    if (timing === "after-settlement") await entered.promise;
    else await consumed;
    // The failed send restores editor content, but its document cannot persist.
    current.syncLive([file.id], [file]);
    const recovery = current.saveDocument!(draft);
    const rejectedRecovery = expect(recovery).rejects.toThrow("restored document write failed");
    await send.settle([file.id]);
    gate.resolve();
    await consumed;
    await rejectedRecovery;
    await repository.flush(key + ":files");
    expect(current.canLeave([file.id])).toBe(false);

    // Explicit temporary mode waives text persistence, so its attachment guard
    // must only become safe when a fresh repository can actually reopen bytes.
    current.stopDocumentSaving!();
    expect(current.canLeaveAttachments!([file.id])).toBe(true);
    const fresh = port(new ConversationDraftRepository(db));
    const restored = await fresh.restore();
    expect(restored.pendingSendRecovery).toBeUndefined();
    expect(restored.attachments).toHaveLength(1);
    expect(restored.attachments[0]).toMatchObject({
      id: file.id, source: "upload", position: 3,
    });
    expect(restored.attachments[0].file.name).toBe("unsent.zip");
    expect(restored.attachments[0].file.lastModified).toBe(123);
    expect(await restored.attachments[0].file.text()).toBe("still unsent");

    // A retained send is a new ownership generation; an old consumed-document
    // decision must not affect it, and the restored generation remains sendable.
    const retry = fresh.beginSend([file.id], restored.attachments);
    await retry.ready;
    expect(retry.attachmentRevisions!.get(file.id)).not.toBe(consumedRevision);
    await retry.settle([]);
    expect((await port(new ConversationDraftRepository(db)).restore()).attachments).toEqual([]);
  }
);

it("does not resurrect a removed replacement when an older editor saves the same attachment ID", async () => {
  const { db, port } = setup();
  const older = port();
  await older.restore();
  await older.stage({
    id: "unsent", file: new File(["old bytes"], "old.zip"), source: "upload",
  });
  await older.saveDocument!(draft);

  const newerRepository = new ConversationDraftRepository(db);
  const newer = port(newerRepository);
  await newer.restore();
  await newer.stage({
    id: "unsent", file: new File(["new bytes"], "new.zip"), source: "upload",
  });
  newer.syncLive(["unsent"]);
  // The newer editor durably records removal, but its blob cleanup cannot commit.
  vi.spyOn(db, "changeAttachments").mockRejectedValue(new Error("blob cleanup failed"));
  newer.syncLive([]);
  await expect(newerRepository.flush(key + ":files")).rejects.toThrow("blob cleanup failed");
  expect(await db.list("attachments", "conversation", key)).toHaveLength(1);
  expect((await port(new ConversationDraftRepository(db)).restore()).attachments).toEqual([]);

  // Saving an edited text still referencing generation A cannot undo removal B.
  await older.saveDocument!({
    ...draft,
    document: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "edited in older window" }] }],
    },
  });
  expect((await port(new ConversationDraftRepository(db)).restore()).attachments).toEqual([]);
});

it("records removal for the generation adopted by same-port send recovery", async () => {
  const { db, repository, port } = setup();
  const sender = port();
  await sender.restore();
  await sender.stage({
    id: "unsent", file: new File(["recovered bytes"], "recovered.zip"), source: "upload",
  });
  await sender.saveDocument!(draft);
  await sender.beginSend(["unsent"]).ready;
  const current = port();
  const pending = await current.restore();
  expect(pending.pendingSendRecovery?.count).toBe(1);
  await pending.pendingSendRecovery!.recover();
  expect((await current.restore()).attachments).toHaveLength(1);
  current.syncLive(["unsent"]);

  vi.spyOn(db, "setAttachmentPresence").mockRejectedValue(new Error("presence cleanup failed"));
  vi.spyOn(db, "changeAttachments").mockRejectedValue(new Error("blob cleanup failed"));
  current.syncLive([]);
  await current.saveDocument!(empty);
  await expect(repository.flush(key + ":files")).rejects.toThrow();
  // The document commit is the surviving removal path, and must own recovered B.
  expect(await db.list("attachments", "conversation", key)).toHaveLength(1);
  expect((await port(new ConversationDraftRepository(db)).restore()).attachments).toEqual([]);
});
