import { Channel, Subscriber } from "wukongimjssdk";
import APIClient from "./APIClient";
import { apiPath } from "./apiPath";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function member(value: unknown, channel: Channel): Subscriber {
  if (!record(value) || typeof value.uid !== "string" || !value.uid ||
      typeof value.role !== "number") {
    throw new Error("Invalid group member response");
  }
  const row = new Subscriber();
  row.uid = value.uid;
  row.channel = channel;
  row.name = typeof value.name === "string" ? value.name : "";
  row.remark = typeof value.remark === "string" ? value.remark : "";
  row.role = value.role;
  row.status = typeof value.status === "number" ? value.status : 1;
  row.isDeleted = value.is_deleted === 1 || value.is_deleted === true;
  row.orgData = value;
  return row;
}

/** Existing REST endpoints; malformed/failed reads never mean "not a member". */
export const ChannelMemberService = {
  async page(channel: Channel, page: number, limit: number, signal?: AbortSignal) {
    const data = await APIClient.shared.get<unknown>(
      apiPath`groups/${encodeURIComponent(channel.channelID)}/members`,
      { param: { page, limit }, signal }
    );
    if (!Array.isArray(data)) throw new Error("Invalid group member page");
    return data.map((row) => member(row, channel));
  },
  async lookup(channel: Channel, uid: string, signal?: AbortSignal) {
    const data = await APIClient.shared.get<unknown>(
      apiPath`groups/${encodeURIComponent(channel.channelID)}/members/${encodeURIComponent(uid)}`,
      { signal }
    );
    if (record(data) && data.exists === false) return undefined;
    if (!record(data) || data.exists !== true) {
      throw new Error("Invalid group member lookup");
    }
    const row = member(data.member, channel);
    if (row.uid !== uid) throw new Error("Group member uid mismatch");
    return row;
  },
};
