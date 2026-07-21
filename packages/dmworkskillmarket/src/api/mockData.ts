import type { Category, Skill, Visibility } from "../types/skill";

export const CURRENT_USER_ID = "me";
export const CURRENT_USER_NAME = "我";
export const CURRENT_SPACE_ID = "space-demo";

export const CATEGORY_SEEDS: Omit<Category, "skillCount">[] = [
  { id: "starter", name: "装机必备", iconKey: "Box", sortOrder: 1 },
  { id: "dev-tools", name: "开发工具", iconKey: "Terminal", sortOrder: 2 },
  { id: "infra", name: "基础设施", iconKey: "Server", sortOrder: 3 },
  { id: "office", name: "办公协作", iconKey: "FolderKanban", sortOrder: 4 },
  { id: "marketing", name: "市场推广", iconKey: "Megaphone", sortOrder: 5 },
  { id: "frontend", name: "前端开发", iconKey: "Monitor", sortOrder: 6 },
  { id: "media", name: "媒体处理", iconKey: "Film", sortOrder: 7 },
  { id: "quality", name: "代码质检", iconKey: "ShieldCheck", sortOrder: 8 },
  { id: "research", name: "洞察研究", iconKey: "Eye", sortOrder: 9 },
  { id: "analytics", name: "数据分析", iconKey: "ChartColumn", sortOrder: 10 },
  { id: "content", name: "内容营销", iconKey: "PenLine", sortOrder: 11 },
  { id: "mobile", name: "移动开发", iconKey: "Smartphone", sortOrder: 12 },
  { id: "cloud", name: "云效工具", iconKey: "Cloud", sortOrder: 13 },
  { id: "social", name: "社交娱乐", iconKey: "Gamepad2", sortOrder: 14 },
  { id: "other", name: "其他", iconKey: "MoreHorizontal", sortOrder: 15 },
  { id: "all", name: "全部", iconKey: "LayoutGrid", sortOrder: 16 },
];

interface SkillSeed {
  id: string;
  categoryId: string;
  ownerId?: string;
  ownerName: string;
  description: string;
  tags: string[];
  visibility: Visibility;
  version: string;
}

const skillSeeds: SkillSeed[] = [
  ["cli-workflow-kit", "dev-tools", "lianjingwei", "把多步 CLI 操作整理成可复用向导，适合部署、初始化和日常巡检场景。", ["CLI", "自动化"], "space", "1.3.2"],
  ["git-release-helper", "dev-tools", "chenxi", "根据提交记录生成变更摘要、版本标签和发布检查项。", ["Git", "发布"], "private", "1.1.0"],
  ["ci-failure-map", "dev-tools", "jian", "分析 CI 失败日志并定位到可能负责的模块、命令和最近提交。", ["CI", "调试"], "space", "1.0.2"],
  ["release-risk-radar", "dev-tools", "peilin", "结合改动范围、历史事故和测试覆盖生成发布风险雷达。", ["发布", "风险"], "space", "1.2.0"],
  ["markdown-link-doctor", "dev-tools", "ning", "检查文档链接、锚点和图片引用，生成修复补丁建议。", ["Markdown", "文档"], "space", "0.5.6"],
  ["branch-cleanup-planner", "dev-tools", "meng", "识别长期未合并分支，输出归档、合并和删除建议。", ["Git", "治理"], "space", "0.4.7"],
  ["env-bootstrap-pack", "starter", "me", "我", "为新机器生成开发环境安装清单、shell 初始化和常用账户检查项。", ["装机", "初始化"], "space", "1.0.0"],
  ["dotfile-sync-guide", "starter", "qiaoyi", "整理 dotfiles 差异，生成跨设备同步步骤和冲突处理建议。", ["Dotfiles", "同步"], "space", "0.8.4"],
  ["browser-extension-kit", "starter", "feifan", "安装并配置团队推荐浏览器扩展，输出权限说明与快捷入口。", ["浏览器", "效率"], "public", "0.9.2"],
  ["dev-proxy-switcher", "starter", "me", "我", "按项目自动切换代理、证书和本地 DNS 规则。", ["网络", "证书"], "private", "1.1.1"],
  ["secret-rotation-reminder", "starter", "zihan", "检查本地环境变量与密钥轮换周期，生成更新提醒。", ["Secret", "安全"], "space", "0.6.8"],
  ["docker-health-check", "infra", "kaiming", "巡检 Docker Compose 服务、端口占用与卷挂载状态。", ["Docker", "巡检"], "space", "1.0.6"],
  ["k8s-event-brief", "infra", "yumo", "读取 Kubernetes 事件，按命名空间聚合异常和修复建议。", ["K8s", "事件"], "space", "0.7.1"],
  ["redis-memory-scout", "infra", "xichen", "分析 Redis key 分布、过期策略和内存增长风险。", ["Redis", "内存"], "space", "0.5.9"],
  ["mq-lag-digest", "infra", "shuo", "汇总队列消费延迟、积压原因和扩容建议。", ["MQ", "延迟"], "space", "0.4.3"],
  ["meeting-note-cleaner", "office", "me", "我", "将会议纪要整理为决策、待办、风险和引用资料。", ["纪要", "协作"], "space", "1.1.3"],
  ["workflow-note-builder", "office", "me", "我", "把项目工作流记录转成模板化说明和可复用检查清单。", ["模板", "文档"], "public", "1.0.0"],
  ["okr-progress-writer", "office", "yue", "根据周报材料提炼 OKR 进展、阻塞项和下周计划。", ["OKR", "周报"], "space", "0.8.6"],
  ["space-onboarding-kit", "office", "yuhan", "为新 Space 成员生成资料索引、常用命令和团队工作流入口。", ["入门", "协作"], "space", "0.5.1"],
  ["campaign-brief-maker", "marketing", "ningxi", "把营销目标转成渠道计划、创意清单和投放节奏。", ["Campaign", "Brief"], "space", "0.9.3"],
  ["seo-keyword-cluster", "marketing", "song", "聚类搜索词并输出页面主题、标题建议和优先级。", ["SEO", "关键词"], "public", "1.0.5"],
  ["ad-copy-variant", "marketing", "moran", "根据人群与卖点生成多版本广告文案并标记风险词。", ["文案", "广告"], "space", "0.7.2"],
  ["lead-score-snapshot", "marketing", "xiaohe", "根据互动记录生成线索评分、跟进建议和归因备注。", ["线索", "CRM"], "private", "0.6.0"],
  ["storybook-state-mapper", "frontend", "nanxi", "从组件 Props 生成 Storybook 状态矩阵和空/错/加载用例。", ["Storybook", "状态"], "space", "1.2.4"],
  ["css-token-auditor", "frontend", "ruxin", "扫描硬编码颜色与间距，建议替换为设计 token。", ["CSS", "Token"], "space", "0.8.8"],
  ["responsive-overflow-check", "frontend", "xinyi", "检测常见断点下的文本溢出、遮挡和不可点击区域。", ["响应式", "QA"], "space", "0.9.1"],
  ["react-query-plan", "frontend", "yuxuan", "把页面数据需求转成查询 key、缓存策略和错误态设计。", ["React", "数据"], "space", "0.5.4"],
  ["media-transcode-pipe", "media", "nanxi", "批量转码图片、音频与短视频，内置尺寸、码率和字幕处理模板。", ["媒体", "批处理"], "public", "1.0.8"],
  ["doc-convert-agent", "media", "mingxuan", "将 PDF、Markdown、HTML 转成结构化文档包，保留标题、表格和附件目录。", ["文档", "转换"], "space", "1.6.1"],
  ["image-alt-writer", "media", "moran", "为产品截图和文档图片生成可读性更好的 alt 文本与文件命名建议。", ["图片", "无障碍"], "space", "1.2.7"],
  ["video-caption-splitter", "media", "zimo", "拆分长视频字幕，生成章节标题、摘要和关键片段索引。", ["字幕", "视频"], "space", "0.9.1"],
  ["asset-hash-renamer", "media", "lin", "按内容哈希重命名素材并生成引用映射，避免缓存冲突。", ["素材", "缓存"], "space", "1.0.4"],
  ["code-review-lens", "quality", "wenhao", "快速读取 diff，生成结构化风险点、测试建议和修复优先级。", ["Review", "测试"], "space", "2.1.0"],
  ["lint-fix-planner", "quality", "xiaolu", "聚合 lint 报错，按目录和风险拆成可执行修复计划。", ["Lint", "计划"], "space", "0.8.3"],
  ["api-contract-checker", "quality", "ruoxi", "比对 OpenAPI 变更，标出破坏性字段、兼容性风险和迁移说明。", ["API", "契约"], "private", "0.7.5"],
  ["test-case-synth", "quality", "qing", "从 PRD 与接口文档生成边界用例、冒烟清单和回归集。", ["测试", "用例"], "space", "0.4.8"],
  ["schema-diff-scout", "quality", "xinyi", "扫描数据库 schema 变更，提示索引、字段兼容和回滚风险。", ["Schema", "数据库"], "private", "0.5.9"],
  ["privacy-field-masker", "quality", "fan", "识别日志和样例数据中的敏感字段，给出脱敏策略。", ["隐私", "脱敏"], "private", "0.6.1"],
  ["user-interview-summarizer", "research", "liuyi", "汇总访谈记录，提炼需求主题、证据片段和待验证假设。", ["访谈", "洞察"], "space", "1.0.1"],
  ["competitor-signal-scan", "research", "haowen", "整理竞品更新、公开评论和功能差异，输出观察摘要。", ["竞品", "研究"], "space", "0.8.2"],
  ["feedback-cluster-map", "research", "qiu", "把用户反馈聚类成主题地图，标注频次、情绪和样例。", ["反馈", "聚类"], "space", "0.9.0"],
  ["dataset-profile-mini", "analytics", "tianyi", "快速抽样数据集，生成字段画像、缺失值和异常分布。", ["数据", "画像"], "space", "0.8.0"],
  ["sql-insight-digest", "analytics", "jie", "把 SQL 查询结果转成业务洞察摘要和可追踪口径。", ["SQL", "洞察"], "space", "1.1.7"],
  ["funnel-dropoff-reader", "analytics", "mumu", "分析漏斗转化断点，生成分群对比和优化建议。", ["漏斗", "转化"], "space", "0.7.9"],
  ["blog-outline-forge", "content", "rong", "基于关键词和材料生成内容大纲、标题组和引用提示。", ["内容", "大纲"], "space", "0.6.4"],
  ["social-post-rewriter", "content", "anyi", "将长文拆成适配多个社媒渠道的短帖和标签。", ["社媒", "改写"], "public", "0.9.8"],
  ["case-study-polisher", "content", "nina", "整理客户案例素材，生成问题、方案、结果和证据结构。", ["案例", "客户"], "space", "0.7.3"],
  ["ios-release-note", "mobile", "yuan", "从移动端提交与需求单生成 App Store 发布说明。", ["iOS", "发布"], "space", "0.5.8"],
  ["android-crash-cluster", "mobile", "helen", "聚合 Android 崩溃日志，输出机型、版本和堆栈聚类。", ["Android", "Crash"], "space", "0.8.1"],
  ["rn-upgrade-checklist", "mobile", "kevin", "生成 React Native 版本升级步骤、风险点和回滚路径。", ["RN", "升级"], "private", "0.4.6"],
  ["cloud-cost-guard", "cloud", "zhangyu", "扫描云资源配置，输出闲置资源、预算异常和优化动作清单。", ["云服务", "成本"], "space", "0.9.6"],
  ["bucket-sync-watch", "cloud", "kaiming", "同步对象存储目录并产出校验日志，适合素材和数据包分发。", ["存储", "同步"], "space", "1.4.4"],
  ["deploy-rollout-plan", "cloud", "liang", "根据服务依赖和监控指标生成灰度发布计划与回滚检查表。", ["部署", "灰度"], "space", "1.0.0"],
  ["log-anomaly-reader", "cloud", "haoran", "聚合服务日志并识别异常窗口、关键链路和疑似根因。", ["日志", "排障"], "space", "0.6.2"],
  ["api-latency-brief", "cloud", "xiang", "分析接口耗时分布，生成慢请求样本和优化优先级。", ["API", "性能"], "space", "0.7.8"],
  ["terraform-drift-watch", "cloud", "shuo", "对比 IaC 配置和实际云资源，输出漂移项和修复建议。", ["IaC", "云资源"], "space", "0.7.4"],
  ["team-game-icebreaker", "social", "luo", "生成远程团队破冰问题、小游戏流程和主持提示。", ["团建", "互动"], "public", "0.3.5"],
  ["community-reply-helper", "social", "xiao", "根据社区帖子生成友好回复、追问和升级处理建议。", ["社区", "回复"], "space", "0.6.7"],
  ["prompt-pack-auditor", "other", "siyu", "检查 Prompt 包中的重复、过期依赖和缺失使用说明。", ["Prompt", "治理"], "space", "0.6.9"],
  ["legacy-data-normalizer", "other", "old-data", "清洗旧系统导出的混乱字段，生成映射表和迁移预览。", ["迁移", "清洗"], "private", "0.3.0"],
].map(([id, categoryId, ownerOrName, maybeName, description, tags, visibility, version]) => {
  if (Array.isArray(tags)) {
    const ownerId = ownerOrName === "me" ? CURRENT_USER_ID : String(ownerOrName);
    return {
      id: String(id),
      categoryId: String(categoryId),
      ownerId,
      ownerName: String(maybeName),
      description: String(description),
      tags,
      visibility: visibility as Visibility,
      version: String(version),
    };
  }
  return {
    id: String(id),
    categoryId: String(categoryId),
    ownerName: String(ownerOrName),
    description: String(maybeName),
    tags: description as string[],
    visibility: tags as Visibility,
    version: String(visibility),
  };
});

function buildReadme(seed: SkillSeed): string {
  return `# ${seed.id}

${seed.description}

## 使用场景

- 快速生成可执行的工作清单
- 对输入材料做结构化整理
- 产出可复核的建议和下一步动作

## 参数

| 参数 | 说明 |
| ---- | ---- |
| target | 目标路径或业务对象 |
| mode | preview / apply |

## 示例

\`\`\`bash
octo skill run ${seed.id} --target ./workspace --mode preview
\`\`\`
`;
}

export function createInitialSkills(): Skill[] {
  return skillSeeds.map((seed, index) => {
    const createdDay = String(1 + (index % 20)).padStart(2, "0");
    const updatedDay = String(10 + (index % 18)).padStart(2, "0");
    return {
      id: seed.id,
      name: seed.id,
      displayName: seed.description.slice(0, 20),
      description: seed.description,
      categoryId: seed.categoryId,
      tags: seed.tags,
      ownerId: seed.ownerId ?? seed.ownerName,
      ownerName: seed.ownerName,
      spaceId: CURRENT_SPACE_ID,
      visibility: seed.visibility,
      version: seed.version,
      readmeContent: buildReadme(seed),
      fileName: `${seed.id}.zip`,
      fileUrl: `mock://skills/${seed.id}.zip`,
      fileSize: 1024 * (96 + index * 17),
      iconUrl: "",
      createdAt: `2026-06-${createdDay}T08:00:00.000Z`,
      updatedAt: `2026-07-${updatedDay}T10:00:00.000Z`,
    };
  });
}
