import type { MockSeed } from "./seed-types";

export const communicationDefaultSeed: MockSeed = {
  currentUid: "e2e-user",
  spaceId: "e2e-space",
  users: [
    {
      uid: "e2e-contact-human",
      name: "E2E 联系人",
      robot: 0,
      extra: { follow: 1 },
    },
    {
      uid: "e2e-contact-bot",
      name: "E2E 助手",
      robot: 1,
      extra: { follow: 1, robot: 1 },
    },
  ],
  groups: [
    {
      group_no: "e2e-contact-group",
      name: "E2E 项目群",
      extra: { member_count: 3 },
    },
  ],
  conversations: [],
  messages: [],
  subscribers: [],
};
