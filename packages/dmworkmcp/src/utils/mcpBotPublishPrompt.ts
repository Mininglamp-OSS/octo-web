export interface McpBotPublishPromptValues {
  spaceId?: string;
  apiBaseUrl?: string;
}

// Server-issued space IDs are hex — either the 32-char compact form
// (`9f5fda183d94482cb49bca5024439105`) or the canonical 36-char UUIDv4
// (`9f5fda18-3d94-482c-b49b-ca5024439105`). Reject anything else before
// embedding into a shell command example so a poisoned localStorage
// fallback value (see McpBotPublishModal.getCurrentSpaceId) can't inject
// shell tokens like `$(whoami)` / `;` / backticks into `--space ${spaceId}`.
// The prompt then falls back to the `<space-id>` placeholder, forcing the
// operator to notice and provide a real one.
const SPACE_ID_RE = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Whether a caller-supplied space id has a server-issued hex shape
 *  (compact 32-char or canonical 36-char UUIDv4). */
export function isValidMcpSpaceId(raw?: string): boolean {
  return typeof raw === "string" && SPACE_ID_RE.test(raw.trim());
}

function sanitizeSpaceId(raw?: string): string {
  return isValidMcpSpaceId(raw) ? (raw as string).trim() : "<space-id>";
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
 *  Command surface is verified against octo-cli's embedded `octo-marketplace`
 *  Skill (`skills/octo-marketplace/mcp.md`). Unlike Skill publishing there is
 *  no dedicated bot endpoint — the bot uses the same `marketplace mcp create`
 *  command as any owner, so this prompt directs it to that Skill's Create
 *  workflow instead of a "Publish as a Bot" section that doesn't exist for
 *  MCP. */
export function getMcpBotPublishPrompt(values: McpBotPublishPromptValues = {}): string {
  const spaceId = sanitizeSpaceId(values.spaceId);
  const apiBaseUrl = values.apiBaseUrl?.trim() || "<api-base-url>";

  return `使用 octo-cli 内置的 \`octo-marketplace\` Skill，将指定 MCP 服务器上架到 OCTO Marketplace。

- Space ID：\`${spaceId}\`
- API 地址：\`${apiBaseUrl}\`
- 可见范围：\`space\`

如果当前消息没有 MCP 配置信息或路径，只回复：

> 请提供要上架的 MCP 服务器信息（名称、传输方式 stdio/streamable-http/sse、URL 或启动命令、可选 headers / env），
> 或提供一个 Agent 当前运行环境可访问的 MCP 配置文件路径。

不要解释正在读取内容、复述本 Prompt 或逐步播报检查过程。用户提供前不要搜索磁盘或猜测路径。

1. 运行 \`octo-cli version\`。如果未安装，运行
   \`npm install -g @mininglamp-oss/octo-cli@latest\`。

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

4. 按 \`mcp.md\` 的 Create 流程完成上架：

   - 运行 \`octo-cli marketplace mcp-category list --mode all --profile <profile>\`
     拿到合法的 \`category\` key（不要用 \`all\` 或空串作分类）。
   - \`streamable-http\` / \`sse\` 传输：先把 \`transport\` / \`url\` / 可选 \`headers\` / \`env\`
     写入 \`connection.json\`，运行
     \`octo-cli marketplace mcp probe --data @connection.json --profile <profile>\`，
     确认 \`is_ok=true\` 再继续。\`stdio\` 传输不要调用 probe。
   - 编写 \`mcp.json\`：目录字段（\`name\` / \`slogan\` / \`category\` / \`tags\` / \`icon\` 等）
     + \`transport\` + 对应连接字段。消费者需自行填入的密钥放进
     \`env_user_supplied\` / \`headers_user_supplied\`，对应值提交空字符串。
   - 运行 \`octo-cli marketplace mcp create --data @mcp.json --profile <profile>\` 完成上架，
     用返回的 \`mcp_id\` 通过 \`marketplace mcp get <mcp-id>\` 复核。

以上 Space ID、API 地址和可见范围是本次操作的权威输入。`;
}
