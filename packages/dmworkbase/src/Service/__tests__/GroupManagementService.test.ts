import {
  Channel,
  ChannelTypeGroup,
  ChannelTypePerson,
} from "wukongimjssdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import APIClient from "../APIClient";
import {
  addGroupManagementManagers,
  disbandGroupManagement,
  listGroupManagementSubscribers,
  removeGroupManagementBotAdmin,
  removeGroupManagementManagers,
  setGroupManagementBotAdmin,
} from "../GroupManagementService";

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      delete: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => Promise.resolve([])),
      post: vi.fn(() => Promise.resolve()),
      put: vi.fn(() => Promise.resolve()),
    },
  },
}));

const apiDelete = APIClient.shared.delete as unknown as ReturnType<typeof vi.fn>;
const apiGet = APIClient.shared.get as unknown as ReturnType<typeof vi.fn>;
const apiPost = APIClient.shared.post as unknown as ReturnType<typeof vi.fn>;
const apiPut = APIClient.shared.put as unknown as ReturnType<typeof vi.fn>;

describe("GroupManagementService", () => {
  beforeEach(() => {
    apiDelete.mockClear();
    apiGet.mockClear();
    apiPost.mockClear();
    apiPut.mockClear();
    apiDelete.mockResolvedValue(undefined);
    apiGet.mockResolvedValue([]);
    apiPost.mockResolvedValue(undefined);
    apiPut.mockResolvedValue(undefined);
  });

  it("lists subscribers with paging params and maps member fields", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);
    apiGet.mockResolvedValue([
      {
        uid: "alice",
        name: "Alice",
        remark: "A",
        role: 2,
        version: 3,
        is_deleted: 0,
        status: 1,
      },
    ]);

    const members = await listGroupManagementSubscribers({
      channel,
      request: { limit: 50, page: 1 },
      avatarUser: (uid) => `avatar:${uid}`,
    });

    expect(apiGet).toHaveBeenCalledWith("groups/group-1/members", {
      param: { limit: 50, page: 1 },
    });
    expect(members).toHaveLength(1);
    expect(members[0].uid).toBe("alice");
    expect(members[0].name).toBe("Alice");
    expect(members[0].remark).toBe("A");
    expect(members[0].role).toBe(2);
    expect(members[0].version).toBe(3);
    expect(members[0].isDeleted).toBe(0);
    expect(members[0].status).toBe(1);
    expect(members[0].orgData.bot_admin).toBe(0);
    expect(members[0].avatar).toBe("avatar:alice");
  });

  it("keeps bot_admin from subscriber payload", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);
    apiGet.mockResolvedValue([{ uid: "bot", bot_admin: 1 }]);

    const members = await listGroupManagementSubscribers({
      channel,
      request: { limit: 50, page: 1 },
    });

    expect(members[0].orgData.bot_admin).toBe(1);
  });

  it("routes manager mutations to group manager endpoints", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);

    await addGroupManagementManagers(channel, ["alice", "bob"]);
    await removeGroupManagementManagers(channel, ["alice"]);

    expect(apiPost).toHaveBeenCalledWith("groups/group-1/managers", [
      "alice",
      "bob",
    ]);
    expect(apiDelete).toHaveBeenCalledWith("groups/group-1/managers", {
      data: ["alice"],
    });
  });

  it("routes bot admin mutations to bot admin endpoints", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);

    await setGroupManagementBotAdmin(channel, "bot-a");
    await removeGroupManagementBotAdmin(channel, "bot-a");

    expect(apiPut).toHaveBeenCalledWith("groups/group-1/bot_admin/bot-a");
    expect(apiDelete).toHaveBeenCalledWith(
      "groups/group-1/bot_admin/bot-a"
    );
  });

  it("disbands groups and keeps person channels as no-op", async () => {
    const group = new Channel("group-1", ChannelTypeGroup);
    const person = new Channel("alice", ChannelTypePerson);

    await disbandGroupManagement(group);
    await disbandGroupManagement(person);

    expect(apiDelete).toHaveBeenCalledTimes(1);
    expect(apiDelete).toHaveBeenCalledWith("groups/group-1/disband");
  });
});
