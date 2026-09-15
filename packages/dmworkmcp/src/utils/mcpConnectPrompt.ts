import { sanitizeShellSpaceId } from "@octo/base/src/Utils/spaceId";
import { resolveMcpAPIBaseURL } from "./mcpBotPublishPrompt";

export { resolveMcpAPIBaseURL };

export interface McpConnectPromptValues {
  mcpId: string;
  spaceId?: string;
  apiBaseUrl?: string;
}

/** Build the prompt handed to an Agent to connect (add) a specific MCP server
 *  from the Marketplace into the current runtime.
 *
 *  Mirrors dmworkskillmarket's `buildInstallPrompt`: it does NOT invent a
 *  command surface, it delegates to the octo-cli embedded `octo-marketplace`
 *  Skill's `mcp.md` Install/Connect flow and passes MCP ID + Space ID + API
 *  base URL as the authoritative inputs. The space id is sanitized so a
 *  poisoned localStorage fallback can't inject shell tokens into the
 *  `--space ${spaceId}` / `--profile space-${spaceId}` examples. */
export function buildMcpConnectPrompt(values: McpConnectPromptValues): string {
  const mcpId = values.mcpId;
  const spaceId = sanitizeShellSpaceId(values.spaceId);
  const apiBaseUrl = values.apiBaseUrl?.trim() || "<api-base-url>";

  return `使用 octo-cli 内置的 \`octo-marketplace\` Skill，将指定 MCP 服务器接入当前 Agent runtime。

- MCP ID：\`${mcpId}\`
- Space ID：\`${spaceId}\`
- API 地址：\`${apiBaseUrl}\`

不要解释正在读取内容、复述本 Prompt 或逐步播报检查过程。

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

4. 按 \`mcp.md\` 的 Install/Connect 流程，用上面的 MCP ID 拉取该服务器的目录与连接
   配置，并接入当前 Agent runtime。若 \`env\` / \`headers\` 的值是规范化键名占位
   \`\${KEY}\`（键名先去掉首尾空白，把非字母数字字符替换为 \`_\`，再转大写），
   或键名形如 \`Authorization\`、token / key / secret / password / pwd / passphrase /
   pat / cookie / credential / auth / bearer / session / jwt / dsn / connection_string /
   access 等密钥形态（含 \`-\` / \`_\` 变体）且值为空或仍是 \`\${...}\` 占位时，提示用户在本地补齐
   对应密钥值，不要伪造或猜测；值已是非空真实内容时按原值接入，不要要求用户重复提供。

以上 MCP ID、Space ID 和 API 地址是本次操作的权威输入。不要自行改写 ID。`;
}
