import { Channel, Subscriber } from "wukongimjssdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberSelectionEvidence } from "../../../bridge/channelSetting/memberRemovalRead";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(), confirm: vi.fn(),
  success: vi.fn(), warning: vi.fn(),
}));
vi.mock("../../../Components/Subscribers", () => ({ Subscribers: () => null }));
vi.mock("../../../Components/Subscribers/memberRemovalList", () => ({ MemberRemovalList: () => null }));
vi.mock("../../../Components/WKModal/confirm", () => ({ wkConfirm: mocks.confirm }));
vi.mock("../../../Components/Subscribers/subscriberShowName", () => ({
  resolveSubscriberShowName: (row: Subscriber) => row.name,
}));
vi.mock("../../../bridge/channelSetting/channelSettingActions", () => ({
  removeAndReconcileChannelSettingSubscribers: mocks.submit,
}));
vi.mock("../../../App", () => ({ default: { loginInfo: { uid: "owner" } } }));
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { success: mocks.success, warning: mocks.warning },
}));
import { buildChannelMembersSection } from "../channelSettingMemberSection";

function member(uid: string) {
  const row = new Subscriber();
  row.uid = uid;
  row.name = uid;
  return row;
}
function setup() {
  const channel = new Channel("g", 2);
  const data = {
    channel, channelInfo: { orgData: {} }, subscriberOfMe: { uid: "owner", role: 1 },
    refresh: vi.fn(),
  };
  const context = { routeData: () => data, push: vi.fn(), pop: vi.fn() };
  const section = buildChannelMembersSection(context as never)!;
  section.rows![0].properties.onRemove();
  const [element, config] = context.push.mock.calls[0];
  const page = {
    applySelectionEvidence: vi.fn(),
    refreshMembers: vi.fn(),
    setSubmissionPending: vi.fn(),
  };
  element.ref.current = page;
  const finish = { disable: vi.fn(), loading: vi.fn() };
  config.onFinishContext(finish);
  element.props.onSelectionChange([member("alice"), member("bob")]);
  return { context, data, channel, config, page, finish, element };
}
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe("real onFinish/onOk batch orchestration", () => {
  it("submits once, reconciles, then pops and refreshes after all targets are absent", async () => {
    const state = setup();
    mocks.submit.mockResolvedValueOnce({ absent: ["alice", "bob"], present: [], unknown: [] });
    state.config.onFinish();
    state.config.onFinish();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    const confirmation = mocks.confirm.mock.calls[0][0];
    const pending = confirmation.onOk();
    await confirmation.onOk();
    await pending;
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledWith({ channel: state.channel, uids: ["alice", "bob"] });
    expect(state.page.applySelectionEvidence).toHaveBeenCalled();
    expect(state.context.pop).toHaveBeenCalledOnce();
    expect(state.data.refresh).toHaveBeenCalledOnce();
    expect(state.context.pop.mock.invocationCallOrder[0]).toBeLessThan(state.data.refresh.mock.invocationCallOrder[0]);
    expect(state.finish.loading).toHaveBeenLastCalledWith(false);
    expect(mocks.success).toHaveBeenCalledOnce();
  });

  it("keeps the page on uncertain/partial results, reconciles selections and requires a new confirmation", async () => {
    const state = setup();
    const evidence: MemberSelectionEvidence = { absent: ["alice"], present: [member("bob")], unknown: [] };
    mocks.submit.mockResolvedValueOnce(evidence);
    state.config.onFinish();
    await mocks.confirm.mock.calls[0][0].onOk();
    expect(state.page.applySelectionEvidence).toHaveBeenCalledWith(evidence);
    expect(state.context.pop).not.toHaveBeenCalled();
    expect(state.page.refreshMembers).toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledOnce();
    state.config.onFinish();
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
  });

  it("releases the pending state after an unexpected failure without automatically retrying", async () => {
    const state = setup();
    mocks.submit.mockRejectedValueOnce(new Error("unavailable"));
    state.config.onFinish();
    await mocks.confirm.mock.calls[0][0].onOk();
    expect(state.finish.loading).toHaveBeenLastCalledWith(false);
    expect(state.page.setSubmissionPending).toHaveBeenLastCalledWith(false);
    expect(state.context.pop).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("does not submit an old confirmation after the removal page unmounts", async () => {
    const state = setup();
    state.config.onFinish();
    state.element.ref.current = null;
    await mocks.confirm.mock.calls[0][0].onOk();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(state.finish.loading).not.toHaveBeenCalled();
  });
});
