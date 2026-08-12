// Type definitions + static fixtures for the Expert Marketplace (专家市场). The
// TS shapes (ExpertItem / ExpertAgent / ExpertSquad / …) are the frontend's
// canonical model; expertWire.ts maps the octo-marketplace wire onto them. The
// fixture arrays at the bottom are only the USE_MOCK fallback in
// expertService.ts — the live path fetches from the expert catalog backend.

/**
 * A skill attached to an expert / squad member — a whole Agent-Skill package
 * (a .zip/.skill containing SKILL.md). `name` is always present; the rest is the
 * read / detail projection:
 *   - `hasContent` — a stored SKILL.md exists (drives the markdown viewer).
 *   - `canDownload` — the raw package is stored (drives the download button).
 *   - `fileName` / `fileSize` — the uploaded package's original name/size.
 *   - `files` — manifest of paths inside the package (bundled-file list).
 * Content/package bytes are fetched lazily via the skill_md / skill_download
 * endpoints; they are never carried inline on this shape.
 */
export interface ExpertSkill {
  name: string;
  hasContent?: boolean;
  canDownload?: boolean;
  fileName?: string;
  fileSize?: number;
  files?: string[];
}

/** A single member inside an expert squad. */
export interface ExpertMember {
  /** Stable key used to bind memberKey -> agentId during install. */
  key?: string;
  /** Expert template this member is created from. */
  templateId?: string;
  name: string;
  role: string;
  /** Exactly one member per squad should be the leader. */
  leader?: boolean;
  /** System prompt / instructions for this member (required by the backend). */
  instruction?: string;
  /** Raw MCP servers config (mcpServers JSON) carried from the source expert. */
  mcpConfig?: string;
  /** Skills attached to this member, carried from the source expert. */
  skills?: ExpertSkill[];
}

interface ExpertBase {
  id: string;
  /** Short label rendered inside the square logo tile (e.g. 研发). */
  shortName: string;
  name: string;
  summary: string;
  category: string;
  tags: string[];
  /** Publishing org, shown in the detail header meta. */
  publisher: string;
  /** Wire visibility; "system" marks a platform-published (官方) record and
   *  swaps the owner row for the official badge (mirrors MCP). */
  visibility?: string;
  /** Who created this entry — drives the bot/human owner display (mirrors MCP). */
  createdByType: "bot" | "human";
  /** Bot display name when createdByType === "bot". */
  botName?: string;
  /** Human creator display name. */
  creatorName: string;
  /** System prompt / instructions that define how the expert behaves. */
  instruction?: string;
  /** Raw MCP servers config (mcpServers JSON), as entered in the config editor. */
  mcpConfig?: string;
  /** Skills attached to the expert (uploaded; content fetched lazily on view). */
  skills?: ExpertSkill[];
  /**
   * Marks an entry as belonging to the current user, so it surfaces under the
   * 我的 tab. Locally-published items are always "mine" (creatorName === 我);
   * this flag lets the static fixtures seed a few owned entries too, without
   * depending on the locale-specific self label.
   */
  mine?: boolean;
}

/** A multi-expert squad with an explicit dispatch strategy. */
export interface ExpertSquad extends ExpertBase {
  kind: "squad";
  /** Display name of the leader member. */
  leader: string;
  members: ExpertMember[];
  /**
   * Member count for list projections. List items carry `memberCount` from the
   * backend `member_count` but an empty `members` array (the heavy roster loads
   * on detail); the card falls back to `members.length` for fully-hydrated items.
   */
  memberCount?: number;
  /** Dispatch rules; when omitted the modal/prompt falls back to defaults. */
  strategies?: string[];
  dependencies: {
    blocking: string[];
    recommended: string[];
  };
  permission: string;
  /** Whether the current environment satisfies the blocking dependencies. */
  checkResult: "supported" | "missing";
}

/** A single expert (no internal team). */
export interface ExpertAgent extends ExpertBase {
  kind: "agent";
}

export type ExpertItem = ExpertSquad | ExpertAgent;

/** Target workspace shown in generated prompts (prototype: window.prototypeData.workspace). */
export const EXPERT_WORKSPACE = "增长产品组";

/** Filter categories. "全部" is the pseudo "all" bucket, always first. */
export const EXPERT_CATEGORIES: string[] = [
  "全部",
  "营销策划",
  "内容创作",
  "广告投放",
  "数据洞察",
  "办公提效",
  "研发工具",
];

/** Fallback dispatch rules for squads that don't declare their own. */
export const DEFAULT_STRATEGIES: string[] = [
  "Leader 先澄清目标、范围、验收标准和失败处理方式。",
  "无前置依赖的成员可以并行；有依赖关系的任务按顺序串行。",
  "每位成员向 Leader 提交结果、证据和阻塞项，由 Leader 统一协调。",
  "关键决策与最终交付保留人工确认，不通过时退回对应环节修正。",
];

export const EXPERT_SQUADS: ExpertSquad[] = [
  {
    id: "software-delivery",
    kind: "squad",
    mine: true,
    shortName: "研发",
    name: "软件研发交付团",
    summary: "从需求澄清、方案设计到开发测试，交付一条可复用的软件研发协作链路。",
    category: "研发工具",
    tags: ["需求分析", "前后端开发", "自动化测试"],
    publisher: "Mininglamp-OSS",
    createdByType: "bot",
    botName: "研发交付助手",
    creatorName: "林澈",
    leader: "技术负责人",
    members: [
      { key: "product_analyst", templateId: "expert-product-analyst", name: "产品分析师", role: "澄清需求与验收标准", leader: false },
      { key: "tech_lead", templateId: "expert-tech-lead", name: "技术负责人", role: "拆解方案并调度成员", leader: true },
      { key: "frontend_engineer", templateId: "expert-frontend-engineer", name: "前端工程师", role: "实现界面与交互", leader: false },
      { key: "backend_engineer", templateId: "expert-backend-engineer", name: "后端工程师", role: "实现服务与数据接口", leader: false },
      { key: "qa_engineer", templateId: "expert-qa-engineer", name: "测试工程师", role: "测试、回归与质量把关", leader: false },
    ],
    strategies: [
      "技术负责人先接收任务，调用产品分析师澄清需求、范围和验收标准，再形成技术拆分。",
      "方案确认后并行调用前端工程师与后端工程师；两者共享同一份接口契约和需求上下文。",
      "前后端均完成后串行调用测试工程师，测试结论和证据统一回传技术负责人。",
      "测试失败时退回对应工程师修正，最多 2 轮；仍失败则暂停并请求人工处理。",
      "最终结果只由技术负责人统一验收并向用户提交。",
    ],
    dependencies: {
      blocking: ["codex-runtime", "git-mcp", "playwright-skill"],
      recommended: ["GPT-5.2 或同等能力模型"],
    },
    permission: "读取工作区文件、创建专家配置、写入专家团关系",
    checkResult: "supported",
  },
  {
    id: "brand-growth",
    kind: "squad",
    shortName: "品牌",
    name: "品牌增长专家团",
    summary: "持续追踪行业热点、竞品动作与用户口碑，形成品牌洞察和内容建议。",
    category: "营销策划",
    tags: ["热点追踪", "竞品监测", "口碑洞察"],
    publisher: "Octo Community",
    createdByType: "bot",
    botName: "品牌雷达 Bot",
    creatorName: "苏窈",
    leader: "品牌策略负责人",
    members: [
      { name: "品牌策略负责人", role: "定义课题并汇总策略", leader: true },
      { name: "热点研究员", role: "跟踪行业与社媒热点", leader: false },
      { name: "竞品分析师", role: "拆解竞品动作与节奏", leader: false },
      { name: "用户洞察师", role: "提炼口碑与用户信号", leader: false },
    ],
    dependencies: {
      blocking: ["social-listener-mcp"],
      recommended: ["联网搜索能力"],
    },
    permission: "读取公开网页、创建专家配置、写入专家团关系",
    checkResult: "missing",
  },
  {
    id: "office-copilot",
    kind: "squad",
    mine: true,
    shortName: "办公",
    name: "办公助理团",
    summary: "覆盖文档写作、数据整理、会议纪要和汇报演讲的日常办公协作。",
    category: "办公提效",
    tags: ["文档写作", "数据分析", "汇报演讲"],
    publisher: "Octo Community",
    createdByType: "human",
    creatorName: "周敏",
    leader: "行政协调员",
    members: [
      { name: "行政协调员", role: "拆解事项并组织交付", leader: true },
      { name: "文档助手", role: "撰写和修订文档", leader: false },
      { name: "数据助手", role: "整理与分析表格", leader: false },
      { name: "会议助理", role: "整理纪要与待办", leader: false },
      { name: "演讲教练", role: "打磨汇报结构和讲稿", leader: false },
    ],
    dependencies: {
      blocking: ["documents-skill", "spreadsheets-skill"],
      recommended: [],
    },
    permission: "读取用户选择的文档、创建专家配置、写入专家团关系",
    checkResult: "supported",
  },
  {
    id: "data-insight",
    kind: "squad",
    shortName: "洞察",
    name: "经营数据洞察团",
    summary: "从指标口径、数据核验到分析结论，协作产出可追溯的经营洞察。",
    category: "数据洞察",
    tags: ["指标口径", "数据分析", "结论审阅"],
    publisher: "Octo Community",
    createdByType: "bot",
    botName: "数据洞察 Bot",
    creatorName: "陈析",
    leader: "数据分析负责人",
    members: [
      { name: "数据分析负责人", role: "定义问题与结论框架", leader: true },
      { name: "数据核验员", role: "检查来源与数据质量", leader: false },
      { name: "业务分析师", role: "分析波动与业务原因", leader: false },
    ],
    dependencies: {
      blocking: ["spreadsheets-skill"],
      recommended: ["SQL 数据源连接"],
    },
    permission: "读取用户选择的数据、创建专家配置、写入专家团关系",
    checkResult: "supported",
  },
  {
    id: "product-discovery",
    kind: "squad",
    shortName: "产品",
    name: "产品探索专家团",
    summary: "围绕用户问题、竞品证据与方案原型，快速形成可测试的产品假设。",
    category: "内容创作",
    tags: ["用户研究", "竞品分析", "原型验证"],
    publisher: "Octo Community",
    createdByType: "human",
    creatorName: "许衡",
    leader: "产品负责人",
    members: [
      { name: "产品负责人", role: "收敛问题和决策", leader: true },
      { name: "用户研究员", role: "整理用户证据", leader: false },
      { name: "竞品分析师", role: "比较替代方案", leader: false },
      { name: "交互设计师", role: "形成可测试原型", leader: false },
    ],
    dependencies: {
      blocking: ["browser-skill"],
      recommended: ["figma-mcp"],
    },
    permission: "读取公开页面、创建专家配置、写入专家团关系",
    checkResult: "supported",
  },
  {
    id: "incident-response",
    kind: "squad",
    shortName: "应急",
    name: "线上故障响应团",
    summary: "协同定位线上异常、评估影响、执行修复并沉淀可复盘的事件记录。",
    category: "研发工具",
    tags: ["故障定位", "风险评估", "复盘沉淀"],
    publisher: "Octo Community",
    createdByType: "bot",
    botName: "值守 Bot",
    creatorName: "高琳",
    leader: "事件指挥官",
    members: [
      { name: "事件指挥官", role: "协调响应与决策", leader: true },
      { name: "日志分析师", role: "定位异常信号", leader: false },
      { name: "修复工程师", role: "制定并执行修复", leader: false },
      { name: "复盘记录员", role: "沉淀时间线与改进项", leader: false },
    ],
    dependencies: {
      blocking: ["observability-mcp"],
      recommended: ["代码仓库只读权限"],
    },
    permission: "读取授权日志、创建专家配置、写入专家团关系",
    checkResult: "missing",
  },
];

export const EXPERT_AGENTS: ExpertAgent[] = [
  { id: "backend-architect", kind: "agent", mine: true, shortName: "架构", name: "后端架构师", summary: "评审服务边界、数据模型和可靠性方案。", category: "研发工具", tags: ["架构评审", "可靠性"], publisher: "Octo Community", createdByType: "human", creatorName: "王决", instruction: "你是资深后端架构师。评审时先澄清业务约束与非功能需求，再从服务边界、数据模型、一致性与容量四个维度给出可执行建议，并标注风险与验证方式。", mcpConfig: '{\n  "mcpServers": {\n    "git": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-git"]\n    },\n    "postgres": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-postgres"]\n    }\n  }\n}', skills: [{ name: "架构评审清单" }, { name: "容量估算模板" }] },
  { id: "code-reviewer", kind: "agent", shortName: "审查", name: "代码审查专家", summary: "围绕正确性、安全和可维护性输出可执行的审查意见。", category: "研发工具", tags: ["代码质量", "安全"], publisher: "Octo Community", createdByType: "bot", botName: "CodeReview Bot", creatorName: "李衡", instruction: "逐文件审查改动，按正确性 > 安全 > 可维护性排序给出问题，每条包含定位、原因和修复建议；无问题时明确说明。", mcpConfig: '{\n  "mcpServers": {\n    "git": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-git"]\n    }\n  }\n}', skills: [{ name: "安全审查规则" }] },
  { id: "market-researcher", kind: "agent", shortName: "研究", name: "市场研究员", summary: "从公开资料中提炼市场结构、竞品证据与关键趋势。", category: "营销策划", tags: ["竞品", "趋势"], publisher: "Octo Community", createdByType: "human", creatorName: "赵岚" },
  { id: "report-writer", kind: "agent", shortName: "报告", name: "经营报告助手", summary: "把结构化数据转成面向决策的经营汇报。", category: "办公提效", tags: ["汇报", "写作"], publisher: "Octo Community", createdByType: "bot", botName: "经营报告 Bot", creatorName: "钱悦" },
  { id: "data-auditor", kind: "agent", shortName: "核验", name: "数据核验员", summary: "检查数据来源、口径、缺失和异常值。", category: "数据洞察", tags: ["数据质量", "口径"], publisher: "Octo Community", createdByType: "human", creatorName: "孙检" },
  { id: "ux-prototyper", kind: "agent", mine: true, shortName: "交互", name: "交互原型师", summary: "将产品假设快速转成可测试的交互原型。", category: "内容创作", tags: ["交互", "原型"], publisher: "Octo Community", createdByType: "human", creatorName: "周原" },
];
