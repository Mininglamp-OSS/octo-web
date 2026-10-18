import { afterEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { DraftDatabase, DraftSessionExpiredError, type StoredAttachment } from "./database";
import { ConversationDraftRepository } from "./repository";
import { draftAccountKey, draftKey, type ConversationDraft } from "./model";
import { runSessionCleanup, SESSION_CLEANUP_TIMEOUT_MS } from "../../../Service/sessionCleanup";

const scope = { server: "test", account: "alice", space: "s" };
const channel = { id: "a", type: 2 };
const account = draftAccountKey(scope);
const key = draftKey(scope, channel);
const draft: ConversationDraft = {
  document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "private" }] }] },
  topAttachments: [],
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function setup() {
  vi.stubGlobal("BroadcastChannel", undefined);
  const factory = new IDBFactory();
  const db = new DraftDatabase(() => factory, "logout-barrier-" + crypto.randomUUID());
  const repository = new ConversationDraftRepository(db);
  await repository.save(scope, channel, draft);
  const session = await repository.session(scope);
  const file: StoredAttachment = {
    key: JSON.stringify([key, "secret"]), conversation: key, account, id: "secret",
    file: new Blob(["private bytes"]), name: "secret", lastModified: 1,
    revision: "original", source: "upload", position: 1,
  };
  await db.changeAttachments(key, () => [file], session);
  const other = { ...scope, account: "bob" };
  await repository.save(other, channel, draft);
  const gate = deferred();
  const internals = db as unknown as { open(): Promise<IDBDatabase> };
  const open = internals.open.bind(db);
  vi.spyOn(internals, "open").mockImplementationOnce(async () => {
    await gate.promise;
    return open();
  });
  return { db, repository, session, gate, other, fresh: () => new DraftDatabase(() => factory, db.name) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("hides old text and blobs after cleanup times out, then resumes cleanup in a fresh renderer", async () => {
  const { db, repository, session, gate, other, fresh } = await setup();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const deletion = repository.clearAccount(scope);
  const teardown = runSessionCleanup(() => deletion, "[test]");
  await vi.advanceTimersByTimeAsync(SESSION_CLEANUP_TIMEOUT_MS);
  await teardown;
  vi.useRealTimers();

  // A reload loses every in-memory guard. The same durable database remains.
  const reopened = fresh();
  await expect(reopened.read("drafts", key)).rejects.toBeInstanceOf(DraftSessionExpiredError);
  await expect(reopened.read("attachments", JSON.stringify([key, "secret"]))).rejects.toBeInstanceOf(DraftSessionExpiredError);
  await expect(reopened.list("drafts", "account", account)).rejects.toBeInstanceOf(DraftSessionExpiredError);
  await expect(reopened.list("attachments", "conversation", key)).rejects.toBeInstanceOf(DraftSessionExpiredError);
  await expect(reopened.restoreAttachments(key)).rejects.toBeInstanceOf(DraftSessionExpiredError);
  await expect(db.changeAttachments(key, records => records, session)).rejects.toBeInstanceOf(DraftSessionExpiredError);

  const loggedIn = new ConversationDraftRepository(reopened);
  expect(await loggedIn.load(scope, channel)).toBeUndefined();
  expect(await reopened.restoreAttachments(key)).toEqual([]);
  expect(await loggedIn.load(other, channel)).toEqual(draft);
  await loggedIn.save(scope, channel, draft);
  // The old renderer resuming must not delete the new authenticated session.
  gate.resolve();
  await deletion;
  expect(await new ConversationDraftRepository(fresh()).load(scope, channel)).toEqual(draft);
  await expect(db.changeAttachments(key, records => records, session)).rejects.toBeInstanceOf(DraftSessionExpiredError);
});

it("does not let a session capture suspended before logout adopt the new generation", async () => {
  const { db, gate, fresh } = await setup();
  const capture = db.session(account);
  const expired = expect(capture).rejects.toBeInstanceOf(DraftSessionExpiredError);
  await fresh().clearAccount(account);
  gate.resolve();
  await expired;
});

it.each([false, true])("requires deletion when the synchronous barrier cannot persist (deletion fails=%s)", async fails => {
  const { repository, gate, fresh, db } = await setup();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const storage = localStorage;
  vi.stubGlobal("localStorage", {
    getItem: storage.getItem.bind(storage),
    setItem: () => { throw new DOMException("No storage", "QuotaExceededError"); },
  });
  if (fails) {
    // Reject after the synchronous barrier fails, as with a broken IDB open.
    vi.mocked((db as unknown as { open(): Promise<IDBDatabase> }).open)
      .mockReset().mockRejectedValueOnce(new Error("IDB unavailable"));
  }
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const deletion = repository.clearAccount(scope);
  expect(deletion.requireCompletion).toBe(true);
  const completed = vi.fn();
  const teardown = Promise.resolve(runSessionCleanup(() => deletion, "[test]")).then(completed);
  await vi.advanceTimersByTimeAsync(SESSION_CLEANUP_TIMEOUT_MS * 2);
  expect(completed).not.toHaveBeenCalled();
  vi.useRealTimers();
  gate.resolve();
  if (fails) {
    await expect(deletion).rejects.toThrow("IDB unavailable");
    expect(completed).not.toHaveBeenCalled();
  } else {
    await teardown;
    expect(completed).toHaveBeenCalledOnce();
    expect(await fresh().read("drafts", key)).toBeUndefined();
    expect(await fresh().restoreAttachments(key)).toEqual([]);
  }
});

it("keeps a failed deletion fenced and retries it on the next login", async () => {
  const { repository, db, fresh } = await setup();
  vi.mocked((db as unknown as { open(): Promise<IDBDatabase> }).open)
    .mockReset().mockRejectedValueOnce(new Error("IDB unavailable"));
  await expect(repository.clearAccount(scope)).rejects.toThrow("IDB unavailable");
  await expect(fresh().read("drafts", key)).rejects.toBeInstanceOf(DraftSessionExpiredError);
  const loggedIn = new ConversationDraftRepository(fresh());
  expect(await loggedIn.load(scope, channel)).toBeUndefined();
  await loggedIn.save(scope, channel, draft);
  expect(await fresh().read("drafts", key)).toBeDefined();
});
