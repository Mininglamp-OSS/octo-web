import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import "@testing-library/jest-dom";
import ClawInfoModal from "../ClawInfoModal";
import type { AgentCardData } from "../../../Service/AgentCardService";
import { i18n } from "../../../i18n";

// Mock AgentCardService
vi.mock("../../../Service/AgentCardService", () => ({
  default: {
    getAgentCard: vi.fn(),
  },
}));

import AgentCardService from "../../../Service/AgentCardService";

// Mock WKModal
vi.mock("../../WKModal", () => ({
  default: ({ children, visible }: any) => (visible ? <div>{children}</div> : null),
}));

// Mock ClawSessionItem
vi.mock("../../ClawSessionItem", () => ({
  default: ({ session }: any) => (
    <div data-testid="claw-session-card">{session.key}</div>
  ),
}));

// ClawInfoModal renders the real ClawOverviewTab, which dereferences runtime
// numeric fields (e.g. `disk_space_gb.toFixed(1)`). A `{}` runtime_info crashes
// the render, so provide a complete RuntimeInfo fixture (mirrors
// ClawOverviewTab.test's mockRuntimeInfo).
const MOCK_RUNTIME_INFO = {
  os_version: "macOS 13.2.1",
  arch: "arm64",
  disk_space_gb: 68.0,
  memory_gb: 32.0,
  app_data_dir: ".octopush/octopush-58d651",
  claw_version: "v2026.4.11",
  admin_url: "http://localhost:3100",
  team_name: "DeepMiner Team",
  process_status: "running",
  gateway_status: "connected",
  gateway_name: "Gateway-1",
  claw_id: "claw-a8f3d2e1",
  gateway_total_agents: 10,
  gateway_alive_agents: 8,
  nodejs_version: "v22.22.2",
  network_latency_ms: 45.2,
  last_heartbeat_at: "2026-05-07T10:31:00Z",
  memory_retention_count: 50,
  memory_retention_note: "保留最近50天记忆，已清理3条过期记录",
} as any;

describe("ClawInfoModal", () => {
  beforeEach(() => {
    // 这些断言依赖中文文案（如「共 N 个」）。jsdom navigator 默认 en-US，
    // detectLocale() 会落到 en-US 让组件渲染英文。显式 pin i18n 单例到 zh-CN，
    // 等价于用户在设置里选了中文。对齐 PersonaEdit.test.tsx 的修法。
    i18n.setLocale("zh-CN", { persist: false });
    vi.clearAllMocks();
  });

  /**
   * AC-1: 有 Session 数据时，正确渲染列表和统计
   */
  it("应该渲染 Session 列表和顶部统计", async () => {
    const mockData: AgentCardData = {
      bot_id: "test_bot",
      session_total: 3,
      session_running_count: 2,
      last_report_at: "2026-05-07T10:30:00Z",
      runtime_info: MOCK_RUNTIME_INFO,
      sessions: [
        {
          session_id: "s1",
          session_key: "dmwork:group:abc123",
          channel: "dmwork",
          status: "running" as any,
          peer_name: "Alice",
          peer_type: "private" as any,
          group_member_count: null,
          model: "claude-sonnet-4-6",
          context_used: 10000,
          context_total: 200000,
          context_percent: 5.0,
          last_user_message: "Hello",
          last_active_at: "2026-05-07T10:30:00Z",
        },
        {
          session_id: "s2",
          session_key: "discord:channel:xyz456",
          channel: "discord",
          status: "idle" as any,
          peer_name: "Bob",
          peer_type: "private" as any,
          group_member_count: null,
          model: "claude-opus-4-5",
          context_used: 5000,
          context_total: 200000,
          context_percent: 2.5,
          last_user_message: "World",
          last_active_at: "2026-05-07T10:20:00Z",
        },
        {
          session_id: "s3",
          session_key: "localhost:terminal:term1",
          channel: "localhost",
          status: "running" as any,
          peer_name: "CLI",
          peer_type: "private" as any,
          group_member_count: null,
          model: "claude-opus-4-5",
          context_used: 3000,
          context_total: 200000,
          context_percent: 1.5,
          last_user_message: "Test",
          last_active_at: "2026-05-07T10:10:00Z",
        },
      ],
      core_files: [],
      memory_files: [],
    };

    vi.mocked(AgentCardService.getAgentCard).mockResolvedValueOnce(mockData);

    render(<ClawInfoModal botId="test_bot" visible={true} onClose={() => {}} />);

    // 弹窗默认停在 overview tab，Session 列表 / 统计在 session tab，需先切过去
    fireEvent.click(screen.getByTestId("tab-session"));

    // 等待数据加载
    await waitFor(() => {
      expect(screen.getByText(/2 running/)).toBeInTheDocument();
    });

    // 检查顶部统计
    expect(screen.getByText(/2 running/)).toBeInTheDocument();
    expect(screen.getByText(/共 3 个/)).toBeInTheDocument();

    // 检查 Session 卡片数量
    const sessionCards = screen.getAllByTestId("claw-session-card");
    expect(sessionCards).toHaveLength(3);
  });

  /**
   * AC-2: 空态处理
   */
  it("应该在无 Session 时显示空态", async () => {
    const mockData: AgentCardData = {
      bot_id: "empty_bot",
      session_total: 0,
      session_running_count: 0,
      last_report_at: "2026-05-07T10:30:00Z",
      runtime_info: MOCK_RUNTIME_INFO,
      sessions: [],
      core_files: [],
      memory_files: [],
    };

    vi.mocked(AgentCardService.getAgentCard).mockResolvedValueOnce(mockData);

    render(<ClawInfoModal botId="empty_bot" visible={true} onClose={() => {}} />);

    // 切到 session tab 才会渲染会话统计 / 空态
    fireEvent.click(screen.getByTestId("tab-session"));

    await waitFor(() => {
      expect(screen.getByText(/0 running/)).toBeInTheDocument();
    });

    // 检查空态文案（对齐 i18n key base.claw.noActiveSessions 的现行文案）
    expect(
      screen.getByText(/暂无活跃的会话，有新对话产生后会出现在这里/)
    ).toBeInTheDocument();
  });

  /**
   * AC-3: 加载中状态
   */
  it("应该在加载时显示 Spin", () => {
    vi.mocked(AgentCardService.getAgentCard).mockImplementation(
      () => new Promise(() => {}) // 永远不 resolve，保持 loading 状态
    );

    render(<ClawInfoModal botId="loading_bot" visible={true} onClose={() => {}} />);

    // Semi UI Spin 渲染为 .semi-spin
    expect(document.querySelector(".semi-spin")).toBeInTheDocument();
  });

  /**
   * AC-4: 加载失败处理
   */
  it("应该在加载失败时显示错误提示", async () => {
    vi.mocked(AgentCardService.getAgentCard).mockRejectedValueOnce(new Error("网络错误"));

    render(<ClawInfoModal botId="error_bot" visible={true} onClose={() => {}} />);

    // 错误提示在 session tab 通过 <Empty description={error}> 渲染
    fireEvent.click(screen.getByTestId("tab-session"));

    await waitFor(() => {
      expect(screen.getByText(/网络错误/)).toBeInTheDocument();
    });
  });

  /**
   * AC-5: running Session 排在前面
   */
  it("应该将 running Session 排在前面", async () => {
    const mockData: AgentCardData = {
      bot_id: "sort_bot",
      session_total: 3,
      session_running_count: 2,
      last_report_at: "2026-05-07T10:30:00Z",
      runtime_info: MOCK_RUNTIME_INFO,
      sessions: [
        {
          session_id: "idle_1",
          session_key: "idle:session:1",
          channel: "dmwork",
          status: "idle" as any,
          peer_name: "Idle User",
          peer_type: "private" as any,
          group_member_count: null,
          model: "claude-sonnet-4-6",
          context_used: 1000,
          context_total: 200000,
          context_percent: 0.5,
          last_user_message: "Idle message",
          last_active_at: "2026-05-07T10:00:00Z",
        },
        {
          session_id: "running_1",
          session_key: "running:session:1",
          channel: "dmwork",
          status: "running" as any,
          peer_name: "Running User 1",
          peer_type: "private" as any,
          group_member_count: null,
          model: "claude-opus-4-5",
          context_used: 2000,
          context_total: 200000,
          context_percent: 1.0,
          last_user_message: "Running message 1",
          last_active_at: "2026-05-07T10:20:00Z",
        },
        {
          session_id: "running_2",
          session_key: "running:session:2",
          channel: "discord",
          status: "running" as any,
          peer_name: "Running User 2",
          peer_type: "private" as any,
          group_member_count: null,
          model: "claude-opus-4-5",
          context_used: 3000,
          context_total: 200000,
          context_percent: 1.5,
          last_user_message: "Running message 2",
          last_active_at: "2026-05-07T10:30:00Z",
        },
      ],
      core_files: [],
      memory_files: [],
    };

    vi.mocked(AgentCardService.getAgentCard).mockResolvedValueOnce(mockData);

    render(<ClawInfoModal botId="sort_bot" visible={true} onClose={() => {}} />);

    // 会话列表在 session tab 渲染
    fireEvent.click(screen.getByTestId("tab-session"));

    await waitFor(() => {
      const sessionCards = screen.getAllByTestId("claw-session-card");
      expect(sessionCards).toHaveLength(3);
    });

    // 检查排序（running 在前）
    const sessionCards = screen.getAllByTestId("claw-session-card");
    expect(sessionCards[0]).toHaveTextContent("running:session:1");
    expect(sessionCards[1]).toHaveTextContent("running:session:2");
    expect(sessionCards[2]).toHaveTextContent("idle:session:1");
  });
});
