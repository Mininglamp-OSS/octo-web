import type { NodeCategory, NodeType } from "../types/flow";

export interface NodeCatalogEntry {
  type: NodeType;
  category: NodeCategory;
  label: string;
  icon: string; // emoji rendered in palette + nodes
  description: string;
  /** Disabled = listed but not draggable (Phase 2 stubs). */
  disabled?: boolean;
}

export const NODE_CATALOG: NodeCatalogEntry[] = [
  // Triggers
  {
    type: "trigger.webhook",
    category: "trigger",
    label: "Webhook",
    icon: "⚡",
    description: "通过 HTTP 回调触发",
  },
  {
    type: "trigger.cron",
    category: "trigger",
    label: "Cron",
    icon: "⏰",
    description: "按定时表达式触发",
  },
  {
    type: "trigger.manual",
    category: "trigger",
    label: "手动",
    icon: "👆",
    description: "由用户手动触发",
  },
  // Logic
  {
    type: "logic.condition",
    category: "logic",
    label: "条件分支",
    icon: "🔀",
    description: "根据表达式走不同分支",
  },
  {
    type: "logic.parallel",
    category: "logic",
    label: "并行",
    icon: "⫴",
    description: "同时执行多条分支",
  },
  // Actions
  {
    type: "action.script",
    category: "action",
    label: "Script",
    icon: "⚙️",
    description: "执行 JavaScript 脚本",
  },
  {
    type: "action.http",
    category: "action",
    label: "HTTP 请求",
    icon: "🌐",
    description: "发起 HTTP 调用",
  },
  {
    type: "action.bot",
    category: "action",
    label: "Bot 动作",
    icon: "🤖",
    description: "调用 Bot（Phase 2）",
    disabled: true,
  },
  // Human
  {
    type: "human.approval",
    category: "human",
    label: "人工审批",
    icon: "👤",
    description: "等待人工确认（Phase 2）",
    disabled: true,
  },
];

export function catalogFor(type: NodeType): NodeCatalogEntry | undefined {
  return NODE_CATALOG.find((entry) => entry.type === type);
}

export const CATEGORY_COLORS: Record<NodeCategory, { bg: string; border: string; text: string }> = {
  trigger: { bg: "#E6F2FF", border: "#2E7DFC", text: "#1257B8" },
  logic: { bg: "#F3ECFF", border: "#7C5CFC", text: "#5A3DCC" },
  action: { bg: "#E6F7EA", border: "#3FB964", text: "#1F8A45" },
  human: { bg: "#FFF1E0", border: "#FF8A1F", text: "#C45A00" },
};
