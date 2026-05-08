import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionItem from "../index";

describe("SessionItem", () => {
  const mockSession = {
    key: "octo:c_pipi_lux_01",
    status: "active" as const,
    running: false,
    channel: "Octo",
    party: "罗敬为 · 皮皮虾(私聊)",
    model: "mlamp/claude-opus-4-7",
    ctxUsed: 48200,
    ctxMax: 1000000,
    sessionId: "sess_octo_7f3a2b18e",
    lastMsg: "帮我用糗米写一份 OctoPush 的 V0.0.3 发布公告",
  };

  describe("AC-5: 展示对话方、模型、上下文、最近消息", () => {
    it("应该正确展示所有关键信息", () => {
      render(<SessionItem session={mockSession} />);

      // 验证对话方
      expect(screen.getByTestId("session-party")).toHaveTextContent(
        "罗敬为 · 皮皮虾(私聊)"
      );

      // 验证模型
      expect(screen.getByTestId("session-model")).toHaveTextContent(
        "mlamp/claude-opus-4-7"
      );

      // 验证 SESSION ID
      expect(screen.getByTestId("session-id")).toHaveTextContent(
        "sess_octo_7f3a2b18e"
      );

      // 验证最近消息
      expect(screen.getByTestId("session-msg")).toHaveTextContent(
        "帮我用糗米写一份 OctoPush 的 V0.0.3 发布公告"
      );

      // 验证上下文进度条文本
      expect(screen.getByTestId("context-bar-text")).toHaveTextContent(
        "48.2K / 1000K (5%)"
      );
    });

    it("应该显示正确的渠道标签", () => {
      render(<SessionItem session={mockSession} />);

      const channelChip = screen.getByTestId("channel-chip");
      expect(channelChip).toHaveTextContent("Octo");
      expect(channelChip).toHaveClass("wk-channel-octo");
    });

    it("应该显示正确的 session key", () => {
      render(<SessionItem session={mockSession} />);

      expect(screen.getByTestId("session-key")).toHaveTextContent(
        "octo:c_pipi_lux_01"
      );
    });
  });

  describe("AC-6: RUNNING 状态强视觉标记", () => {
    it("running=true 时应该显示 RUNNING 徽章", () => {
      const runningSession = { ...mockSession, running: true };
      render(<SessionItem session={runningSession} />);

      expect(screen.getByTestId("running-badge")).toBeInTheDocument();
      expect(screen.getByTestId("running-badge")).toHaveTextContent("RUNNING");
    });

    it("running=false 时不应该显示 RUNNING 徽章", () => {
      render(<SessionItem session={mockSession} />);

      expect(screen.queryByTestId("running-badge")).not.toBeInTheDocument();
    });

    it("running=true 时卡片应该有 is-running 类", () => {
      const runningSession = { ...mockSession, running: true };
      render(<SessionItem session={runningSession} />);

      const card = screen.getByTestId("session-card");
      expect(card).toHaveClass("is-running");
    });

    it("running=false 时卡片不应该有 is-running 类", () => {
      render(<SessionItem session={mockSession} />);

      const card = screen.getByTestId("session-card");
      expect(card).not.toHaveClass("is-running");
    });
  });

  describe("AC-7: 点击表头展开/收起", () => {
    it("初始状态应该是展开的", () => {
      render(<SessionItem session={mockSession} />);

      const card = screen.getByTestId("session-card");
      expect(card).not.toHaveClass("collapsed");

      // 主体内容应该可见
      expect(screen.getByTestId("session-body")).toBeInTheDocument();
      expect(screen.getByTestId("session-msg")).toBeInTheDocument();
    });

    it("点击头部应该切换折叠状态", () => {
      render(<SessionItem session={mockSession} />);

      const head = screen.getByTestId("session-head");
      const card = screen.getByTestId("session-card");

      // 第一次点击：折叠
      fireEvent.click(head);
      expect(card).toHaveClass("collapsed");
      expect(screen.queryByTestId("session-body")).not.toBeInTheDocument();
      expect(screen.queryByTestId("session-msg")).not.toBeInTheDocument();

      // 第二次点击：展开
      fireEvent.click(head);
      expect(card).not.toHaveClass("collapsed");
      expect(screen.getByTestId("session-body")).toBeInTheDocument();
      expect(screen.getByTestId("session-msg")).toBeInTheDocument();
    });

    it("展开/收起时箭头图标应该旋转（通过 CSS 类验证）", () => {
      render(<SessionItem session={mockSession} />);

      const head = screen.getByTestId("session-head");
      const card = screen.getByTestId("session-card");

      // 折叠时 card 有 collapsed 类（CSS 会旋转箭头）
      fireEvent.click(head);
      expect(card).toHaveClass("collapsed");

      // 展开时 card 没有 collapsed 类
      fireEvent.click(head);
      expect(card).not.toHaveClass("collapsed");
    });
  });

  describe("AC-8: 上下文进度条 > 70% 显示警告色", () => {
    it("上下文占用 <= 70% 时，进度条应该是正常色", () => {
      // 50% 占用
      const normalSession = { ...mockSession, ctxUsed: 500000, ctxMax: 1000000 };
      render(<SessionItem session={normalSession} />);

      const fill = screen.getByTestId("context-bar-fill");
      expect(fill).not.toHaveClass("warn");
      expect(fill).toHaveStyle({ width: "50%" });
    });

    it("上下文占用 > 70% 时，进度条应该显示警告色", () => {
      // 85% 占用
      const highCtxSession = { ...mockSession, ctxUsed: 850000, ctxMax: 1000000 };
      render(<SessionItem session={highCtxSession} />);

      const fill = screen.getByTestId("context-bar-fill");
      expect(fill).toHaveClass("warn");
      expect(fill).toHaveStyle({ width: "85%" });
    });

    it("上下文占用正好 70% 时，进度条不应该显示警告色", () => {
      const session70 = { ...mockSession, ctxUsed: 700000, ctxMax: 1000000 };
      render(<SessionItem session={session70} />);

      const fill = screen.getByTestId("context-bar-fill");
      expect(fill).not.toHaveClass("warn");
    });

    it("上下文占用 71% 时，进度条应该显示警告色", () => {
      const session71 = { ...mockSession, ctxUsed: 710000, ctxMax: 1000000 };
      render(<SessionItem session={session71} />);

      const fill = screen.getByTestId("context-bar-fill");
      expect(fill).toHaveClass("warn");
    });

    it("进度条文本应该正确显示百分比", () => {
      const session = { ...mockSession, ctxUsed: 148200, ctxMax: 1000000 };
      render(<SessionItem session={session} />);

      // 148200 / 1000000 = 14.82% -> 15% (rounded)
      expect(screen.getByTestId("context-bar-text")).toHaveTextContent(
        "148.2K / 1000K (15%)"
      );
    });
  });

  describe("不同渠道的样式", () => {
    it("Discord 渠道应该有正确的样式类", () => {
      const discordSession = { ...mockSession, channel: "Discord" };
      render(<SessionItem session={discordSession} />);

      const chip = screen.getByTestId("channel-chip");
      expect(chip).toHaveClass("wk-channel-discord");
    });

    it("飞书渠道应该有正确的样式类", () => {
      const feishuSession = { ...mockSession, channel: "飞书" };
      render(<SessionItem session={feishuSession} />);

      const chip = screen.getByTestId("channel-chip");
      expect(chip).toHaveClass("wk-channel-飞书");
    });

    it("Localhost 渠道应该有正确的样式类", () => {
      const localhostSession = { ...mockSession, channel: "Localhost" };
      render(<SessionItem session={localhostSession} />);

      const chip = screen.getByTestId("channel-chip");
      expect(chip).toHaveClass("wk-channel-localhost");
    });
  });

  describe("边界情况", () => {
    it("上下文占用为 0 时应该正确显示", () => {
      const zeroSession = { ...mockSession, ctxUsed: 0 };
      render(<SessionItem session={zeroSession} />);

      expect(screen.getByTestId("context-bar-fill")).toHaveStyle({ width: "0%" });
      expect(screen.getByTestId("context-bar-text")).toHaveTextContent(
        "0.0K / 1000K (0%)"
      );
    });

    it("上下文占用为 100% 时应该正确显示", () => {
      const fullSession = { ...mockSession, ctxUsed: 1000000, ctxMax: 1000000 };
      render(<SessionItem session={fullSession} />);

      expect(screen.getByTestId("context-bar-fill")).toHaveStyle({ width: "100%" });
      expect(screen.getByTestId("context-bar-fill")).toHaveClass("warn");
    });

    it("长文本消息应该正常显示", () => {
      const longMsgSession = {
        ...mockSession,
        lastMsg:
          "这是一条非常非常长的消息，用来测试组件在处理超长文本时是否能正常显示，不会溢出或破坏布局。这条消息包含了很多内容，可能会换行显示。",
      };
      render(<SessionItem session={longMsgSession} />);

      expect(screen.getByTestId("session-msg")).toHaveTextContent(
        longMsgSession.lastMsg
      );
    });
  });
});
