import { afterEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { File as NodeFile } from "node:buffer";
import { DraftDatabase } from "./database";
import { ConversationDraftRepository } from "./repository";
import { createBrowserAttachmentDraftPort } from "./browserPort";
import { draftKey } from "./model";

const scope = { server: "test", account: "alice", space: "s" };
const channel = { id: "chat", type: 2 };
const key = draftKey(scope, channel);
const filesKey = key + ":files";
const attachment = (id: string) => ({
  id,
  file: new File([id], id, { type: "image/png", lastModified: 123 }),
  source: "paste" as const,
});
function setup() {
  vi.stubGlobal("File", NodeFile);
  vi.stubGlobal("BroadcastChannel", undefined);
  const factory = new IDBFactory();
  const db = new DraftDatabase(() => factory);
  const repository = new ConversationDraftRepository(db);
  const port = (repo = repository) => createBrowserAttachmentDraftPort(scope, channel, repo);
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

it.each(["stage", "remove", "settle"])(
  "reads durable attachments and reservations despite a permanently failed %s task",
  async failure => {
    const { db, repository, port } = setup();
    const original = port();
    await original.stage(attachment("saved.png"), 4);
    await original.stage(attachment("uncertain.png"), 7);
    const send = original.beginSend(["uncertain.png"]);
    await send.ready;
    if (failure === "remove") {
      await original.stage(attachment("removed.png"));
      original.syncLive(["saved.png", "removed.png"]);
    }
    const writes = vi.spyOn(db, "changeAttachments")
      .mockRejectedValue(new DOMException("disk full", "QuotaExceededError"));
    if (failure === "stage") expect(await original.stage(attachment("failed.png"))).toBe(false);
    if (failure === "remove") original.syncLive(["saved.png"]);
    if (failure === "settle") await expect(send.settle([])).rejects.toThrow("disk full");
    await expect(repository.flush(filesKey)).rejects.toThrow("disk full");

    for (let mount = 0; mount < 2; mount++) {
      const reopened = port();
      const snapshot = await reopened.restore();
      expect(snapshot.failedCount).toBeGreaterThan(0);
      expect(snapshot.attachments.map(item => item.id)).toEqual(["saved.png"]);
      expect(await snapshot.attachments[0].file.text()).toBe("saved.png");
      expect(snapshot.pendingSendRecovery?.count).toBe(1);
      expect(reopened.canLeave(["saved.png"])).toBe(false);
    }
    // Reading must not silently acknowledge failed mutations or drop their retry.
    await expect(repository.flush(filesKey)).rejects.toThrow("disk full");
    writes.mockRestore();
    await repository.flush(filesKey);
    const recovered = await port().restore();
    expect(recovered.failedCount).toBe(0);
    expect(recovered.attachments.map(item => item.id)).toEqual(
      failure === "stage" ? ["saved.png", "failed.png"] : ["saved.png"]
    );
    expect(recovered.pendingSendRecovery?.count).toBe(failure === "settle" ? undefined : 1);
  }
);

it.each(["queued", "before-commit", "after-commit", "completed"])(
  "preserves restored bytes on IDs-only undo when deletion is %s",
  async timing => {
    const { db, repository, port } = setup();
    await port().stage(attachment("undo.png"), 6);
    // This editor has only loaded from disk; it never received stage/file inputs.
    const current = port();
    await current.restore();
    current.syncLive(["undo.png"]);
    const entered = deferred(), gate = deferred();
    const change = db.changeAttachments.bind(db);
    if (timing === "before-commit" || timing === "after-commit") {
      vi.spyOn(db, "changeAttachments").mockImplementationOnce(async (...args) => {
        if (timing === "before-commit") {
          entered.resolve();
          await gate.promise;
          return change(...args);
        }
        const result = await change(...args);
        entered.resolve();
        await gate.promise;
        return result;
      });
    }
    current.syncLive([]);
    if (timing === "before-commit" || timing === "after-commit") await entered.promise;
    if (timing === "completed") await repository.flush(filesKey);
    current.syncLive(["undo.png"]);
    gate.resolve();
    await repository.flush(filesKey);
    const restored = await port(new ConversationDraftRepository(db)).restore();
    expect(restored.attachments).toHaveLength(1);
    expect(restored.attachments[0]).toMatchObject({ id: "undo.png", source: "paste", position: 6 });
    expect(restored.attachments[0].file.name).toBe("undo.png");
    expect(restored.attachments[0].file.type).toBe("image/png");
    expect(restored.attachments[0].file.lastModified).toBe(123);
    expect(await restored.attachments[0].file.text()).toBe("undo.png");
    expect(current.canLeave(["undo.png"])).toBe(true);
    // The restored generation remains sendable and settles normally.
    const send = current.beginSend(["undo.png"]);
    await send.ready;
    expect(send.attachmentRevisions?.has("undo.png")).toBe(true);
    await send.settle([]);
    expect((await port().restore()).attachments).toEqual([]);
  }
);

it("keeps IDs-only undo unsafe until replacement bytes actually persist", async () => {
  const { db, repository, port } = setup();
  const current = port();
  await current.stage(attachment("undo.png"));
  current.syncLive(["undo.png"]);
  current.syncLive([]);
  await repository.flush(filesKey);
  const writes = vi.spyOn(db, "changeAttachments").mockRejectedValue(new Error("disk full"));
  current.syncLive(["undo.png"]);
  await expect(repository.flush(filesKey)).rejects.toThrow("disk full");
  expect(current.canLeave(["undo.png"])).toBe(false);
  expect((await port(new ConversationDraftRepository(db)).restore()).attachments).toEqual([]);
  writes.mockRestore();
  await repository.flush(filesKey);
  expect(current.canLeave(["undo.png"])).toBe(true);
  expect(await (await port().restore()).attachments[0].file.text()).toBe("undo.png");
});

it("still rejects unreadable storage instead of claiming an empty recovered draft", async () => {
  const { db, port } = setup();
  await port().stage(attachment("saved.png"));
  vi.spyOn(db, "changeAttachments").mockRejectedValue(new Error("write failed"));
  expect(await port().stage(attachment("failed.png"))).toBe(false);
  vi.spyOn(db, "restoreAttachments").mockRejectedValue(new Error("read failed"));
  await expect(port().restore()).rejects.toThrow("read failed");
});

it("does not hide a generation fence failure while restoring after other-window logout", async () => {
  const { db, repository, port } = setup();
  await repository.session(scope);
  await new ConversationDraftRepository(db).clearAccount(scope);
  const stale = port();
  expect(await stale.stage(attachment("expired.png"))).toBe(false);
  await expect(stale.restore()).rejects.toMatchObject({ name: "DraftSessionExpiredError" });
});
