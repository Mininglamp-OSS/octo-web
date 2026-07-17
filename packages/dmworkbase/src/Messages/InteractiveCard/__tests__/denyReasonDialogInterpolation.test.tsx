// 真插值回归测试：用**真实** t（不 mock i18n）渲染弹窗内容，锁死「t() 变量必须放进
// values」——早前 bug 是把变量放在 options 顶层，导致弹窗显示字面 {{actor}}/{{max}}。
// 只 mock wkConfirm（捕获 content 元素）与 Semi（TextArea/Toast 桩），i18n 走真实实现。
// 用 React 17 的 ReactDOM.render + act（本仓 @testing-library/react 是 React18 版，不兼容）。
import { describe, expect, it, vi } from "vitest";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";

const { wkConfirmMock } = vi.hoisted(() => ({ wkConfirmMock: vi.fn() }));

vi.mock("../../../Components/WKModal/confirm", () => ({ wkConfirm: wkConfirmMock }));
vi.mock("@douyinfe/semi-ui", () => ({
  TextArea: () => null,
  Toast: { warning: vi.fn() },
}));
// 刻意不 mock ../../../i18n —— 用真实 t / interpolate。

import { openDocsDenyReasonDialog } from "../denyReasonDialog";

describe("denyReasonDialog interpolation (real t)", () => {
  it("substitutes interpolation vars instead of rendering literal {{...}}", () => {
    openDocsDenyReasonDialog({
      actorName: "李四",
      docTitle: "Roadmap",
      requestNo: "DOC-REQ-025",
    });
    const config = wkConfirmMock.mock.calls[0][0];
    const container = document.createElement("div");
    act(() => {
      ReactDOM.render(config.content, container);
    });
    const text = container.textContent ?? "";
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });

    // The bug: vars passed at the top level → t() ignores them → literal {{...}} shown.
    expect(text).not.toContain("{{");
    // Interpolated values (locale-independent) must appear substituted.
    expect(text).toContain("李四");
    expect(text).toContain("Roadmap");
    expect(text).toContain("DOC-REQ-025");
    expect(text).toContain("200"); // counter max
  });
});
