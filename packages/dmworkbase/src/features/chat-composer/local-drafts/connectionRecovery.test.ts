import { afterEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { DraftDatabase, DraftConflictError, DraftSessionExpiredError } from "./database";
import { ConversationDraftRepository } from "./repository";
import { draftAccountKey, draftKey, type ConversationDraft } from "./model";

const scope = { server: "test", account: "alice", space: "s" };
const channel = { id: "a", type: 2 };
const draft: ConversationDraft = { document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "saved" }] }] }, topAttachments: [] };
function setup() {
  vi.stubGlobal("BroadcastChannel", undefined);
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
  return { factory, connections, db, repository };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([true, false])("reopens closed connections for reads and mutations (close event=%s)", async notify => {
  const { connections, db, repository } = setup();
  await repository.save(scope, channel, draft);
  const first = connections[0];
  first.close();
  // fake-indexeddb has no browser-pressure event: close the real handle and
  // explicitly deliver the abnormal-close notification when requested.
  if (notify) first.onclose?.call(first, new Event("close"));
  expect(await db.read("drafts", draftKey(scope, channel))).toBeDefined();
  expect(connections).toHaveLength(2);
  connections[1].close();
  if (notify) connections[1].onclose?.call(connections[1], new Event("close"));
  await repository.save(scope, channel, { ...draft, topAttachments: [{ id: "new", name: "new.zip", position: 1 }] });
  expect(connections).toHaveLength(3);
  expect(await db.list("drafts", "account", draftAccountKey(scope))).toHaveLength(1);
  expect(await db.restoreAttachments(draftKey(scope, channel))).toEqual([]);
  // A delayed event from an old connection cannot invalidate the new one.
  first.onclose?.call(first, new Event("close"));
  await db.session(draftAccountKey(scope));
  expect(connections).toHaveLength(3);
});

it("reconnection does not adopt a post-logout account generation", async () => {
  const { factory, connections, db, repository } = setup();
  await repository.save(scope, channel, draft);
  const session = await repository.session(scope);
  connections[0].close();
  await new DraftDatabase(() => factory).clearAccount(draftAccountKey(scope));
  await expect(repository.save(scope, channel, { ...draft, topAttachments: [{ id: "stale", name: "stale", position: 1 }] })).rejects.toBeInstanceOf(DraftSessionExpiredError);
  await expect(db.changeAttachments(draftKey(scope, channel), records => records, session)).rejects.toBeInstanceOf(DraftSessionExpiredError);
  expect(await repository.session(scope)).toEqual(session);
  expect(await db.list("drafts", "account", session.account)).toEqual([]);
});


it("limits closed-handle retry to one and permits a later explicit retry", async () => {
  const { factory, connections, db } = setup();
  const open = vi.mocked(factory.open).getMockImplementation()!;
  const failing = vi.spyOn(factory, "open").mockImplementation((...args) => {
    const request = open(...args);
    request.addEventListener("success", () => request.result.close());
    return request;
  });
  await expect(db.read("drafts", "missing")).rejects.toMatchObject({ name: "InvalidStateError" });
  expect(failing).toHaveBeenCalledTimes(2);
  failing.mockImplementation(open);
  expect(await db.read("drafts", "missing")).toBeUndefined();
  expect(connections).toHaveLength(3);
});

it("preserves document CAS across reconnect and never replays a failed mutation", async () => {
  const { factory, connections, db, repository } = setup();
  await repository.save(scope, channel, draft);
  const other = new ConversationDraftRepository(new DraftDatabase(() => factory));
  await other.load(scope, channel);
  await other.save(scope, channel, { ...draft, topAttachments: [{ id: "newer", name: "newer", position: 1 }] });
  connections[0].close();
  await expect(repository.save(scope, channel, { ...draft, topAttachments: [{ id: "stale", name: "stale", position: 1 }] })).rejects.toBeInstanceOf(DraftConflictError);
  const change = vi.fn(() => { throw new DOMException("Mutation failed", "InvalidStateError"); });
  await expect(db.changeAttachments(draftKey(scope, channel), change, await repository.session(scope))).rejects.toMatchObject({ name: "InvalidStateError" });
  expect(change).toHaveBeenCalledOnce();
  expect(connections).toHaveLength(3);
});
