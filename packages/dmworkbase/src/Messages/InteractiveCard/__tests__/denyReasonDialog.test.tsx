// denyReasonDialog：拒绝动作识别 + 弹窗 resolve 语义。mock wkConfirm/Semi 避免拉起 UI。
import { describe, expect, it, vi, beforeEach } from "vitest";

const { wkConfirmMock, toastWarnMock } = vi.hoisted(() => ({
  wkConfirmMock: vi.fn(),
  toastWarnMock: vi.fn(),
}));

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../../Components/WKModal/confirm", () => ({
  wkConfirm: wkConfirmMock,
}));

vi.mock("@douyinfe/semi-ui", () => ({
  TextArea: () => null,
  Toast: { warning: toastWarnMock },
}));

import {
  isDocsDenyAction,
  openDocsDenyReasonDialog,
  DOCS_DENY_REASON_INPUT_ID,
} from "../denyReasonDialog";

describe("isDocsDenyAction", () => {
  const deny = {
    owner: "docs",
    action_type: "access_request.decision",
    decision: "deny",
  };

  it("matches only the docs access-request deny action", () => {
    expect(isDocsDenyAction(deny)).toBe(true);
  });

  it("rejects approve, other owners/types, and undefined", () => {
    expect(isDocsDenyAction({ ...deny, decision: "approve" })).toBe(false);
    expect(isDocsDenyAction({ ...deny, owner: "tasks" })).toBe(false);
    expect(isDocsDenyAction({ ...deny, action_type: "other" })).toBe(false);
    expect(isDocsDenyAction(undefined)).toBe(false);
    expect(isDocsDenyAction({})).toBe(false);
  });
});

describe("DOCS_DENY_REASON_INPUT_ID", () => {
  it("matches the server-declared hidden input id", () => {
    expect(DOCS_DENY_REASON_INPUT_ID).toBe("deny_reason");
  });
});

describe("openDocsDenyReasonDialog", () => {
  beforeEach(() => {
    wkConfirmMock.mockReset();
    toastWarnMock.mockReset();
  });

  const lastConfig = () => wkConfirmMock.mock.calls[0][0] as any;

  it("opens a danger confirm and resolves the trimmed reason on confirm", async () => {
    const p = openDocsDenyReasonDialog({ docTitle: "Roadmap", actorName: "李四" });
    const config = lastConfig();
    expect(config.okType).toBe("danger");
    // Simulate the reviewer typing into the body's textarea.
    config.content.props.onChange("  范围不符  ");
    const ok = config.onOk();
    expect(ok).toBeUndefined(); // valid => closes (no rejected promise)
    await expect(p).resolves.toBe("范围不符");
    expect(toastWarnMock).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and warns when the reason is empty", async () => {
    openDocsDenyReasonDialog({});
    const config = lastConfig();
    const ok = config.onOk();
    expect(typeof ok?.then).toBe("function"); // rejected promise keeps it open
    await expect(ok).rejects.toBeInstanceOf(Error);
    expect(toastWarnMock).toHaveBeenCalledTimes(1);
  });

  it("resolves null on cancel", async () => {
    const p = openDocsDenyReasonDialog({});
    lastConfig().onCancel();
    await expect(p).resolves.toBeNull();
  });
});
