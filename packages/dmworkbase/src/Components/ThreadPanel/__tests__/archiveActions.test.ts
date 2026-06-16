import { describe, it, expect } from "vitest";
import {
  deriveArchiveAction,
  shouldShowArchiveButton,
} from "../archiveActions";
import { Thread, ThreadStatus } from "../../../Service/Thread";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    short_id: "t1",
    group_no: "g1",
    channel_id: "g1____t1",
    channel_type: 5,
    name: "Thread 1",
    creator_uid: "u1",
    status: ThreadStatus.Active,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("deriveArchiveAction", () => {
  it("活跃子区推导为归档动作", () => {
    expect(deriveArchiveAction(makeThread({ status: ThreadStatus.Active }))).toBe(
      "archive"
    );
  });

  it("已归档子区推导为取消归档动作", () => {
    expect(
      deriveArchiveAction(makeThread({ status: ThreadStatus.Archived }))
    ).toBe("unarchive");
  });

  it("已删除子区无可执行动作", () => {
    expect(
      deriveArchiveAction(makeThread({ status: ThreadStatus.Deleted }))
    ).toBeNull();
  });
});

describe("shouldShowArchiveButton", () => {
  it("有权限且状态可操作时显示", () => {
    expect(
      shouldShowArchiveButton(makeThread({ status: ThreadStatus.Active }), true)
    ).toBe(true);
    expect(
      shouldShowArchiveButton(
        makeThread({ status: ThreadStatus.Archived }),
        true
      )
    ).toBe(true);
  });

  it("无权限时不显示", () => {
    expect(
      shouldShowArchiveButton(makeThread({ status: ThreadStatus.Active }), false)
    ).toBe(false);
  });

  it("有权限但状态不可操作（已删除）时不显示", () => {
    expect(
      shouldShowArchiveButton(makeThread({ status: ThreadStatus.Deleted }), true)
    ).toBe(false);
  });
});
