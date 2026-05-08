import type { Meta, StoryObj } from "@storybook/react";
import SessionItem from "./index";

/**
 * SessionItem - Session 展示卡片
 *
 * 用于展示会话信息，包含对话方、模型、上下文使用情况等。
 * 支持折叠/展开，RUNNING 状态有强视觉标记。
 */
const meta: Meta<typeof SessionItem> = {
  title: "Components/SessionItem",
  component: SessionItem,
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
type Story = StoryObj<typeof SessionItem>;

/**
 * 默认状态（活跃，非 RUNNING）
 */
export const Default: Story = {
  args: {
    session: {
      key: "octo:c_pipi_lux_01",
      status: "active",
      running: false,
      channel: "Octo",
      party: "罗敬为 · 皮皮虾(私聊)",
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
      status: "active",
      running: true,
      channel: "Localhost",
      party: "终端 · openclaw chat",
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
      status: "active",
      running: true,
      channel: "Discord",
      party: "#square · LUO",
      model: "mlamp/claude-opus-4-7",
      ctxUsed: 850000,
      ctxMax: 1000000,
      sessionId: "sess_disc_d7f3a2b18e",
      lastMsg: "关于OctoPush的原型，有几个小问题需要修改一下…",
    },
  },
};

/**
 * 空闲状态（idle）
 */
export const Idle: Story = {
  args: {
    session: {
      key: "octo:g_botfather",
      status: "idle",
      running: false,
      channel: "Octo",
      party: "BotFather · 帮助频道",
      model: "mlamp/claude-opus-4-7",
      ctxUsed: 4200,
      ctxMax: 1000000,
      sessionId: "sess_octo_bf_33aa2",
      lastMsg: "/start",
    },
  },
};

/**
 * 飞书渠道
 */
export const Feishu: Story = {
  args: {
    session: {
      key: "feishu:oc_x4a91",
      status: "idle",
      running: false,
      channel: "飞书",
      party: "明略 AI 小组",
      model: "mlamp/claude-opus-4-7",
      ctxUsed: 8200,
      ctxMax: 200000,
      sessionId: "sess_fs_f3c9a7118b",
      lastMsg: "明天的周报帮我整理下，记得把 DMWork 进展写进去",
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
      status: "idle",
      running: false,
      channel: "Slack",
      party: "#dev-backend",
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
      status: "idle",
      running: false,
      channel: "Web UI",
      party: "本地管理员",
      model: "mlamp/claude-sonnet-4",
      ctxUsed: 1200,
      ctxMax: 200000,
      sessionId: "sess_web_a118fe27c4",
      lastMsg: "/status",
    },
  },
};

/**
 * 多卡片列表展示（模拟真实使用场景）
 */
export const MultipleCards: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <SessionItem
        session={{
          key: "octo:c_pipi_lux_01",
          status: "active",
          running: true,
          channel: "Octo",
          party: "罗敬为 · 皮皮虾(私聊)",
          model: "mlamp/claude-opus-4-7",
          ctxUsed: 148200,
          ctxMax: 1000000,
          sessionId: "sess_octo_7f3a2b18e",
          lastMsg: "帮我用糗米写一份 OctoPush 的 V0.0.3 发布公告",
        }}
      />
      <SessionItem
        session={{
          key: "discord:1470015610489536542",
          status: "active",
          running: true,
          channel: "Discord",
          party: "#square · LUO",
          model: "mlamp/claude-opus-4-7",
          ctxUsed: 850000,
          ctxMax: 1000000,
          sessionId: "sess_disc_d7f3a2b18e",
          lastMsg: "关于OctoPush的原型，有几个小问题需要修改一下…",
        }}
      />
      <SessionItem
        session={{
          key: "octo:g_botfather",
          status: "idle",
          running: false,
          channel: "Octo",
          party: "BotFather · 帮助频道",
          model: "mlamp/claude-opus-4-7",
          ctxUsed: 4200,
          ctxMax: 1000000,
          sessionId: "sess_octo_bf_33aa2",
          lastMsg: "/start",
        }}
      />
      <SessionItem
        session={{
          key: "localhost:cli_term_01",
          status: "active",
          running: true,
          channel: "Localhost",
          party: "终端 · openclaw chat",
          model: "mlamp/claude-opus-4-7",
          ctxUsed: 32400,
          ctxMax: 1000000,
          sessionId: "sess_local_cli_2a7",
          lastMsg: "帮我检查下本地 git 仓库的未提交文件",
        }}
      />
    </div>
  ),
};
