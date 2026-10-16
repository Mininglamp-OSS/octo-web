import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { File as NodeFile } from "node:buffer";
import {
  DraftConflictError,
  DraftDatabase,
  DraftSessionExpiredError,
} from "./database";
import { ConversationDraftRepository } from "./repository";
import { createBrowserAttachmentDraftPort } from "./browserPort";
import { withConversationDocument } from "./documentPort";
import {
  conversationDraftPreview,
  mergeConflictingDrafts,
  draftKey,
  type ConversationDraft,
  type DraftRecord,
} from "./model";

const scope = {
  server: "https://example.test",
  account: "alice",
  space: "space-a",
};
const channel = { id: "chat-a", type: 2 };
const document = (text: string): ConversationDraft => ({
  document: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
  topAttachments: [],
});
function fixture() {
  const factory = new IDBFactory();
  const db = new DraftDatabase(() => factory);
  const repository = new ConversationDraftRepository(db);
  const port = (repo = repository) =>
    withConversationDocument(
      createBrowserAttachmentDraftPort(scope, channel, repo),
      scope,
      channel,
      repo
    );
  return { db, repository, port, factory };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("conversation draft preview", () => {
  it("keeps both conflict texts but does not duplicate shared attachment identities", () => {
    const local = document("local");
    const remote = document("remote");
    const image = {
      type: "attachment",
      attrs: { id: "shared", name: "shot.png" },
    };
    local.document.content![0].content!.push(image);
    remote.document.content![0].content!.unshift(image);
    remote.topAttachments = [{ id: "upload", name: "a.zip", position: 2 }];
    const merged = mergeConflictingDrafts(local, remote, 4);
    expect(conversationDraftPreview(merged)).toBe(
      "local[shot.png] [a.zip]remote"
    );
    expect(JSON.stringify(merged.document).match(/shared/g)).toHaveLength(1);
  });
  it("interleaves upload anchors, inline images and text in editor order", () => {
    const draft = document("beforeafter");
    draft.document.content![0].content!.push({
      type: "attachment",
      attrs: { id: "image", name: "shot.png" },
    });
    draft.topAttachments = [
      { id: "a", name: "a.zip", position: 1 },
      { id: "b", name: "b.md", position: 7 },
    ];
    expect(conversationDraftPreview(draft)).toBe(
      "[a.zip]before[b.md]after[shot.png]"
    );
  });
  it("retains same-position insertion order and readable mentions", () => {
    const draft: ConversationDraft = {
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "mention", attrs: { id: "u", label: "Ada" } }],
          },
        ],
      },
      topAttachments: [
        { id: "a", name: "same.zip", position: 1 },
        { id: "b", name: "same.zip", position: 1 },
      ],
    };
    expect(conversationDraftPreview(draft)).toBe("[same.zip][same.zip]@Ada");
  });
});

describe("local draft persistence", () => {
  it.each([
    { cleanup: "same", held: false },
    { cleanup: "other", held: false },
    { cleanup: "same", held: true },
    { cleanup: "other", held: true },
  ])("preserves a new session's draft after $cleanup-repository logout (consumption held: $held)", async ({ cleanup, held }) => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const { db, repository, port, factory } = fixture();
    const stale = port();
    await stale.restore();
    await stale.saveDocument!(document("old send"));
    stale.stopDocumentSaving!();
    const key = draftKey(scope, channel);
    expect(await db.read<DraftRecord>("drafts", key)).toMatchObject({ revision: 1 });

    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const consume = db.consumeDraft.bind(db);
    if (held) {
      vi.spyOn(db, "consumeDraft").mockImplementationOnce(async (...args) => {
        entered();
        await gate;
        return consume(...args);
      });
    }
    const rejected = held
      ? expect(stale.consumeStoppedDocument!()).rejects.toBeInstanceOf(DraftSessionExpiredError)
      : undefined;
    if (held) await started;

    const revoker = cleanup === "same"
      ? repository
      : new ConversationDraftRepository(new DraftDatabase(() => factory));
    await revoker.clearAccount(scope);
    const freshDb = new DraftDatabase(() => factory);
    const fresh = port(new ConversationDraftRepository(freshDb));
    await fresh.saveDocument!(document("new unsent draft"));
    const saved = await freshDb.read<DraftRecord>("drafts", key);
    // Cleanup resets the document revision: CAS alone cannot distinguish sessions.
    expect(saved).toMatchObject({ revision: 1 });

    if (held) {
      release();
      await rejected;
    } else {
      await expect(stale.consumeStoppedDocument!()).rejects.toBeInstanceOf(DraftSessionExpiredError);
    }
    expect(await freshDb.read("drafts", key)).toEqual(saved);
    expect((await port(new ConversationDraftRepository(freshDb)).restore()).document)
      .toEqual(document("new unsent draft"));
  });
  it("does not let a late temporary send consume a replacement after consumption", async () => {
    const { db, repository, port } = fixture();
    await repository.save(scope, channel, document("original"));
    const first = port(new ConversationDraftRepository(db));
    const late = port(new ConversationDraftRepository(db));
    await first.restore();
    await late.restore();
    first.stopDocumentSaving!();
    late.stopDocumentSaving!();

    await first.consumeStoppedDocument!();
    const key = draftKey(scope, channel);
    expect(await db.read<DraftRecord>("drafts", key)).toMatchObject({
      revision: 2,
      consumed: true,
      preview: "",
    });

    const replacement = new ConversationDraftRepository(db);
    await replacement.load(scope, channel);
    await replacement.save(scope, channel, document("replacement"));
    await expect(late.consumeStoppedDocument!()).rejects.toBeInstanceOf(
      DraftConflictError
    );
    expect(
      await new ConversationDraftRepository(db).load(scope, channel)
    ).toEqual(document("replacement"));
  });
  it("does not consume a newer document when temporary sending settles late", async () => {
    const { db, port } = fixture();
    const temporary = port();
    await temporary.restore();
    await temporary.saveDocument!(document("saved copy"));
    temporary.stopDocumentSaving!();
    const other = new ConversationDraftRepository(db);
    await other.load(scope, channel);
    await other.save(scope, channel, document("newer window"));
    await expect(temporary.consumeStoppedDocument!()).rejects.toBeInstanceOf(
      DraftConflictError
    );
    expect(await new ConversationDraftRepository(db).load(scope, channel)).toEqual(
      document("newer window")
    );
  });
  it("merges conflicting drafts explicitly and permits subsequent saves", async () => {
    const { db, repository } = fixture();
    const other = new ConversationDraftRepository(db);
    await repository.load(scope, channel);
    await other.save(scope, channel, document("other"));
    await expect(
      repository.save(scope, channel, document("local"))
    ).rejects.toThrow("another window");
    await repository.mergeConflict(scope, channel, document("latest local"));
    expect(repository.preview(scope, channel)).toBe("latest local other");
    await expect(
      repository.flush(draftKey(scope, channel))
    ).resolves.toBeUndefined();
    await repository.save(scope, channel, document("reviewed result"));
    expect(
      await new ConversationDraftRepository(db).load(scope, channel)
    ).toEqual(document("reviewed result"));
  });
  it.each([false, true])(
    "retains a file when removal is undone during the queued/inflight deletion (inflight=%s)",
    async (inflight) => {
      vi.stubGlobal("File", NodeFile);
      const { db, repository, port } = fixture();
      const current = port();
      await current.restore();
      const file = {
        id: "undo",
        file: new File(["image"], "image.png", { type: "image/png" }),
        source: "paste" as const,
      };
      await current.stage(file);
      current.syncLive([file.id], [file]);
      let started!: () => void;
      const starting = new Promise<void>((resolve) => {
        started = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = db.changeAttachments.bind(db);
      if (inflight)
        vi.spyOn(db, "changeAttachments").mockImplementationOnce(
          async (...args) => {
            started();
            await gate;
            return original(...args);
          }
        );
      current.syncLive([]);
      if (inflight) await starting;
      current.syncLive([file.id], [file]);
      release();
      await repository.flush(draftKey(scope, channel) + ":files");
      expect(
        (await port().restore()).attachments.map((item) => item.id)
      ).toEqual([file.id]);
      expect(current.canLeave([file.id])).toBe(true);
    }
  );
  it("restores after reload, isolates account/space/channel, and retains empty tombstones", async () => {
    const { db, repository } = fixture();
    await repository.save(scope, channel, document("only here"));
    const reload = new ConversationDraftRepository(db);
    expect(await reload.load(scope, channel)).toEqual(document("only here"));
    expect(
      await reload.load({ ...scope, account: "bob" }, channel)
    ).toBeUndefined();
    expect(
      await reload.load({ ...scope, space: "space-b" }, channel)
    ).toBeUndefined();
    expect(await reload.load(scope, { ...channel, type: 1 })).toBeUndefined();
    await reload.save(scope, channel, document(""));
    expect(
      (await new ConversationDraftRepository(db).load(scope, channel))?.document
        .content![0].content![0].text
    ).toBe("");
  });
  it("does not let an older window overwrite a newer draft", async () => {
    const { db, repository } = fixture();
    const stale = new ConversationDraftRepository(db);
    await stale.load(scope, channel);
    await repository.save(scope, channel, document("newer"));
    await expect(stale.save(scope, channel, document("older"))).rejects.toThrow(
      "another window"
    );
    expect(stale.saved(draftKey(scope, channel))).toBe(false);
    expect(
      await new ConversationDraftRepository(db).load(scope, channel)
    ).toEqual(document("newer"));
  });
  it("revokes ports on logout and clears documents and files", async () => {
    vi.stubGlobal("File", NodeFile);
    const { repository, port } = fixture();
    const old = port();
    await old.restore();
    await old.stage({
      id: "file",
      file: new File(["a"], "a.zip"),
      source: "upload",
    });
    await old.saveDocument!(document("secret"));
    await repository.clearAccount(scope);
    await expect(old.saveDocument!(document("stale"))).rejects.toBeInstanceOf(
      DraftSessionExpiredError
    );
    expect(
      await old.stage({
        id: "late",
        file: new File(["a"], "b.zip"),
        source: "upload",
      })
    ).toBe(false);
    expect((await port().restore()).attachments).toEqual([]);
    expect(await repository.load(scope, channel)).toBeUndefined();
  });
  it("persists file bytes and names, removes only sent attachments, and retains unsent siblings", async () => {
    vi.stubGlobal("File", NodeFile);
    const { port } = fixture();
    const original = port();
    await original.restore();
    for (const id of ["a", "b"])
      expect(
        await original.stage({
          id,
          file: new File([id], id + ".zip"),
          source: "upload",
        })
      ).toBe(true);
    const restored = await port().restore();
    expect(restored.attachments.map((item) => item.file.name)).toEqual([
      "a.zip",
      "b.zip",
    ]);
    expect(await restored.attachments[0].file.text()).toBe("a");
    const send = original.beginSend(["a", "b"]);
    await send.ready;
    expect((await port().restore()).attachments).toEqual([]);
    await send.settle(["b"]);
    expect((await port().restore()).attachments.map((item) => item.id)).toEqual(
      ["b"]
    );
  });
  it("keeps empty restores from deleting unseen files and supports removal/undo", async () => {
    vi.stubGlobal("File", NodeFile);
    const { port, repository } = fixture();
    const file = {
      id: "a",
      file: new File(["a"], "a.zip"),
      source: "upload" as const,
    };
    const first = port();
    await first.stage(file);
    const next = port();
    await next.restore();
    next.syncLive([]);
    expect((await port().restore()).attachments).toHaveLength(1);
    next.syncLive(["a"]);
    next.syncLive([]);
    await repository.flush(draftKey(scope, channel) + ":files");
    expect((await port().restore()).attachments).toHaveLength(0);
    next.syncLive(["a"], [file]);
    await repository.flush(draftKey(scope, channel) + ":files");
    expect((await port().restore()).attachments).toHaveLength(1);
  });
  it("does not let an old send delete a newer attachment generation", async () => {
    vi.stubGlobal("File", NodeFile);
    const { port } = fixture();
    const old = port();
    await old.stage({
      id: "same-id",
      file: new File(["old"], "a.zip"),
      source: "upload",
    });
    const send = old.beginSend(["same-id"]);
    await send.ready;
    const current = port();
    await current.stage({
      id: "same-id",
      file: new File(["new"], "a.zip"),
      source: "upload",
    });
    await send.settle([]);
    const restored = await port().restore();
    expect(await restored.attachments[0].file.text()).toBe("new");
  });
  it("does not let document consumption hide a same-id attachment replacement", async () => {
    vi.stubGlobal("File", NodeFile);
    const { db, port } = fixture();
    const old = port();
    await old.restore();
    await old.stage({
      id: "same-id",
      file: new File(["old"], "old.zip"),
      source: "upload",
    });
    await old.saveDocument!({
      ...document("old"),
      topAttachments: [
        { id: "same-id", name: "old.zip", position: 1 },
      ],
    });
    old.stopDocumentSaving!();
    const send = old.beginSend(["same-id"]);
    await send.ready;

    const replacement = port(new ConversationDraftRepository(db));
    await replacement.stage({
      id: "same-id",
      file: new File(["new"], "new.zip"),
      source: "upload",
    });
    await old.consumeStoppedDocument!(
      [],
      send.attachmentRevisions
    );
    await send.settle([]);

    const restored = await port(new ConversationDraftRepository(db)).restore();
    expect(restored.attachments).toHaveLength(1);
    expect(restored.attachments[0].file.name).toBe("new.zip");
    expect(await restored.attachments[0].file.text()).toBe("new");
  });
  it("retains unsaved document content and retries a failed write on the next save", async () => {
    const { db, repository } = fixture();
    vi.spyOn(db, "writeDraft").mockRejectedValueOnce(new Error("quota"));
    await expect(
      repository.save(scope, channel, document("keep me"))
    ).rejects.toThrow("quota");
    expect(repository.preview(scope, channel)).toBe("keep me");
    expect(repository.saved(draftKey(scope, channel))).toBe(false);
    await repository.save(scope, channel, document("keep me"));
    expect(
      await new ConversationDraftRepository(db).load(scope, channel)
    ).toEqual(document("keep me"));
  });
  it("does not let a rejected reservation block settlement of an earlier send", async () => {
    vi.stubGlobal("File", NodeFile);
    const { port } = fixture();
    const current = port();
    await current.stage({
      id: "a",
      file: new File(["a"], "a.zip"),
      source: "upload",
    });
    const first = current.beginSend(["a"]);
    await first.ready;
    const duplicate = current.beginSend(["a"]);
    await expect(duplicate.ready).rejects.toThrow("already being sent");
    await duplicate.settle(["a"]);
    await first.settle(["a"]);
    expect((await port().restore()).attachments.map((item) => item.id)).toEqual(
      ["a"]
    );
  });
  it("keeps files when generating a send reservation fails", async () => {
    vi.stubGlobal("File", NodeFile);
    const { port } = fixture();
    const current = port();
    await current.stage({
      id: "a",
      file: new File(["a"], "a.zip"),
      source: "upload",
    });
    vi.spyOn(crypto, "getRandomValues").mockImplementationOnce(() => {
      throw new Error("random unavailable");
    });
    const send = current.beginSend(["a"]);
    await expect(send.ready).rejects.toThrow("random unavailable");
    await send.settle(["a"]);
    expect((await port().restore()).attachments).toHaveLength(1);
  });
  it("retries failed deletion after unmount before restoring the conversation", async () => {
    vi.stubGlobal("File", NodeFile);
    const { db, repository, port } = fixture();
    const old = port();
    await old.stage({
      id: "a",
      file: new File(["a"], "a.zip"),
      source: "upload",
    });
    vi.spyOn(db, "changeAttachments").mockRejectedValueOnce(
      new Error("disk busy")
    );
    old.syncLive([]);
    await expect(
      repository.flush(draftKey(scope, channel) + ":files")
    ).rejects.toThrow("disk busy");
    expect((await port().restore()).attachments).toEqual([]);
  });
});
