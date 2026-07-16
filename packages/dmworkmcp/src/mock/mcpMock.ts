import type { McpDetail, McpListItem, McpQuickStart } from "../types/mcp";

// ═══════════════════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════════════════
// This file holds the in-memory fixtures the mock service returns. When the
// real backend is wired up, NOTHING here needs to change — only the mock
// implementation in ./api/mcpService switches off (see USE_MOCK there).
// Keep this file free of any network / React imports so it stays trivially
// swappable.

/** Category keys → human label. The list service derives live counts from data. */
export const MCP_CATEGORY_LABELS: Record<string, string> = {
  all: "全部",
  dev: "开发工具",
  data: "数据服务",
  search: "搜索检索",
  productivity: "效率协作",
  ai: "AI 能力",
};

/** Order categories appear in the filter pill row. */
export const MCP_CATEGORY_ORDER = [
  "all",
  "dev",
  "data",
  "search",
  "productivity",
  "ai",
];

function tools(
  names: [string, string][]
): { name: string; description: string }[] {
  return names.map(([name, description]) => ({ name, description }));
}

/** Helper: a hosted (remote) quick-start with bearer auth. `name` doubles as
 *  the slug because all built-in fixtures already use ASCII slugs (github,
 *  postgres, etc.) — same behaviour as the real backend which auto-slugifies
 *  when the client omits `slug`. */
function remoteQuickStart(name: string): McpQuickStart {
  return {
    transport: "streamable-http",
    serverName: name,
    slug: name,
    url: `https://mcp.deepminer.com.cn/${name}/mcp`,
    authType: "bearer",
  };
}

/** Helper: a stdio (local command) quick-start. Same slug=name convention as
 *  the remote helper (see comment above). */
function stdioQuickStart(
  name: string,
  args: string[],
  env?: Record<string, string>
): McpQuickStart {
  return {
    transport: "stdio",
    serverName: name,
    slug: name,
    command: "npx",
    args,
    env,
  };
}

export const MOCK_MCP_DETAILS: McpDetail[] = [
  {
    id: "github",
    creatorName: "GitHub Bot",
    name: "GitHub MCP",
    slogan: "读写仓库、Issue、PR，让智能体直接操作你的 GitHub。",
    category: "dev",
    tags: ["官方", "热门"],
    toolCount: 8,
    icon: "🐙",
    quickStart: remoteQuickStart("github"),
    tools: tools([
      ["list_repositories", "列出当前账号可访问的仓库"],
      ["create_issue", "在指定仓库创建 Issue"],
      ["comment_issue", "对 Issue 追加评论"],
      ["create_pull_request", "创建 Pull Request"],
      ["merge_pull_request", "合并指定 PR"],
      ["search_code", "跨仓库搜索代码"],
      ["get_file_contents", "读取仓库文件内容"],
      ["list_workflow_runs", "查询 Actions 运行记录"],
    ]),
    usageExamples: [
      "帮我在 octo-web 仓库里创建一个 Issue，标题「MCP 市场入口对齐」，正文引用本次讨论结论。",
    ],
    faqs: [
      {
        question: "需要哪些权限？",
        answer:
          "至少需要 repo 权限；若要操作 Actions，请额外授予 workflow 权限。",
      },
      {
        question: "支持 GitHub Enterprise 吗？",
        answer:
          "支持，通过 env 里的 GITHUB_API_URL 指向你的 Enterprise 实例即可。",
      },
    ],
    notes: [
      "Token 请使用最小必要权限，避免授予组织级管理权限。",
      "高频调用受 GitHub API 速率限制（默认 5000 次/小时）。",
    ],
  },
  {
    id: "postgres",
    creatorName: "数据平台组",
    name: "PostgreSQL MCP",
    slogan: "只读方式安全查询数据库，自动生成 SQL 并解释结果。",
    category: "data",
    tags: ["数据库"],
    toolCount: 5,
    icon: "🐘",
    quickStart: stdioQuickStart("postgres", [
      "-y",
      "@modelcontextprotocol/server-postgres",
      "postgresql://<user>:<pwd>@<host>:5432/<db>",
    ]),
    tools: tools([
      ["query", "执行只读 SQL 查询"],
      ["list_tables", "列出数据库中的表"],
      ["describe_table", "查看表结构与字段类型"],
      ["explain_query", "解释查询执行计划"],
      ["sample_rows", "抽样查看表数据"],
    ]),
    usageExamples: ["统计上个月每个渠道的活跃用户数，按降序列出前十。"],
    faqs: [
      {
        question: "会不会误改数据？",
        answer: "默认只读连接，不暴露任何写操作工具，安全用于生产库分析。",
      },
    ],
    notes: [
      "建议使用只读账号连接，进一步收敛权限。",
      "大结果集会自动分页，避免一次性拉取过多数据。",
    ],
  },
  {
    id: "brave-search",
    creatorName: "Brave Team",
    name: "Brave Search MCP",
    slogan: "接入 Brave 搜索，为智能体补充实时联网检索能力。",
    category: "search",
    tags: ["官方", "联网"],
    toolCount: 3,
    icon: "🦁",
    quickStart: stdioQuickStart(
      "brave-search",
      ["-y", "@modelcontextprotocol/server-brave-search"],
      { BRAVE_API_KEY: "<your-key>" }
    ),
    tools: tools([
      ["web_search", "网页搜索"],
      ["news_search", "新闻搜索"],
      ["local_search", "本地商户检索"],
    ]),
    usageExamples: ["查一下 2026 年 React 最新的官方文档地址，给出链接。"],
    faqs: [
      {
        question: "API Key 从哪申请？",
        answer: "在 Brave Search API 官网注册后可获取，免费额度足够个人使用。",
      },
    ],
    notes: ["检索结果受地区与语言参数影响，可在调用时指定。"],
  },
  {
    id: "filesystem",
    creatorName: "MCP 官方",
    name: "Filesystem MCP",
    slogan: "让智能体在受限目录内读写文件，安全可控。",
    category: "dev",
    tags: ["官方", "基础"],
    toolCount: 6,
    icon: "📁",
    quickStart: stdioQuickStart("filesystem", [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/path/to/allowed/dir",
    ]),
    tools: tools([
      ["read_file", "读取文件内容"],
      ["write_file", "写入文件"],
      ["list_directory", "列出目录内容"],
      ["search_files", "按名称/内容搜索文件"],
      ["move_file", "移动或重命名文件"],
      ["create_directory", "创建目录"],
    ]),
    usageExamples: ["把 downloads 目录下所有 .csv 文件汇总成一个 summary.md。"],
    faqs: [
      {
        question: "会访问授权目录之外的文件吗？",
        answer: "不会，所有操作被严格限制在启动时指定的目录范围内。",
      },
    ],
    notes: ["请仅授权确有需要的目录，避免指向系统敏感路径。"],
  },
  {
    id: "slack",
    creatorName: "李世超",
    name: "Slack MCP",
    slogan: "收发消息、查频道、拉取历史，把 Slack 接入智能体。",
    category: "productivity",
    tags: ["协作"],
    toolCount: 4,
    icon: "💬",
    quickStart: stdioQuickStart(
      "slack",
      ["-y", "@modelcontextprotocol/server-slack"],
      { SLACK_BOT_TOKEN: "<xoxb-...>" }
    ),
    tools: tools([
      ["post_message", "向频道发送消息"],
      ["list_channels", "列出可访问频道"],
      ["get_history", "拉取频道历史消息"],
      ["reply_thread", "在消息线程内回复"],
    ]),
    usageExamples: ["把今天的构建结果发到 #ci 频道，失败就 @ 值班同学。"],
    faqs: [
      {
        question: "需要哪种 Token？",
        answer:
          "需要 Bot Token（xoxb-），并在 Slack App 权限里勾选相应的 scope。",
      },
    ],
    notes: ["发送频率过高可能触发 Slack 的限流策略。"],
  },
  {
    id: "puppeteer",
    creatorName: "MCP 官方",
    name: "Puppeteer MCP",
    slogan: "驱动无头浏览器抓取页面、截图、填表单。",
    category: "dev",
    tags: ["浏览器"],
    toolCount: 5,
    icon: "🎭",
    quickStart: stdioQuickStart("puppeteer", [
      "-y",
      "@modelcontextprotocol/server-puppeteer",
    ]),
    tools: tools([
      ["navigate", "打开指定 URL"],
      ["click", "点击页面元素"],
      ["fill", "填写表单字段"],
      ["screenshot", "截取页面截图"],
      ["get_content", "抓取页面文本/HTML"],
    ]),
    usageExamples: ["打开这个商品页，抓取标题、价格和主图链接。"],
    faqs: [
      {
        question: "能处理登录墙吗？",
        answer: "可以在脚本里先执行登录步骤，或复用已有会话 cookie。",
      },
    ],
    notes: ["抓取第三方站点前请确认符合其使用条款。"],
  },
  {
    id: "gdrive",
    creatorName: "云端集成组",
    name: "Google Drive MCP",
    slogan: "检索与读取 Google Drive 文档，接入你的云端资料。",
    category: "productivity",
    tags: ["云盘"],
    toolCount: 3,
    icon: "📄",
    quickStart: remoteQuickStart("gdrive"),
    tools: tools([
      ["search", "搜索云盘文件"],
      ["read_file", "读取文件内容"],
      ["list_recent", "列出最近文件"],
    ]),
    usageExamples: ["找到上周的产品评审文档，总结其中的待办事项。"],
    faqs: [
      {
        question: "首次使用需要授权吗？",
        answer: "需要一次 OAuth 授权，之后凭证会缓存到本地。",
      },
    ],
    notes: ["仅读取，不提供删除/覆盖等破坏性操作。"],
  },
  {
    id: "memory",
    creatorName: "MCP 官方",
    name: "Memory MCP",
    slogan: "为智能体提供跨会话的长期记忆存储。",
    category: "ai",
    tags: ["官方"],
    toolCount: 4,
    icon: "🧠",
    quickStart: stdioQuickStart("memory", [
      "-y",
      "@modelcontextprotocol/server-memory",
    ]),
    tools: tools([
      ["create_entity", "创建记忆实体"],
      ["add_relation", "建立实体关系"],
      ["search_memory", "检索记忆"],
      ["delete_entity", "删除记忆实体"],
    ]),
    usageExamples: ["记住我更喜欢用中文回复、代码用 4 空格缩进。"],
    faqs: [
      {
        question: "记忆存在哪里？",
        answer: "默认存本地文件，可通过配置切换到外部存储。",
      },
    ],
    notes: ["敏感信息不建议写入长期记忆。"],
  },
  {
    id: "fetch",
    creatorName: "MCP 官方",
    name: "Fetch MCP",
    slogan: "抓取任意 URL 内容并转成适合模型阅读的文本。",
    category: "search",
    tags: ["官方", "联网"],
    toolCount: 1,
    icon: "🌐",
    quickStart: remoteQuickStart("fetch"),
    tools: tools([["fetch", "抓取 URL 并转为 Markdown"]]),
    usageExamples: ["把这篇博客抓下来，提炼三条核心观点。"],
    faqs: [
      {
        question: "支持鉴权页面吗？",
        answer: "可传入自定义请求头以携带鉴权信息。",
      },
    ],
    notes: ["超大页面会自动截断，避免超出上下文。"],
  },
  {
    id: "sqlite",
    creatorName: "MCP 官方",
    name: "SQLite MCP",
    slogan: "轻量本地数据库，读写查询一步到位。",
    category: "data",
    tags: ["官方", "数据库"],
    toolCount: 4,
    icon: "🗃️",
    quickStart: stdioQuickStart("sqlite", [
      "-y",
      "@modelcontextprotocol/server-sqlite",
      "/path/to/db.sqlite",
    ]),
    tools: tools([
      ["query", "执行 SQL 查询"],
      ["execute", "执行写入语句"],
      ["list_tables", "列出所有表"],
      ["describe_table", "查看表结构"],
    ]),
    usageExamples: ["在 notes 表里插入一条今天的备忘，再查出最近五条。"],
    faqs: [
      {
        question: "支持并发写入吗？",
        answer: "SQLite 写入是串行的，高并发场景建议改用 PostgreSQL MCP。",
      },
    ],
    notes: ["写入操作不可逆，建议先备份数据库文件。"],
  },
];

/** Card/list projection derived from the detail fixtures. */
export const MOCK_MCP_LIST: McpListItem[] = MOCK_MCP_DETAILS.map((d) => ({
  id: d.id,
  name: d.name,
  slogan: d.slogan,
  category: d.category,
  tags: d.tags,
  toolCount: d.toolCount,
  icon: d.icon,
}));

/**
 * Fake tool set returned by the mock probe (试连/获取工具列表).
 * TODO: 后端提供真实探测接口 — replace with the Electron main-process
 * `mcp:probeTools` result (see LSC-70).
 */
export const MOCK_PROBED_TOOLS = tools([
  ["list_resources", "列出可访问的资源"],
  ["get_resource", "读取单个资源内容"],
  ["search", "按关键词检索"],
  ["create_item", "创建一条记录"],
  ["update_item", "更新指定记录"],
]);
