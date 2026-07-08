import type {
  Issue,
  IssueComment,
  AgentTask,
  Skill,
  Project,
  Agent,
  Squad,
  Workspace,
  AssigneeCandidate,
} from "../types";

const WS = "ws-loop-demo";
const now = Date.now();
const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();
const H = 3600 * 1000;
const D = 24 * H;

/* ---------- 指派候选（member / agent / squad 三态） ---------- */
export const CANDIDATES: AssigneeCandidate[] = [
  { id: "u-1", type: "member", name: "lvsijia", avatar_color: "blue" },
  { id: "u-2", type: "member", name: "wangfei", avatar_color: "green" },
  { id: "u-3", type: "member", name: "chenhao", avatar_color: "orange" },
  { id: "a-1", type: "agent", name: "Analyser-CC", avatar_color: "violet" },
  { id: "a-2", type: "agent", name: "CodeBuilder", avatar_color: "cyan" },
  { id: "a-3", type: "agent", name: "Documenter", avatar_color: "teal" },
  { id: "s-1", type: "squad", name: "Loop 前端小队", avatar_color: "purple" },
  { id: "s-2", type: "squad", name: "Runtime 小队", avatar_color: "amber" },
];

export function seedIssues(): Issue[] {
  const base: Array<Partial<Issue> & Pick<Issue, "title" | "status" | "priority">> = [
    {
      title: "抽取 Runtime + Loop 两大一级 Panel",
      status: "in_progress",
      priority: "high",
      assignee_type: "agent",
      assignee_id: "a-1",
      assignee_name: "Analyser-CC",
      project_id: "p-1",
      project_name: "Loop V1",
      description: "在 octo-web 架构下完整复现 Loop 的两个一级面板。",
    },
    {
      title: "看板拖拽交互实现",
      status: "in_review",
      priority: "medium",
      assignee_type: "member",
      assignee_id: "u-1",
      assignee_name: "lvsijia",
      project_id: "p-1",
      project_name: "Loop V1",
      description: "原生 HTML5 拖拽，跨列改 status。",
    },
    {
      title: "评论增删/回复能力",
      status: "todo",
      priority: "medium",
      assignee_type: "squad",
      assignee_id: "s-1",
      assignee_name: "Loop 前端小队",
      project_id: "p-1",
      project_name: "Loop V1",
    },
    {
      title: "设备详情只读页",
      status: "done",
      priority: "low",
      assignee_type: "agent",
      assignee_id: "a-2",
      assignee_name: "CodeBuilder",
      project_id: "p-2",
      project_name: "Runtime 展示",
    },
    {
      title: "Mock API 契约对齐",
      status: "backlog",
      priority: "none",
      assignee_type: null,
      assignee_id: null,
      assignee_name: null,
    },
    {
      title: "旧原型静态页需下线",
      status: "cancelled",
      priority: "low",
      assignee_type: "member",
      assignee_id: "u-3",
      assignee_name: "chenhao",
    },
    {
      title: "构建产物体积超阈值",
      status: "blocked",
      priority: "urgent",
      assignee_type: "member",
      assignee_id: "u-2",
      assignee_name: "wangfei",
      description: "阻塞：需先拆分依赖。",
    },
    {
      title: "二级菜单路由骨架",
      status: "done",
      priority: "high",
      assignee_type: "agent",
      assignee_id: "a-1",
      assignee_name: "Analyser-CC",
      project_id: "p-1",
      project_name: "Loop V1",
    },
  ];

  return base.map((b, i) => ({
    id: `i-${i + 1}`,
    workspace_id: WS,
    number: i + 1,
    identifier: `LOOP-${i + 1}`,
    title: b.title,
    description: b.description ?? null,
    status: b.status,
    priority: b.priority,
    assignee_type: b.assignee_type ?? null,
    assignee_id: b.assignee_id ?? null,
    assignee_name: b.assignee_name ?? null,
    creator_id: "u-1",
    creator_name: "lvsijia",
    project_id: b.project_id ?? null,
    project_name: b.project_name ?? null,
    position: i,
    start_date: null,
    due_date: null,
    created_at: iso((8 - i) * D),
    updated_at: iso(i * H),
  }));
}

export function seedComments(): IssueComment[] {
  return [
    {
      id: "c-1",
      issue_id: "i-1",
      parent_id: null,
      author_type: "member",
      author_id: "u-1",
      author_name: "lvsijia",
      content: "先出 PLAN，再逐子模块填充，Issue 优先。",
      created_at: iso(5 * H),
    },
    {
      id: "c-2",
      issue_id: "i-1",
      parent_id: "c-1",
      author_type: "agent",
      author_id: "a-1",
      author_name: "Analyser-CC",
      content: "收到，看板拖拽用原生 HTML5，不引第三方库。",
      created_at: iso(4 * H),
    },
    {
      id: "c-3",
      issue_id: "i-1",
      parent_id: null,
      author_type: "member",
      author_id: "u-2",
      author_name: "wangfei",
      content: "记得预留 space_id → workspace_id 口子。",
      created_at: iso(2 * H),
    },
  ];
}

export function seedSkills(): Skill[] {
  return [
    {
      id: "sk-1",
      workspace_id: WS,
      name: "code-review",
      description: "对 PR 做结构化代码评审。",
      source: "github",
      content: "# code-review\n\n对变更做质量、安全、可维护性评审并输出建议。",
      used_by: 3,
      creator_name: "lvsijia",
      created_at: iso(20 * D),
      updated_at: iso(3 * D),
    },
    {
      id: "sk-2",
      workspace_id: WS,
      name: "doc-writer",
      description: "从代码与讨论生成技术文档。",
      source: "workspace",
      content: "# doc-writer\n\n汇总上下文并产出结构化文档。",
      used_by: 2,
      creator_name: "chenhao",
      created_at: iso(15 * D),
      updated_at: iso(1 * D),
    },
    {
      id: "sk-3",
      workspace_id: WS,
      name: "local-runner",
      description: "在本地设备执行构建与测试。",
      source: "local",
      content: "# local-runner\n\n串联本地构建/测试流程。",
      used_by: 0,
      creator_name: "wangfei",
      created_at: iso(9 * D),
      updated_at: iso(9 * D),
    },
  ];
}

export function seedProjects(): Project[] {
  return [
    {
      id: "p-1",
      workspace_id: WS,
      title: "Loop V1",
      description: "Runtime + Loop 两大一级面板基础版本。",
      icon: "🔁",
      status: "in_progress",
      priority: "high",
      lead_type: "member",
      lead_id: "u-1",
      lead_name: "lvsijia",
      issue_count: 5,
      done_count: 2,
      created_at: iso(30 * D),
      updated_at: iso(2 * H),
    },
    {
      id: "p-2",
      workspace_id: WS,
      title: "Runtime 展示",
      description: "设备/Runtime 只读展示页。",
      icon: "🖥️",
      status: "planned",
      priority: "medium",
      lead_type: "agent",
      lead_id: "a-2",
      lead_name: "CodeBuilder",
      issue_count: 1,
      done_count: 1,
      created_at: iso(12 * D),
      updated_at: iso(1 * D),
    },
  ];
}

export function seedAgents(): Agent[] {
  return [
    {
      id: "a-1",
      workspace_id: WS,
      name: "Analyser-CC",
      description: "分析与规划型智能体。",
      instructions: "先规划再执行，落盘中间结果。",
      status: "working",
      runtime_id: "rt-001",
      runtime_name: "kaka-mbp",
      model: "claude-opus-4",
      thinking_level: "medium",
      custom_args: ["--verbose"],
      visibility: "workspace",
      max_concurrent_tasks: 2,
      owner_name: "lvsijia",
      skills: ["code-review", "doc-writer"],
      runs_30d: 64,
      created_at: iso(28 * D),
      updated_at: iso(1 * H),
    },
    {
      id: "a-2",
      workspace_id: WS,
      name: "CodeBuilder",
      description: "编码实现型智能体。",
      instructions: "遵循仓库既有风格，最小改动。",
      status: "idle",
      runtime_id: "rt-002",
      runtime_name: "build-runner-01",
      model: "codex-latest",
      thinking_level: "none",
      custom_args: [],
      visibility: "workspace",
      max_concurrent_tasks: 3,
      owner_name: "octo-bot",
      skills: ["local-runner"],
      runs_30d: 120,
      created_at: iso(25 * D),
      updated_at: iso(6 * H),
    },
    {
      id: "a-3",
      workspace_id: WS,
      name: "Documenter",
      description: "文档归档型智能体。",
      instructions: "归档为文档为最后一步。",
      status: "offline",
      runtime_id: "rt-003",
      runtime_name: "gpu-node-a",
      model: "claude-sonnet-4",
      thinking_level: "light",
      custom_args: [],
      visibility: "private",
      max_concurrent_tasks: 1,
      owner_name: "chenhao",
      skills: ["doc-writer"],
      runs_30d: 0,
      created_at: iso(18 * D),
      updated_at: iso(3 * D),
    },
  ];
}

export function seedSquads(): Squad[] {
  return [
    {
      id: "s-1",
      workspace_id: WS,
      name: "Loop 前端小队",
      description: "负责 Loop 前端面板。",
      instructions: "以 Semi UI 为基础，1:1 复刻交互。",
      leader_id: "a-1",
      leader_name: "Analyser-CC",
      creator_name: "lvsijia",
      members: [
        { member_type: "agent", member_id: "a-1", member_name: "Analyser-CC", role: "leader" },
        { member_type: "agent", member_id: "a-2", member_name: "CodeBuilder", role: "member" },
        { member_type: "member", member_id: "u-1", member_name: "lvsijia", role: "member" },
      ],
      created_at: iso(10 * D),
      updated_at: iso(2 * H),
    },
    {
      id: "s-2",
      workspace_id: WS,
      name: "Runtime 小队",
      description: "负责设备/Runtime 能力。",
      instructions: "只读展示优先，后续接编辑。",
      leader_id: "u-2",
      leader_name: "wangfei",
      creator_name: "wangfei",
      members: [
        { member_type: "member", member_id: "u-2", member_name: "wangfei", role: "leader" },
        { member_type: "agent", member_id: "a-3", member_name: "Documenter", role: "member" },
      ],
      created_at: iso(7 * D),
      updated_at: iso(1 * D),
    },
  ];
}

export function seedWorkspaces(): Workspace[] {
  return [
    { id: "ws-loop-demo", name: "Loop Demo", slug: "loop-demo", avatar_color: "blue" },
    { id: "ws-octo", name: "Octo 团队", slug: "octo", avatar_color: "violet" },
    { id: "ws-lab", name: "实验空间", slug: "lab", avatar_color: "green" },
  ];
}

export function seedTasks(): AgentTask[] {
  return [
    {
      id: "t-1",
      issue_id: "i-1",
      agent_id: "a-1",
      agent_name: "Analyser-CC",
      status: "running",
      trigger_summary: "Initial run",
      created_at: iso(30 * 60 * 1000),
      completed_at: null,
    },
    {
      id: "t-2",
      issue_id: "i-1",
      agent_id: "a-1",
      agent_name: "Analyser-CC",
      status: "completed",
      trigger_summary: "Comment: 先出 PLAN",
      created_at: iso(5 * H),
      completed_at: iso(4 * H),
    },
    {
      id: "t-3",
      issue_id: "i-7",
      agent_id: "a-2",
      agent_name: "CodeBuilder",
      status: "failed",
      trigger_summary: "Retry #1",
      created_at: iso(2 * H),
      completed_at: iso(1 * H),
    },
  ];
}

/** agent_id → custom_env（密钥仅本地 mock，展示 key + 掩码值）。 */
export function seedAgentEnv(): Record<string, Record<string, string>> {
  return {
    "a-1": { OPENAI_API_KEY: "sk-****", LOG_LEVEL: "info" },
    "a-2": { GITHUB_TOKEN: "ghp-****" },
  };
}

