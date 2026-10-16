import { afterEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { File as NodeFile } from "node:buffer";
import { DraftDatabase, DraftSessionExpiredError } from "./database";
import { ConversationDraftRepository } from "./repository";
import { createBrowserAttachmentDraftPort } from "./browserPort";
import { withConversationDocument } from "./documentPort";
import { draftAccountKey, draftKey, type ConversationDraft } from "./model";

const scope = { server: "test", account: "alice", space: "s" };
const channel = { id: "a", type: 2 };
const empty: ConversationDraft = {
  document: { type: "doc", content: [{ type: "paragraph" }] },
  topAttachments: [],
};
const withFile = (id: string): ConversationDraft => ({
  ...empty,
  topAttachments: [{ id, name: id, position: 1 }],
});
const attachment = (id: string) => ({
  id,
  file: new File([id], id),
  source: "upload" as const,
});
function setup(notifications = false) {
  // Exercise the durable fence even when cross-window notifications are unavailable.
  if (!notifications) vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("File", NodeFile);
  const factory = new IDBFactory();
  const db = new DraftDatabase(() => factory);
  const first = new ConversationDraftRepository(db);
  const secondDb = new DraftDatabase(() => factory);
  const second = new ConversationDraftRepository(secondDb);
  const port = (repo = first) =>
    withConversationDocument(
      createBrowserAttachmentDraftPort(scope, channel, repo),
      scope,
      channel,
      repo
    );
  return { db, first, secondDb, second, port };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("fences existing document and attachment ports in another database connection after logout", async () => {
  const { db, first, second, port } = setup();
  const stale = port(second);
  await stale.restore();
  await first.clearAccount(scope);
  expect(await stale.stage(attachment("secret.zip"))).toBe(false);
  await expect(stale.saveDocument!(empty)).rejects.toBeInstanceOf(
    DraftSessionExpiredError
  );
  expect(
    await db.list("attachments", "account", draftAccountKey(scope))
  ).toEqual([]);
  expect(await db.list("drafts", "account", draftAccountKey(scope))).toEqual(
    []
  );
  // A genuinely new repository can establish the new session after login.
  await expect(
    port(new ConversationDraftRepository(db)).saveDocument!(empty)
  ).resolves.toBeUndefined();
});

it.each(["same", "other"] as const)(
  "fences already-started writes in the %s repository when cleanup finishes first",
  async (which) => {
    const { db, first, secondDb, second, port } = setup();
    const writer = which === "same" ? first : second;
    const writerDb = which === "same" ? db : secondDb;
    const stale = port(writer);
    await stale.restore();
    const fileEntered = deferred(),
      docEntered = deferred(),
      gate = deferred();
    const change = writerDb.changeAttachments.bind(writerDb);
    const write = writerDb.writeDraft.bind(writerDb);
    vi.spyOn(writerDb, "changeAttachments").mockImplementationOnce(
      async (...args) => {
        fileEntered.resolve();
        await gate.promise;
        return change(...args);
      }
    );
    vi.spyOn(writerDb, "writeDraft").mockImplementationOnce(async (...args) => {
      docEntered.resolve();
      await gate.promise;
      return write(...args);
    });
    const file = stale.stage(attachment("pending.zip"));
    const document = stale.saveDocument!(empty);
    const rejected = expect(document).rejects.toBeInstanceOf(
      DraftSessionExpiredError
    );
    await Promise.all([fileEntered.promise, docEntered.promise]);
    await first.clearAccount(scope);
    gate.resolve();
    expect(await file).toBe(false);
    await rejected;
    if (which === "same")
      expect((await port().restore()).attachments).toEqual([]);
    expect(
      await db.list("attachments", "account", draftAccountKey(scope))
    ).toEqual([]);
    expect(await db.list("drafts", "account", draftAccountKey(scope))).toEqual(
      []
    );
  }
);

it("retains deletion intent across a fresh repository even if blob deletion fails", async () => {
  const { db, first, port } = setup();
  const current = port();
  await current.restore();
  const file = attachment("deleted.zip");
  await current.stage(file);
  current.syncLive([file.id], [file]);
  vi.spyOn(db, "changeAttachments").mockRejectedValue(new Error("disk busy"));
  current.syncLive([]);
  await expect(
    first.flush(draftKey(scope, channel) + ":files")
  ).rejects.toThrow();
  expect(
    await db.list("attachments", "conversation", draftKey(scope, channel))
  ).toHaveLength(1);
  expect(
    (await port(new ConversationDraftRepository(db)).restore()).attachments
  ).toEqual([]);
});

it("commits removal with the document even if both attachment mutation paths fail", async () => {
  const { db, first, port } = setup();
  const current = port();
  await current.restore();
  const file = attachment("deleted.zip");
  await current.stage(file);
  current.syncLive([file.id], [file]);
  await current.saveDocument!(withFile(file.id));
  vi.spyOn(db, "setAttachmentPresence").mockRejectedValue(
    new Error("disk busy")
  );
  vi.spyOn(db, "changeAttachments").mockRejectedValue(new Error("disk busy"));
  current.syncLive([]);
  await current.saveDocument!(empty);
  await expect(
    first.flush(draftKey(scope, channel) + ":files")
  ).rejects.toThrow();
  expect(
    (await port(new ConversationDraftRepository(db)).restore()).attachments
  ).toEqual([]);
});

it("keeps newly staged bytes absent from an older document and honors subsequent removal before staging finishes", async () => {
  const { db, port } = setup();
  const current = port();
  await current.restore();
  await current.saveDocument!(empty);
  await current.stage(attachment("pending.zip"));
  expect(
    (await port(new ConversationDraftRepository(db)).restore()).attachments.map(
      (item) => item.id
    )
  ).toEqual(["pending.zip"]);
  // The document may commit removal while the corresponding bytes are still queued.
  await current.saveDocument!(withFile("late.zip"));
  await current.saveDocument!(empty);
  await current.stage(attachment("late.zip"));
  expect(
    (await port(new ConversationDraftRepository(db)).restore()).attachments.map(
      (item) => item.id
    )
  ).toEqual(["pending.zip"]);
});

it("undoes a failed removal and restores the attachment through a fresh repository", async () => {
  const { db, first, port } = setup();
  const current = port();
  await current.restore();
  const file = attachment("undo.zip");
  await current.stage(file);
  current.syncLive([file.id], [file]);
  await current.saveDocument!(withFile(file.id));
  const failure = vi
    .spyOn(db, "changeAttachments")
    .mockRejectedValue(new Error("disk busy"));
  current.syncLive([]);
  await current.saveDocument!(empty);
  await expect(
    first.flush(draftKey(scope, channel) + ":files")
  ).rejects.toThrow();
  failure.mockRestore();
  current.syncLive([file.id], [file]);
  await current.saveDocument!(withFile(file.id));
  await first.flush(draftKey(scope, channel) + ":files");
  expect(
    (await port(new ConversationDraftRepository(db)).restore()).attachments.map(
      (item) => item.id
    )
  ).toEqual([file.id]);
});

it("preserves insertion order across two reopens and appends with a new position", async () => {
  const { db, port } = setup();
  await port().stage(attachment("z.zip"));
  await port().stage(attachment("a.zip"));
  const reopened = port(new ConversationDraftRepository(db));
  expect(
    (await reopened.restore()).attachments.map((item) => item.file.name)
  ).toEqual(["z.zip", "a.zip"]);
  await reopened.stage(attachment("m.zip"));
  const restored = (await port(new ConversationDraftRepository(db)).restore())
    .attachments;
  expect(restored.map((item) => item.file.name)).toEqual([
    "z.zip",
    "a.zip",
    "m.zip",
  ]);
  expect(restored.map((item) => item.position)).toEqual([0, 1, 2]);
});

it("upgrades a version 1 database without dropping existing drafts or attachments", async () => {
  vi.stubGlobal("File", NodeFile);
  const factory = new IDBFactory();
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("migration", 1);
    request.onupgradeneeded = () => {
      const drafts = request.result.createObjectStore("drafts", {
        keyPath: "key",
      });
      drafts.createIndex("account", "account");
      drafts.createIndex("scope", "scope");
      const files = request.result.createObjectStore("attachments", {
        keyPath: "key",
      });
      files.createIndex("account", "account");
      files.createIndex("conversation", "conversation");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const key = draftKey(scope, channel);
  await new Promise<void>((resolve, reject) => {
    const tx = old.transaction(["drafts", "attachments"], "readwrite");
    tx.objectStore("drafts").put({ key, account: draftAccountKey(scope),
      scope: JSON.stringify([scope.server, scope.account, scope.space]),
      revision: 1, draft: withFile("legacy.zip"), preview: "[legacy.zip]" });
    tx.objectStore("attachments").put({
      ...attachment("legacy.zip"),
      key: JSON.stringify([key, "legacy.zip"]),
      conversation: key,
      account: draftAccountKey(scope),
      name: "legacy.zip",
      lastModified: 0,
      revision: "v1",
      position: 0,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  old.close();
  const db = new DraftDatabase(() => factory, "migration");
  expect((await db.restoreAttachments(key)).map((item) => item.name)).toEqual([
    "legacy.zip",
  ]);
  expect(await db.read("drafts", key)).toMatchObject({ revision: 1, draft: withFile("legacy.zip") });
  expect((await db.session(draftAccountKey(scope))).generation).toBe(0);
});

it("broadcasts revocation to clear other-window caches without refreshing its old session", async () => {
  const channels: FakeChannel[] = [];
  class FakeChannel {
    onmessage?: (event: { data: unknown }) => void;
    constructor(readonly name: string) {
      channels.push(this);
    }
    postMessage(data: unknown) {
      for (const channel of channels)
        if (channel !== this && channel.name === this.name)
          queueMicrotask(() => channel.onmessage?.({ data }));
    }
  }
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  const { first, second, port } = setup(true);
  const stale = port(second);
  await stale.restore();
  await stale.saveDocument!(withFile("private.zip"));
  expect(second.records.size).toBe(1);
  await first.clearAccount(scope);
  await Promise.resolve();
  await Promise.resolve();
  expect(second.records.size).toBe(0);
  expect(await stale.stage(attachment("private.zip"))).toBe(false);
  await expect(second.save(scope, channel, empty)).rejects.toBeInstanceOf(
    DraftSessionExpiredError
  );
});

it.each([false, true])("never adopts a new generation after a failed capture (broadcasts: %s)", async notifications => {
  const channels: Array<{ onmessage?: (event: { data: unknown }) => void }> = [];
  class FakeChannel {
    onmessage?: (event: { data: unknown }) => void;
    constructor() { channels.push(this); }
    postMessage(data: unknown) {
      channels.filter(channel => channel !== this).forEach(channel => channel.onmessage?.({ data }));
    }
  }
  if (notifications) vi.stubGlobal("BroadcastChannel", FakeChannel);
  const { db, first, secondDb, second, port } = setup(notifications);
  const capture = vi.spyOn(secondDb, "session").mockRejectedValueOnce(new Error("initial read failed"));
  const stale = port(second);
  await expect(stale.restore()).rejects.toThrow("initial read failed");
  await first.clearAccount(scope);
  await expect(stale.restore()).rejects.toThrow();
  expect(await stale.stage(attachment("revoked.zip"))).toBe(false);
  await expect(stale.saveDocument!(withFile("revoked.zip"))).rejects.toThrow();
  expect(capture).toHaveBeenCalledOnce();
  expect(await db.list("drafts", "account", draftAccountKey(scope))).toEqual([]);
  expect(await db.list("attachments", "account", draftAccountKey(scope))).toEqual([]);
});

it("aborts an open document transaction and its membership changes without revoking attachment ownership", async () => {
  const { db, first, port } = setup();
  const current = port();
  await current.restore();
  await current.stage(attachment("protected.zip"));
  await current.saveDocument!(withFile("protected.zip"));
  const key = draftKey(scope, channel);
  const saved = await db.read("drafts", key);
  const put = IDBObjectStore.prototype.put;
  let cancelled = false;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (value, key) {
    const request = put.call(this, value, key);
    if (this.name === "drafts" && !cancelled) {
      cancelled = true;
      current.stopDocumentSaving!();
    }
    return request;
  });
  await current.saveDocument!(empty);
  expect(cancelled).toBe(true);
  expect(await db.read("drafts", key)).toEqual(saved);
  expect((await db.restoreAttachments(key)).map(file => file.id)).toEqual(["protected.zip"]);
  expect(await current.stage(attachment("still-owned.zip"))).toBe(true);
  // A newly mounted compose using the same repository must see disk, not the
  // cancelled optimistic empty record, and must still be able to persist.
  const next = port(first);
  expect((await next.restore()).document).toEqual(withFile("protected.zip"));
  await next.saveDocument!(empty);
  expect(await db.read("drafts", key)).toMatchObject({ draft: empty });
});

it.each(["same", "different"])("drops cancelled queued writes but retains another composer's %s snapshot", async which => {
  const { db, first, port } = setup();
  const abandoned = port();
  await abandoned.restore();
  await abandoned.saveDocument!(empty);
  const gate = deferred(), started = deferred();
  const write = db.writeDraft.bind(db);
  const writes = vi.spyOn(db, "writeDraft").mockImplementationOnce(async (...args) => {
    started.resolve();
    await gate.promise;
    return write(...args);
  });
  const firstSave = abandoned.saveDocument!(withFile("abandoned.zip"));
  await started.promise;
  const queuedSave = abandoned.saveDocument!(withFile("queued.zip"));
  const live = port(first);
  await live.restore();
  const liveDraft = withFile(which === "same" ? "queued.zip" : "live.zip");
  const liveSave = live.saveDocument!(liveDraft);
  abandoned.stopDocumentSaving!();
  expect(first.records.get(draftKey(scope, channel))?.draft).toEqual(liveDraft);
  gate.resolve();
  await Promise.all([firstSave, queuedSave, liveSave]);
  // The held mutation is cancelled inside the DB; the queued abandoned one
  // never reaches it. The other compose retains normal CAS persistence.
  expect(writes).toHaveBeenCalledTimes(2);
  expect(await db.read("drafts", draftKey(scope, channel))).toMatchObject({ draft: liveDraft });
  await abandoned.saveDocument!(empty);
  await abandoned.recoverDocument!("old-send", withFile("old.zip"));
  expect(await db.read("drafts", draftKey(scope, channel))).toMatchObject({ draft: liveDraft });
});
