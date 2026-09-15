import {
  isShellSafeSpaceId,
  sanitizeShellSpaceId,
} from "@octo/base/src/Utils/spaceId";

export interface McpBotPublishPromptValues {
  spaceId?: string;
  apiBaseUrl?: string;
}

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
     消费者需自行填入的密钥值必须写成规范化键名占位：先去掉首尾空白，把非字母数字字符替换为
     \`_\`，再转大写。例如 header \`Authorization\` 写 \`\${AUTHORIZATION}\`、\`X-Api-Secret\`
     写 \`\${X_API_SECRET}\`、\`GITHUB_TOKEN\` 写 \`\${GITHUB_TOKEN}\`，不要写泛化的
     \`\${VAR}\`，也不要提交真实密钥。即使 \`mcp.md\` 示例使用了与键名不一致的占位符
     （例如键 \`TOKEN\` 配 \`\${GITHUB_TOKEN}\`），也必须改为规范化键名占位 \`\${TOKEN}\`。
   - 向我展示发布预览，并在这里暂停，明确等待我回复“确认上架”；未收到这四个字，
     不得创建、发布或提交审核。可先用 \`--dry-run\` 打印将要发送的请求核对。
   - 确认后只使用 \`mcp.md\` 记录的统一 \`octo-cli marketplace plugin ...\` 命令完成保存、
     发布或提交审核；如需上传图标，取得预签名后不得输出 \`presigned_url\` / \`method\` / \`headers\`，
     也不得写入 payload 文件。最后用 \`octo-cli marketplace plugin get --plugin-id <plugin-id> --profile <profile>\`
     回读核验。不要使用旧的 MCP 专用 create / get / category 命令。

以上 Space ID、API 地址和可见范围是本次操作的权威输入。`;
}
