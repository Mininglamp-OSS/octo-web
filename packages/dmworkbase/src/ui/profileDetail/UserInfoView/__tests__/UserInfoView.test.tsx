// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import UserInfoView, { type UserInfoViewProps } from "../index";

vi.hoisted(() => {
  const context = new Proxy({}, { get: () => () => undefined });
  HTMLCanvasElement.prototype.getContext = () => context as never;
});

vi.mock("react-virtuoso", () => ({
  TableVirtuoso: () => null,
  Virtuoso: () => null,
  VirtuosoGrid: () => null,
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Spin: () => <span data-testid="spin" />,
}));

vi.mock("@douyinfe/semi-icons", () => ({
  IconEdit: () => <span />,
}));

vi.mock("../../../../Components/Sections", () => ({
  default: () => null,
}));

vi.mock("../../../../Components/WKButton", () => ({
  default: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("../../../../Components/AiBadge", () => ({
  default: () => null,
}));

vi.mock("../../../../Components/RealnameVerifiedBadge", () => ({
  default: () => null,
}));

vi.mock("../../ProfileDetailShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ProfileDetailFooter: () => null,
  ProfileDetailHeader: ({
    avatar,
    title,
    metaItems,
  }: {
    avatar: React.ReactNode;
    title: React.ReactNode;
    metaItems: Array<{ label: React.ReactNode; value: React.ReactNode }>;
  }) => (
    <div>
      {avatar}
      {title}
      {metaItems.map((item, index) => (
        <div key={index} className="wk-profile-detail-meta-item">
          {item.label}{item.value}
        </div>
      ))}
    </div>
  ),
}));

function makeProps(
  overrides: Partial<UserInfoViewProps> = {}
): UserInfoViewProps {
  return {
    loading: false,
    avatar: <span>头像</span>,
    displayName: "李阳",
    isBot: false,
    isRealnameVerified: false,
    metaItems: [{ label: "Octo号", value: "WSosyqwNM" }],
    showRemarkEditor: true,
    editingRemark: false,
    remark: "",
    remarkDraft: "",
    savingRemark: false,
    sections: [],
    labels: {
      remark: "备注",
      remarkPlaceholder: "请输入备注",
      editRemark: "编辑备注",
      cancel: "取消",
      save: "保存",
      notSet: "未设置",
    },
    onRemarkDraftChange: vi.fn(),
    onStartEditRemark: vi.fn(),
    onCancelEditRemark: vi.fn(),
    onSaveRemark: vi.fn(),
    ...overrides,
  };
}

describe("UserInfoView contact layout", () => {
  let container: HTMLDivElement;

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  function renderView(props: UserInfoViewProps) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      ReactDOM.render(<UserInfoView {...props} />, container);
    });
  }

  it("renders contact fields below the remark card instead of the profile header", () => {
    renderView(
      makeProps({
        contactItems: [
          { label: "手机号", value: <button type="button">点击查看</button> },
          { label: "邮箱", value: <button type="button">liyang@mininglamp.com</button> },
        ],
      })
    );

    expect(container.textContent).toContain("点击查看");
    expect(container.textContent).toContain("liyang@mininglamp.com");
    expect(container.querySelectorAll(".wk-profile-detail-meta-item")).toHaveLength(1);
    expect(container.querySelectorAll(".wk-userinfo-contact-row")).toHaveLength(2);
    expect(
      container.querySelector(".wk-userinfo-remark-section")?.textContent
    ).toContain("手机号");
  });

  it("renders contacts when the current user has no remark editor", () => {
    renderView(
      makeProps({
        showRemarkEditor: false,
        contactItems: [{ label: "手机号", value: "13800138000" }],
      })
    );

    expect(container.textContent).toContain("13800138000");
    expect(container.querySelectorAll(".wk-userinfo-contact-row")).toHaveLength(1);
    expect(container.querySelector(".wk-userinfo-remark-row")).toBeNull();
  });
});
