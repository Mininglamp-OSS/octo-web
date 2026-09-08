import { Subscriber } from "wukongimjssdk";

export function summarySubscriber(
  uid: string,
  fields: Partial<Subscriber> = {}
): Subscriber {
  return Object.assign(new Subscriber(), {
    uid,
    name: uid,
    status: 1,
    isDeleted: false,
    orgData: {},
  }, fields);
}

export function summarySubscribers(): Subscriber[] {
  return [
    summarySubscriber("human", { name: "Nickname", remark: "Remark", role: 2 }),
    summarySubscriber("verified", {
      name: "Nickname",
      remark: "Remark",
      orgData: { realname_verified: true, real_name: "Verified name" },
    }),
    summarySubscriber("app-bot", { orgData: { robot: 1 } }),
    summarySubscriber("inactive", { status: 0 }),
    summarySubscriber("deleted", { isDeleted: true }),
  ];
}
