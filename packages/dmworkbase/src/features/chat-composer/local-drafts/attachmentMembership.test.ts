import { afterEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { File as NodeFile } from "node:buffer";
import { DraftDatabase, type StoredAttachment } from "./database";
import { ConversationDraftRepository } from "./repository";
import { createBrowserAttachmentDraftPort } from "./browserPort";
import { withConversationDocument } from "./documentPort";
import { draftAccountKey, draftKey, type ConversationDraft } from "./model";

const scope = { server: "test", account: "alice", space: "s" };
const channel = { id: "attachment-membership", type: 2 };
const attachmentId = "same-id";
const empty: ConversationDraft = {
  document: { type: "doc", content: [{ type: "paragraph" }] },
  topAttachments: [],
};
const withFile: ConversationDraft = {
  ...empty,
  topAttachments: [{ id: attachmentId, name: "report.txt", position: 0 }],
};
const attachment = (contents: string) => ({
  id: attachmentId,
  file: new File([contents], "report.txt", { type: "text/plain" }),
  source: "upload" as const,
});

function setup() {
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("File", NodeFile);
  const factory = new IDBFactory();
  const client = () => {
    // Each composer gets an independent connection, as in separate windows.
    const database = new DraftDatabase(() => factory);
    const repository = new ConversationDraftRepository(database);
    const port = withConversationDocument(
      createBrowserAttachmentDraftPort(scope, channel, repository),
      scope,
      channel,
      repository
    );
    const flushFiles = () =>
      repository.flush(draftKey(scope, channel) + ":files");
    return { database, repository, port, flushFiles };
  };
  const restoredContents = async () => {
    const result = await client().port.restore();
    return Promise.all(result.attachments.map((item) => item.file.text()));
  };
  const writeLegacyRemoval = async (
    databaseName: string,
    revision?: string
  ) => {
    const connection = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = connection.transaction(
          "attachmentIntents",
          "readwrite"
        );
        const conversation = draftKey(scope, channel);
        transaction.objectStore("attachmentIntents").put({
          key: JSON.stringify([conversation, attachmentId]),
          conversation,
          account: draftAccountKey(scope),
          removed: true,
          ...(revision ? { revision } : {}),
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () =>
          reject(transaction.error);
      });
    } finally {
      connection.close();
    }
  };
  return { client, restoredContents, writeLegacyRemoval };
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

it("restores a new attachment generation staged after an older document removed that ID", async () => {
  const { client, restoredContents } = setup();
  const first = client();
  await first.port.restore();
  expect(await first.port.stage(attachment("original bytes"))).toBe(true);
  await first.port.saveDocument!(withFile);
  await first.port.saveDocument!(empty);
  expect(await restoredContents()).toEqual([]);

  const replacement = client();
  await replacement.port.restore();
  expect(await replacement.port.stage(attachment("replacement bytes"))).toBe(
    true
  );
  expect(replacement.port.canLeave([attachmentId])).toBe(true);
  expect(await restoredContents()).toEqual(["replacement bytes"]);
});

it("does not let an older document remove a same-ID replacement staged in another connection", async () => {
  const { client, restoredContents } = setup();
  const original = client();
  await original.port.restore();
  await original.port.stage(attachment("original bytes"));
  await original.port.saveDocument!(withFile);

  const replacement = client();
  await replacement.port.restore();
  await replacement.port.stage(attachment("replacement bytes"));
  await original.port.saveDocument!(empty);

  expect(await restoredContents()).toEqual(["replacement bytes"]);
});

it.each(["before reservation", "after reservation"] as const)(
  "does not let a failed older send remove a foreign replacement staged %s",
  async (replacementTiming) => {
    const { client, restoredContents } = setup();
    const original = client();
    await original.port.restore();
    const originalFile = attachment("original bytes");
    await original.port.stage(originalFile);
    original.port.syncLive([attachmentId], [originalFile]);
    await original.port.saveDocument!(withFile);

    const replacement = client();
    await replacement.port.restore();
    if (replacementTiming === "before reservation")
      await replacement.port.stage(attachment("replacement bytes"));

    const send = original.port.beginSend([attachmentId]);
    await send.ready;
    if (replacementTiming === "after reservation")
      await replacement.port.stage(attachment("replacement bytes"));

    await send.settle([attachmentId]);
    expect(original.port.canLeave([attachmentId])).toBe(false);
    expect(await restoredContents()).toEqual(["replacement bytes"]);

    original.port.syncLive([]);
    await original.flushFiles();
    expect(await restoredContents()).toEqual(["replacement bytes"]);
  }
);

it("does not adopt another connection's replacement while reserving or settling an older send", async () => {
  const { client, restoredContents } = setup();
  const original = client();
  await original.port.restore();
  await original.port.stage(attachment("original bytes"));
  await original.port.saveDocument!(withFile);

  const replacement = client();
  await replacement.port.restore();
  await replacement.port.stage(attachment("replacement bytes"));

  const send = original.port.beginSend([attachmentId]);
  await send.ready;
  await original.port.saveDocument!(empty);
  await send.settle([]);

  expect(await restoredContents()).toEqual(["replacement bytes"]);
});

it("fences a pending stage removed by the document while allowing a later new generation", async () => {
  const { client, restoredContents } = setup();
  const original = client();
  await original.port.restore();
  const entered = deferred();
  const gate = deferred();
  const change = original.database.changeAttachments.bind(original.database);
  vi.spyOn(original.database, "changeAttachments").mockImplementationOnce(
    async (...args) => {
      entered.resolve();
      await gate.promise;
      return change(...args);
    }
  );
  const pending = original.port.stage(attachment("obsolete pending bytes"));
  await entered.promise;
  await original.port.saveDocument!(withFile);
  await original.port.saveDocument!(empty);
  gate.resolve();
  await pending;
  await original.flushFiles();
  expect(await restoredContents()).toEqual([]);

  const replacement = client();
  await replacement.port.restore();
  expect(await replacement.port.stage(attachment("replacement bytes"))).toBe(
    true
  );
  expect(await restoredContents()).toEqual(["replacement bytes"]);
});

it("keeps a failed stage's generation stable when retried after its document removed the attachment", async () => {
  const { client, restoredContents } = setup();
  const original = client();
  await original.port.restore();
  const attemptedRevisions: string[] = [];
  const put = IDBObjectStore.prototype.put;
  let quotaFailure = true;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    value,
    key
  ) {
    if (this.name === "attachments" && value.id === attachmentId) {
      attemptedRevisions.push(value.revision);
      if (quotaFailure) {
        quotaFailure = false;
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
    }
    return key === undefined
      ? put.call(this, value)
      : put.call(this, value, key);
  });
  expect(await original.port.stage(attachment("failed original bytes"))).toBe(
    false
  );
  await original.port.saveDocument!(withFile);
  await original.port.saveDocument!(empty);
  await original.flushFiles();

  expect(await restoredContents()).toEqual([]);
  expect(attemptedRevisions.length).toBeGreaterThanOrEqual(1);
  expect(new Set(attemptedRevisions).size).toBe(1);

  const replacement = client();
  await replacement.port.restore();
  expect(await replacement.port.stage(attachment("replacement bytes"))).toBe(
    true
  );
  expect(await restoredContents()).toEqual(["replacement bytes"]);
});

it("does not let an older failed stage overwrite a same-ID replacement when retried", async () => {
  const { client, restoredContents } = setup();
  const original = client();
  await original.port.restore();
  const put = IDBObjectStore.prototype.put;
  let quotaFailure = true;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    value,
    key
  ) {
    if (
      quotaFailure &&
      this.name === "attachments" &&
      value.id === attachmentId
    ) {
      quotaFailure = false;
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    }
    return key === undefined
      ? put.call(this, value)
      : put.call(this, value, key);
  });
  expect(await original.port.stage(attachment("obsolete failed bytes"))).toBe(
    false
  );

  const replacement = client();
  await replacement.port.restore();
  expect(await replacement.port.stage(attachment("replacement bytes"))).toBe(
    true
  );
  expect(await restoredContents()).toEqual(["replacement bytes"]);

  // A conflict may remain retryable, but must never replace the newer bytes.
  await original.flushFiles().catch(() => {});
  expect(await restoredContents()).toEqual(["replacement bytes"]);
});

it.each(["document only", "failed cleanup"] as const)(
  "does not resurrect earlier bytes after a same-port replacement fails and removal uses %s",
  async (removal) => {
    const { client, restoredContents } = setup();
    const current = client();
    await current.port.restore();
    const original = attachment("earlier stored bytes");
    await current.port.stage(original);
    current.port.syncLive([attachmentId], [original]);
    await current.port.saveDocument!(withFile);

    const mutations = vi.spyOn(current.database, "changeAttachments");
    mutations.mockRejectedValueOnce(
      new DOMException("Quota exceeded", "QuotaExceededError")
    );
    expect(
      await current.port.stage(attachment("failed replacement bytes"))
    ).toBe(false);
    if (removal === "failed cleanup") {
      vi.spyOn(current.database, "setAttachmentPresence").mockRejectedValue(
        new Error("disk busy")
      );
      mutations.mockRejectedValue(new Error("disk busy"));
      current.port.syncLive([]);
    }
    await current.port.saveDocument!(empty);
    if (removal === "failed cleanup") {
      await expect(current.flushFiles()).rejects.toThrow();
    } else {
      await current.flushFiles();
    }

    expect(await restoredContents()).toEqual([]);
  }
);

it.each(["files", "IDs"] as const)(
  "restores the original bytes after durable removal and same-port undo with %s",
  async (payload) => {
    const { client, restoredContents } = setup();
    const current = client();
    await current.port.restore();
    const file = attachment("undo bytes");
    await current.port.stage(file);
    current.port.syncLive([attachmentId], [file]);
    await current.port.saveDocument!(withFile);
    current.port.syncLive([]);
    await current.port.saveDocument!(empty);
    await current.flushFiles();
    expect(await restoredContents()).toEqual([]);

    current.port.syncLive(
      [attachmentId],
      payload === "files" ? [file] : undefined
    );
    await current.port.saveDocument!(withFile);
    await current.flushFiles();

    expect(current.port.canLeave([attachmentId])).toBe(true);
    expect(await restoredContents()).toEqual(["undo bytes"]);
  }
);

it.each(["revisionless", "specific revision"] as const)(
  "restores a newly staged generation after a legacy %s removal",
  async (legacyFormat) => {
    const { client, restoredContents, writeLegacyRemoval } = setup();
    const original = client();
    await original.port.restore();
    await original.port.stage(attachment("legacy original bytes"));
    const [stored] = await original.database.list<StoredAttachment>(
      "attachments",
      "conversation",
      draftKey(scope, channel)
    );
    await writeLegacyRemoval(
      original.database.name,
      legacyFormat === "specific revision" ? stored.revision : undefined
    );
    expect(await restoredContents()).toEqual([]);

    const replacement = client();
    await replacement.port.restore();
    expect(await replacement.port.stage(attachment("replacement bytes"))).toBe(
      true
    );
    expect(await restoredContents()).toEqual(["replacement bytes"]);
  }
);

it.each(["revisionless", "specific revision"] as const)(
  "prefers current generation presence over a legacy %s removal",
  async (legacyFormat) => {
    const { client, restoredContents, writeLegacyRemoval } = setup();
    const current = client();
    await current.port.restore();
    await current.port.stage(attachment("explicitly present bytes"));
    await current.port.saveDocument!(withFile);
    const [stored] = await current.database.list<StoredAttachment>(
      "attachments",
      "conversation",
      draftKey(scope, channel)
    );
    await writeLegacyRemoval(
      current.database.name,
      legacyFormat === "specific revision" ? stored.revision : undefined
    );

    expect(await restoredContents()).toEqual(["explicitly present bytes"]);
  }
);
