import type { Meta, StoryObj } from "@storybook/react";
import ClawSessionItem from "./ClawSessionItem";

/**
 * ClawSessionItem - Session 展示卡片
 *
 * 用于展示会话信息，包含对话方、模型、上下文使用情况等。
 * 支持折叠/展开，支持 5 种状态：running（绿）/ done（灰）/ failed|killed|timeout（红）。
 */
const meta: Meta<typeof ClawSessionItem> = {
  title: "Components/ClawSessionItem",
  component: ClawSessionItem,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Session 展示卡片，支持折叠/展开和 RUNNING 状态强视觉标记。",
      },
    },
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ClawSessionItem>;

/**
 * 默认状态（DONE - 两个字段都有）
 */
export const Default: Story = {
  args: {
    session: {
      key: "octo:c_pipi_lux_01",
      status: "done",
      channel: "Octo",
      peerDisplayName: "Octo 产品管家",
      peerName: "7edea73a3c334a5382c0e0b6f27adbe0",
      botName: "皮皮虾",
      botId: "pipixia_bot",
      model: "mlamp/claude-opus-4-7",
      ctxUsed: 48200,
      ctxMax: 1000000,
      sessionId: "sess_octo_7f3a2b18e",
      lastMsg: "帮我用糗米写一份 OctoPush 的 V0.0.3 发布公告",
    },
  },
};

/**
 * RUNNING 状态（AC-6：绿色左边框 + 渐变背景 + 动画徽章）
 */
export const Running: Story = {
  args: {
    session: {
      key: "localhost:cli_term_01",
      status: "running",
      channel: "Localhost",
      peerDisplayName: "openclaw chat",
      partyId: "pid:2a7e8b1c",
      botName: "皮皮虾",
      botId: "pipixia_bot",
      model: "mlamp/claude-opus-4-7",
      ctxUsed: 128400,
      ctxMax: 1000000,
      sessionId: "sess_local_cli_2a7",
      lastMsg: "帮我检查下本地 git 仓库的未提交文件，按目录分类列出来",
    },
  },
};

/**
 * 高上下文占用（AC-8：> 70% 显示警告色）
 */
export const HighContext: Story = {
  args: {
    session: {
      key: "discord:1470015610489536542",
      status: "running",
      channel: "Discord",
      peerDisplayName: "#square · LUO",
      partyId: "user:1098193326743756812",
      botName: "皮皮虾",
      botId: "pipixia_bot",
      model: "mlamp/claude-opus-4-7",
      ctxUsed: 850000,
      ctxMax: 1000000,
      sessionId: "sess_disc_d7f3a2b18e",
      lastMsg: "关于OctoPush的原型，有几个小问题需要修改一下…",
    },
  },
};

/**
 * FAILED 状态（红色边框 + 红色徽章）
 */
export const Failed: Story = {
  args: {
    session: {
      key: "octo:c_task_01",
      status: "failed",
      channel: "Octo",
      peerDisplayName: "团长", peerName: "user:379800680b7a48fa8955e8d17f73c39c",
      botName: "皮皮虾",
      botId: "pipixia_bot",
      model: "mlamp/claude-opus-4-7",
      ctxUsed: 12000,
      ctxMax: 200000,
      sessionId: "sess_octo_task_f1a7",
      lastMsg: "执行数据导入任务",
    },
  },
};

/**
 * KILLED 状态（红色边框 + 红色徽章）
 */
export const Killed: Story = {
  args: {
    session: {
      key: "localhost:bg_job_02",
      status: "killed",
      channel: "Localhost",
      peerDisplayName: "团长", peerName: "user:379800680b7a48fa8955e8d17f73c39c",
      botName: "皮皮虾",
      botId: "pipixia_bot",
      model: "mlamp/claude-sonnet-4",
      ctxUsed: 8500,
      ctxMax: 200000,
      sessionId: "sess_local_job_k2b9",
      lastMsg: "处理大文件批量转换",
    },
  },
};

/**
 * TIMEOUT 状态（红色边框 + 红色徽章）
 */
export const Timeout: Story = {
  args: {
    session: {
      key: "discord:1470015610489536999",
      status: "timeout",
      channel: "Discord",
      peerDisplayName: "团长", peerName: "user:379800680b7a48fa8955e8d17f73c39c",
      botName: "皮皮虾",
      botId: "pipixia_bot",
      model: "mlamp/claude-opus-4-7",
      ctxUsed: 45000,
      ctxMax: 200000,
      sessionId: "sess_disc_sync_t3c8",
      lastMsg: "同步远程数据库",
    },
  },
};

/**
 * 飞书渠道（只有 peerDisplayName）
 */
export const Feishu: Story = {
  args: {
    session: {
      key: "feishu:oc_x4a91",
      status: "done",
      channel: "飞书",
      peerDisplayName: "明略 AI 小组",
      botName: "皮皮虾",
      botId: "pipixia_bot",
      model: "mlamp/claude-opus-4-7",
      ctxUsed: 8200,
      ctxMax: 200000,
      sessionId: "sess_fs_f3c9a7118b",
      lastMsg: "明天的周报帮我整理下，记得把 DMWork 进展写进去",
    },
  },
};

/**
 * 只有 peerName（无 peerDisplayName）
 */
export const OnlyPeerName: Story = {
  args: {
    session: {
      key: "localhost:unknown_user",
      status: "done",
      channel: "Localhost",
      peerName: "unknown_user_7a3c9e1b",
      botName: "皮皮虾",
      botId: "pipixia_bot",
      model: "mlamp/claude-sonnet-4",
      ctxUsed: 5200,
      ctxMax: 200000,
      sessionId: "sess_local_unknown_u7a3",
      lastMsg: "测试消息",
    },
  },
};

/**
 * Slack 渠道
 */
export const Slack: Story = {
  args: {
    session: {
      key: "slack:C0912",
      status: "done",
      channel: "Slack",
      peerDisplayName: "团长", peerName: "user:379800680b7a48fa8955e8d17f73c39c",
      botName: "皮皮虾",
      botId: "pipixia_bot",
      model: "mlamp/claude-sonnet-4",
      ctxUsed: 12000,
      ctxMax: 200000,
      sessionId: "sess_sl_2b89a14e7",
      lastMsg: "部署到 staging 时注意改下连接池大小",
    },
  },
};

/**
 * Web UI 渠道
 */
export const WebUI: Story = {
  args: {
    session: {
      key: "webui:console",
      status: "done",
      channel: "Web UI",
      peerDisplayName: "团长", peerName: "user:379800680b7a48fa8955e8d17f73c39c",
      botName: "皮皮虾",
      botId: "pipixia_bot",
      model: "mlamp/claude-sonnet-4",
      ctxUsed: 1200,
      ctxMax: 200000,
      sessionId: "sess_web_a118fe27c4",
      lastMsg: "/status",
    },
  },
};

/**
 * 多卡片列表展示（模拟真实使用场景 - 5 种状态）
 */
export const MultipleCards: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <ClawSessionItem
        session={{
          key: "octo:c_pipi_lux_01",
          status: "running",
          channel: "Octo",
          peerDisplayName: "团长", peerName: "user:379800680b7a48fa8955e8d17f73c39c",
          botName: "皮皮虾",
          botId: "pipixia_bot",
          model: "mlamp/claude-opus-4-7",
          ctxUsed: 148200,
          ctxMax: 1000000,
          sessionId: "sess_octo_7f3a2b18e",
          lastMsg: "帮我用糗米写一份 OctoPush 的 V0.0.3 发布公告",
        }}
      />
      <ClawSessionItem
        session={{
          key: "discord:1470015610489536542",
          status: "running",
          channel: "Discord",
          peerDisplayName: "团长", peerName: "user:379800680b7a48fa8955e8d17f73c39c",
          botName: "皮皮虾",
          botId: "pipixia_bot",
          model: "mlamp/claude-opus-4-7",
          ctxUsed: 850000,
          ctxMax: 1000000,
          sessionId: "sess_disc_d7f3a2b18e",
          lastMsg: "关于OctoPush的原型，有几个小问题需要修改一下…",
        }}
      />
      <ClawSessionItem
        session={{
          key: "octo:g_botfather",
          status: "done",
          channel: "Octo",
          peerDisplayName: "团长", peerName: "user:379800680b7a48fa8955e8d17f73c39c",
          botName: "皮皮虾",
          botId: "pipixia_bot",
          model: "mlamp/claude-opus-4-7",
          ctxUsed: 4200,
          ctxMax: 1000000,
          sessionId: "sess_octo_bf_33aa2",
          lastMsg: "/start",
        }}
      />
      <ClawSessionItem
        session={{
          key: "localhost:task_fail",
          status: "failed",
          channel: "Localhost",
          peerDisplayName: "团长", peerName: "user:379800680b7a48fa8955e8d17f73c39c",
          botName: "皮皮虾",
          botId: "pipixia_bot",
          model: "mlamp/claude-opus-4-7",
          ctxUsed: 32400,
          ctxMax: 200000,
          sessionId: "sess_local_task_f7a2",
          lastMsg: "导入 CSV 文件到数据库",
        }}
      />
      <ClawSessionItem
        session={{
          key: "discord:timeout_01",
          status: "timeout",
          channel: "Discord",
          peerDisplayName: "团长", peerName: "user:379800680b7a48fa8955e8d17f73c39c",
          botName: "皮皮虾",
          botId: "pipixia_bot",
          model: "mlamp/claude-sonnet-4",
          ctxUsed: 18000,
          ctxMax: 200000,
          sessionId: "sess_disc_timeout_t9c3",
          lastMsg: "同步远程 API 数据",
        }}
      />
    </div>
  ),
};
