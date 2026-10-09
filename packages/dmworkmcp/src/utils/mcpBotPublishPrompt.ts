import {
  isShellSafeSpaceId,
  sanitizeShellSpaceId,
} from "@octo/base/src/Utils/spaceId";

export interface McpBotPublishPromptValues {
  mode?: "create" | "upgrade";
  pluginId?: string;
  spaceId?: string;
  apiBaseUrl?: string;
}

const SECRET_PLACEHOLDER_RULE = `消费者需自行填入的密钥值必须写成规范化键名占位：先去掉首尾空白，把非字母数字字符替换为
     \`_\`，再转大写。例如 header \`Authorization\` 写 \`\${AUTHORIZATION}\`、\`X-Api-Secret\`
     写 \`\${X_API_SECRET}\`、\`GITHUB_TOKEN\` 写 \`\${GITHUB_TOKEN}\`，不要写泛化的
     \`\${VAR}\`，也不要提交真实密钥。即使 \`mcp.md\` 示例使用了与键名不一致的占位符
     （例如键 \`TOKEN\` 配 \`\${GITHUB_TOKEN}\`），也必须改为规范化键名占位 \`\${TOKEN}\`。`;

// A space id is interpolated into shell command examples (`--space ${spaceId}`),
// so it must not carry shell metacharacters. Server-issued space ids are
// readable slugs — hex, UUIDv4, or names like `minglue_default` — i.e. letters,
// digits, and the separators [._-]. Accept that safe, length-bounded character
// set and reject anything else (spaces, `$`, `;`, backticks, quotes, …) so a
// poisoned localStorage fallback (see McpBotPublishModal.getCurrentSpaceId)
// can't inject shell tokens into `--space ${spaceId}`. The prompt then falls
// back to the `<space-id>` placeholder, forcing the operator to provide a real one.
/** Whether a caller-supplied space id is shell-safe: letters, digits, and the
 *  separators [._-] only (bounded length), never a bare `..` and never leading
 *  with `-`/`.` (which would parse as a flag or a traversal-shaped token when
 *  reaching `--space ${id}` / `--profile space-${id}`). Covers hex, UUIDv4, and
 *  readable slugs like `minglue_default`; rejects empty, spaces, and metachars. */
export function isValidMcpSpaceId(raw?: string): boolean {
  return isShellSafeSpaceId(raw);
}

/** Normalize the API base URL: trust the configured API URL when it's a full
 *  origin, otherwise fall back to the page origin. Mirrors dmworkskillmarket's
 *  resolveAPIBaseURL so Skill and MCP bot prompts point at the same backend. */
export function resolveMcpAPIBaseURL(apiURL: string, origin: string): string {
  const target = new URL(apiURL || origin, origin);
  return target.origin;
}

/** Build the prompt handed to a bot to publish an MCP server listing.
 *
 *  Keep the write command surface delegated to octo-cli's embedded
 *  `octo-marketplace` Skill (`skills/octo-marketplace/mcp.md`). The CLI moved
 *  marketplace writes to the unified plugin surface in 0.15.0, so this prompt
 *  only inlines command snippets that anchor safety-critical steps. */
export function getMcpBotPublishPrompt(
  values: McpBotPublishPromptValues = {}
): string {
  const spaceId = sanitizeShellSpaceId(values.spaceId);
  const apiBaseUrl = values.apiBaseUrl?.trim() || "<api-base-url>";
  const pluginId = isValidMcpSpaceId(values.pluginId)
    ? (values.pluginId as string).trim()
    : "<plugin-id>";

  if (values.mode === "upgrade") {
    return `使用 octo-cli 内置的 \`octo-marketplace\` Skill，为 OCTO Marketplace 中已上架的连接器发布新版本。

- Space ID：\`${spaceId}\`
- API 地址：\`${apiBaseUrl}\`
- 可见范围：\`space\`
- Plugin ID：\`${pluginId}\`

如果当前消息没有更新后的 MCP 配置信息或路径，只回复：

> 请提供要更新的 MCP 服务器信息或 Agent 当前运行环境可访问的 MCP 配置文件路径，并说明本次变更。

不要解释正在读取内容、复述本 Prompt 或逐步播报检查过程。用户提供前不要搜索磁盘或猜测路径。

1. 运行 \`octo-cli version\`，读取输出中的 \`version\`，按 major/minor/patch 分段数字比较，
   确认当前版本 \`>= 0.15.0\`。如果未安装或版本过低，先询问用户是否安装/更新；用户确认后运行
   \`npm install -g "@mininglamp-oss/octo-cli@>=0.15.0"\` 并复核。仍不满足或用户未确认时停止，
   给出可复制的安装命令。

2. 运行 \`octo-cli auth list\`，选择 \`space_id\` 等于 \`${spaceId}\` 的唯一 Profile。不存在或无法唯一确定时，
   从当前 Octo Channel 的安全环境读取 Bot Token，通过 stdin 登录固定 Profile：

   \`\`\`bash
   <read-token> | octo-cli auth login --with-token --profile space-${spaceId} --space ${spaceId} --api-base-url ${apiBaseUrl}
   \`\`\`

   不得输出 Token 或把 Token 放入命令参数。

3. 使用选定 Profile 运行 \`octo-cli skills octo-marketplace --profile <profile>\`，读取并遵循最新
   \`mcp.md\` 及共享审核、重试规则。

4. 按 \`mcp.md\` 的升级流程处理 Plugin \`${pluginId}\`：

   - 先用 \`octo-cli marketplace plugin get --plugin-id ${pluginId} --profile <profile>\` 回读当前记录，
     保留未修改的完整 manifest/package 字段，并检查是否已有待审核升级；有待审请求时不要重复提交。
   - 校验修改后的连接配置。\`streamable-http\` / \`sse\` 用 \`marketplace mcp probe\` 确认
     \`is_ok=true\`；\`stdio\` 不在服务端执行 probe。${SECRET_PLACEHOLDER_RULE}
   - 准备向前递增的 \`MAJOR.MINOR.PATCH\` 版本、changelog、完整 \`manifest_json\` 和
     \`plugin_json\`。向我展示升级目标、当前/新版本、变更和可见范围，并暂停等待我明确回复“确认升级”；
     未确认不得写入。
   - 已上架到 Space 的连接器不得通过 \`plugin upsert\` 覆盖线上内容；确认后按 \`mcp.md\` 用
     \`plugin review-request create\` 提交冻结内容。完成后回读 Plugin 和审核请求；审核中时说明旧版本仍在线，
     审核通过后才会替换。如需上传图标，取得预签名后不得输出 \`presigned_url\` / \`method\` / \`headers\`，
     也不得写入 payload 文件。

失败处理：探测或校验失败时停止并指出具体字段；遇到 409 时先检查待审核请求，不要重复创建；网关超时或
\`RESULT_UNKNOWN\` 时先回读 Plugin、版本和审核请求判断是否已提交，再决定是否重试。任何失败都不得伪造成功；
保留本地 payload，返回脱敏错误摘要和可复制的重试命令。

以上 Space ID、API 地址和可见范围是本次操作的权威输入。`;
  }

  return `使用 octo-cli 内置的 \`octo-marketplace\` Skill，将指定 MCP 服务器上架到 OCTO Marketplace。

- Space ID：\`${spaceId}\`
- API 地址：\`${apiBaseUrl}\`
- 可见范围：\`space\`

如果当前消息没有 MCP 配置信息或路径，只回复：

> 请提供要上架的 MCP 服务器信息（名称、传输方式 stdio/streamable-http/sse、URL 或启动命令、可选 headers / env），
> 或提供一个 Agent 当前运行环境可访问的 MCP 配置文件路径。

不要解释正在读取内容、复述本 Prompt 或逐步播报检查过程。用户提供前不要搜索磁盘或猜测路径。

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

3. 读取并遵循最新的 \`octo-marketplace\` Skill 中的 \`mcp.md\`：

   \`\`\`bash
   octo-cli skills octo-marketplace --profile <profile>
   \`\`\`

4. 按 \`mcp.md\` 的 Create / Publish 流程完成上架：

   - 使用 \`octo-cli marketplace plugin-category list --scene-code default --plugin-type connector --profile <profile>\`
     获取合法 \`category_id\`。
   - \`streamable-http\` / \`sse\` 传输：先把 \`transport\` / \`url\` / 可选 \`headers\` / \`env\`
     写入 \`connection.json\`，按 \`mcp.md\` 运行
     \`octo-cli marketplace mcp probe --data @connection.json --profile <profile>\`，
     确认 \`is_ok=true\` 再继续。\`stdio\` 传输不要调用 probe。
   - 按 \`mcp.md\` 编写 \`plugin.json\`，使用 \`plugin_type: "connector"\`，
     准备完整的 \`manifest_json\` 和 \`plugin_json\`（包含根目录 \`mcp.json\`）。
     ${SECRET_PLACEHOLDER_RULE}
   - 向我展示发布预览，并在这里暂停，明确等待我回复“确认上架”；未收到这四个字，
     不得创建、发布或提交审核。可先用 \`--dry-run\` 打印将要发送的请求核对。
   - 确认后只使用 \`mcp.md\` 记录的统一 \`octo-cli marketplace plugin ...\` 命令完成保存、
     发布或提交审核；如需上传图标，取得预签名后不得输出 \`presigned_url\` / \`method\` / \`headers\`，
     也不得写入 payload 文件。最后用 \`octo-cli marketplace plugin get --plugin-id <plugin-id> --profile <profile>\`
     回读核验。不要使用旧的 MCP 专用 create / get / category 命令。

以上 Space ID、API 地址和可见范围是本次操作的权威输入。`;
}
