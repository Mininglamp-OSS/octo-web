import { beforeEach, describe, expect, it, vi } from "vitest";
import { Contacts, DataSource } from "../DataSource";

const contact = (uid: string, version: string): Contacts =>
  ({ uid, version, name: uid } as Contacts);

describe("DataSource contacts", () => {
  let dataSource: DataSource;
  let contactsSync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dataSource = new DataSource();
    contactsSync = vi.fn();
    dataSource.commonDataSource = { contactsSync } as any;
  });

  it("syncs from an empty list with an empty version and appends contacts", async () => {
    const first = contact("u1", "v1");
    contactsSync.mockResolvedValue([first]);
    const listener = vi.fn();
    dataSource.addContactsChangeListener(listener);

    await dataSource.contactsSync();

    expect(contactsSync).toHaveBeenCalledWith("");
    expect(dataSource.contactsList).toEqual([first]);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("uses the last contact version for incremental sync", async () => {
    const existing = contact("u1", "v1");
    const next = contact("u2", "v2");
    dataSource.contactsList = [existing];
    contactsSync.mockResolvedValue([next]);

    await dataSource.contactsSync();

    expect(contactsSync).toHaveBeenCalledWith("v1");
    expect(dataSource.contactsList).toEqual([existing, next]);
  });

  it("replaces contacts with the same uid instead of duplicating them", async () => {
    const oldContact = contact("u1", "v1");
    const updatedContact = contact("u1", "v2");
    dataSource.contactsList = [oldContact];
    contactsSync.mockResolvedValue([updatedContact]);

    await dataSource.contactsSync();

    expect(dataSource.contactsList).toEqual([updatedContact]);
  });

  it("keeps the list and skips notification for an empty response", async () => {
    const existing = contact("u1", "v1");
    dataSource.contactsList = [existing];
    contactsSync.mockResolvedValue([]);
    const listener = vi.fn();
    dataSource.addContactsChangeListener(listener);

    await dataSource.contactsSync();

    expect(dataSource.contactsList).toEqual([existing]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("propagates sync errors without changing contacts", async () => {
    const existing = contact("u1", "v1");
    const error = new Error("sync failed");
    dataSource.contactsList = [existing];
    contactsSync.mockRejectedValue(error);

    await expect(dataSource.contactsSync()).rejects.toBe(error);
    expect(dataSource.contactsList).toEqual([existing]);
  });

  it("notifies all listeners and removes only the requested listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    dataSource.addContactsChangeListener(first);
    dataSource.addContactsChangeListener(second);
    dataSource.removeContactsChangeListener(first);

    dataSource.notifyContactsChange();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
