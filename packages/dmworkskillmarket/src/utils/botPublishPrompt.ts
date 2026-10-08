import { isShellSafeSpaceId, sanitizeShellSpaceId } from "./spaceId";

export interface BotPublishPromptValues {
  mode?: "create" | "update";
  pluginId?: string;
  spaceId?: string;
  apiBaseUrl?: string;
}

export function getBotPublishPrompt(
  values: BotPublishPromptValues = {}
): string {
  // Sanitize the space id: it is interpolated into shell command lines, so a
  // poisoned value must render as the inert <space-id> placeholder.
  const spaceId = sanitizeShellSpaceId(values.spaceId);
  const apiBaseUrl = values.apiBaseUrl?.trim() || "<api-base-url>";
  const isUpdate = values.mode === "update";
  const pluginId = isShellSafeSpaceId(values.pluginId)
    ? (values.pluginId as string).trim()
    : "<plugin-id>";
  const intro = isUpdate
    ? "使用 octo-cli 内置的 Marketplace Skill，为 OCTO Marketplace 中已上架的 Skill 发布新版本。"
    : "使用 octo-cli 内置的 Marketplace Skill，将指定 Skill 上架到 OCTO Marketplace。";
  const idLine = isUpdate ? `\n- Plugin ID：\`${pluginId}\`` : "";
  const request = isUpdate
    ? "请上传包含新版本的 `.zip` / `.skill` 包，或提供 Agent 当前运行环境可访问的新 Skill 包或 Skill 目录位置，并说明本次变更。"
    : "请上传要上架的 `.zip` / `.skill` 包，或提供 Agent 当前运行环境可访问的 Skill 包或 Skill 目录位置。";
  const workflow = isUpdate
    ? `4. 按该 Skill 的 \`skills.md\` 中“Release a new version”流程升级 Plugin \`${pluginId}\`：

   - 先用 \`octo-cli marketplace plugin get --plugin-id ${pluginId} --profile <profile>\` 回读当前
     \`display_status\`、版本和内容；再检查待审核请求。已有待审核升级时不要重复提交，先向用户说明并按
     \`skills.md\` 检查、取消或继续该请求。
   - 向我展示升级目标、当前/新版本、变更说明和可见范围，并暂停等待我明确回复“确认升级”；未确认不得写入。
   - 检查新包但不要执行其中脚本；版本必须是向前递增的 \`MAJOR.MINOR.PATCH\`。上传、解析后，已上架的
     Space Skill 不得调用 \`plugin import\` / \`plugin upsert\` 覆盖线上内容；确认后把新的
     \`parse_task_id\`、版本和 changelog 通过 \`plugin review-request create\` 提交为冻结升级。
   - 提交后回读 Plugin 和审核请求。审核中时明确说明旧版本仍在线、通过后才替换；成功时报告新版本或 review ID。`
    : `4. 按该 Skill 的 \`skills.md\` 中“Publish as a Bot”流程，使用用户提供的附件、Skill 包路径或
   Skill 目录路径完成上架。以上 Space ID、API 地址和可见范围是本次操作的权威输入。`;

  return `${intro}

- Space ID：\`${spaceId}\`
- API 地址：\`${apiBaseUrl}\`
- 可见范围：\`space\`${idLine}

如果当前消息没有 Skill 包附件或路径，只回复：

> ${request}

不要解释正在读取 Skill、复述本 Prompt 或逐步播报检查过程。用户提供前不要搜索磁盘或猜测路径。

1. 运行 \`octo-cli version\`，读取输出中的 \`version\`，按 major/minor/patch 分段数字比较，
   确认当前版本 \`>= 0.15.0\`（例如 \`0.9.0 < 0.15.0\`）。
   如果未安装或版本低于 \`0.15.0\`，先询问用户是否更新/安装 \`octo-cli\`。
   用户确认后运行 \`npm install -g "@mininglamp-oss/octo-cli@>=0.15.0"\`，并重新运行
   \`octo-cli version\` 复核；仍不满足时停止，并给出可复制的安装命令
   \`npm install -g "@mininglamp-oss/octo-cli@>=0.15.0"\`。用户未确认时停止，
   并说明本流程需要 \`octo-cli >= 0.15.0\`。

2. 运行 \`octo-cli auth list\`，选择 \`space_id\` 等于 \`${spaceId}\` 的唯一 Profile。
   如果不存在或无法唯一确定，从当前 Octo Channel 的安全环境或配置读取 Bot Token，
   通过 stdin 登录或更新固定 Profile \`space-${spaceId}\`：

   \`\`\`bash
   <read-token> | octo-cli auth login --with-token --profile space-${spaceId} --space ${spaceId} --api-base-url ${apiBaseUrl}
   \`\`\`

   不得输出 Token 或把 Token 放入命令参数。

3. 使用选定的 Profile 运行以下命令，读取并遵循最新的 \`octo-marketplace\` Skill：

   \`\`\`bash
   octo-cli skills octo-marketplace --profile <profile>
   \`\`\`

${workflow}

失败处理：解析返回 \`RATE_LIMITED\` 时在用户允许的时间内等待并轮询，不要重复触发已成功的解析；写入返回
网关超时或 \`RESULT_UNKNOWN\` 时，先回读 Plugin、版本历史和审核请求判断是否已提交，再决定是否重试。
任何失败都不得伪造成功；保留本地包和 payload，返回脱敏错误摘要以及可复制的重试命令。`;
}
