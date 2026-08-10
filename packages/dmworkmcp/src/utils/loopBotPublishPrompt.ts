import { isValidMcpSpaceId } from "./mcpBotPublishPrompt";

/**
 * "Publish via Bot" prompt for the **Loop** subsystem (专家 = agent, 专家团 =
 * squad). Sibling of getExpertBotPublishPrompt, but Loop is a DIFFERENT surface
 * from the OCTO Marketplace:
 *
 *   - Binary: `octo-daemon` (not `octo-cli`), distributed via the corp codex
 *     GitLab installer (SHA-256 verified), not public npm.
 *   - Scope: a Loop **workspace** (`--workspace-id`), not a marketplace space.
 *   - Auth: an `octo_pat_…` personal access token via `octo-daemon login`.
 *   - Authoritative manual: the bundled `octo-loop` skill
 *     (`octo-daemon builtin-skills show octo-loop`), the Loop-side analogue of
 *     `octo-cli skills octo-marketplace`.
 *   - Create mechanics: flags, not a JSON doc. `agent create` needs a
 *     `--runtime-id`; a squad references EXISTING agents (a required `--leader`
 *     plus `squad member add`), not inline members.
 *
 * Like the marketplace prompts, this does NOT inline the full command surface —
 * it points the bot at the `octo-loop` skill as the source of truth and embeds
 * the real Server URL + Workspace ID for the auth step. The command facts here
 * track `octo-daemon <agent|squad|runtime|skill> --help` (v1.1.0).
 */
export interface LoopBotPublishPromptValues {
  /** Which catalog the prompt creates: a single expert or an expert squad. */
  kind: "agent" | "squad";
  workspaceId?: string;
  serverUrl?: string;
}

// Origin form we allow to reach a `--server-url ${serverUrl}` shell example:
// http(s) + host/port/dot/dash only. Blocks spaces and shell metacharacters.
const SAFE_ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.\-:]+$/;

/**
 * Normalize a Loop server URL to a shell-safe origin (e.g.
 * `https://im.deepminer.com.cn`). Returns "" when the input is empty, not an
 * http(s) URL, or carries anything outside the safe origin charset — the caller
 * then falls back to the `<server-url>` placeholder. Mirrors resolveMcpAPIBaseURL
 * in spirit (origin-only), but Loop's `--server-url` is a bare origin, so no
 * `/api` path handling.
 */
export function resolveLoopServerUrl(serverUrl?: string): string {
  const raw = (serverUrl || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (
      (u.protocol === "http:" || u.protocol === "https:") &&
      SAFE_ORIGIN_RE.test(u.origin)
    ) {
      return u.origin;
    }
  } catch {
    /* not a parseable URL — fall through to "" */
  }
  return "";
}

function sanitizeServerUrl(raw?: string): string {
  return resolveLoopServerUrl(raw) || "<server-url>";
}

// A workspace id is interpolated into `--workspace-id ${workspaceId}` and
// `workspace switch ${workspaceId}` shell examples, so it must be shell-safe.
// Reuse the marketplace space-id gate (letters/digits/[._-], bounded length):
// it covers UUIDs and readable slugs and rejects shell metacharacters. A
// poisoned value falls back to the `<workspace-id>` placeholder.
function sanitizeWorkspaceId(raw?: string): string {
  return isValidMcpSpaceId(raw) ? (raw as string).trim() : "<workspace-id>";
}

/** Build the prompt handed to a bot to create a Loop expert / squad. */
export function getLoopBotPublishPrompt(
  values: LoopBotPublishPromptValues
): string {
  const workspaceId = sanitizeWorkspaceId(values.workspaceId);
  const serverUrl = sanitizeServerUrl(values.serverUrl);
  const isSquad = values.kind === "squad";

  const entity = isSquad ? "专家团" : "专家";
  const cmd = isSquad ? "squad" : "agent";
  const idName = isSquad ? "<squad-id>" : "<agent-id>";
  const idField = isSquad ? "squad_id" : "agent_id";

  const ask = isSquad
    ? "请提供要创建的专家团信息（名称、简介、leader 是哪位专家、各成员对应的专家及其角色），以及这些成员专家是否已在工作区中存在；或提供 Agent 当前运行环境可访问的配置文件路径。"
    : "请提供要创建的专家信息（名称、角色说明 instructions、运行时 / 模型偏好，可选 mcp_config、自定义环境变量、skills），或提供 Agent 当前运行环境可访问的配置文件路径。";

  const payloadSteps = isSquad
    ? [
        "   - 专家团的成员是对**已有专家（agent）的引用**，不是内联定义。先确保各成员专家已在工作区存在（不存在就先按创建专家的流程建好），并选定其中一位作为 leader。",
        "   - 运行 `octo-daemon squad create --name <名称> --leader <leader 专家名称或ID> [--description <简介>] --output json`，记下返回的 squad id。",
        "   - 对每位其他成员运行 `octo-daemon squad member add <squad-id> --member-id <agent-id> [--role <角色>] [--type agent]`。",
      ]
    : [
        "   - 运行 `octo-daemon runtime list --output json`，选择一个运行时并记下其 id（`agent create` 的 `--runtime-id` 必填）。",
        "   - 运行 `octo-daemon agent create --name <名称> --runtime-id <runtime-id> [--instructions <system prompt>] [--description <简介>] [--model <模型>] [--visibility private|workspace] --output json`。含密钥的 mcp_config / 自定义环境变量一律用 `--mcp-config-stdin` / `--custom-env-stdin` 从 stdin 传入，不要内联到命令参数。",
        "   - 如需挂 skill：先 `octo-daemon skill list --output json` 查找，或用 `octo-daemon skill create --name <名称> --content-file <SKILL.md>` 新建，再 `octo-daemon agent skills set <agent-id> --skill-ids a,b` 挂到该专家。",
      ];

  return `使用 octo-daemon CLI，将指定${entity}创建到 Loop 工作区。

- Server URL：\`${serverUrl}\`
- Workspace ID：\`${workspaceId}\`

如果当前消息没有${entity}信息或配置路径，只回复：

> ${ask}

不要解释正在读取内容、复述本 Prompt 或逐步播报检查过程。用户提供前不要搜索磁盘或猜测路径。

1. 运行 \`octo-daemon version\`。如果未安装，运行
   \`curl -fsSL https://codex.mlamp.cn/0000109/octo-daemon-publish/-/raw/main/install.js | node\`
   （从公司 codex 分发，安装脚本自带 SHA-256 校验）。

2. 运行 \`octo-daemon auth status\` 确认已登录。如果未登录，从当前 Octo Channel 的
   安全环境或配置读取 \`octo_pat_\` 个人访问令牌，登录到指定 Server：

   \`\`\`bash
   octo-daemon login --token <octo_pat_...> --server-url ${serverUrl}
   \`\`\`

   若环境支持交互式输入，用不带值的 \`--token\` 让 CLI 提示读取，避免令牌进入 shell 历史；
   不得输出 Token 或把 Token 写入命令行以外可见的位置。登录后把工作区设为目标：

   \`\`\`bash
   octo-daemon workspace switch ${workspaceId}
   \`\`\`

3. 读取并遵循 octo-daemon 内置的 \`octo-loop\` Skill 作为权威操作手册，并用 \`--help\`
   查看创建参数（Loop 的 agent / squad 用 flag，不是 JSON 文档）：

   \`\`\`bash
   octo-daemon builtin-skills show octo-loop
   octo-daemon ${cmd} --help
   \`\`\`

4. 按手册完成${entity}创建：

${payloadSteps.join("\n")}
   - 向我展示创建预览，并在这里暂停，明确等待我回复“确认创建”；未收到这四个字，不得创建或修改工作区数据。命令支持时一律加 \`--output json\` 并解析 JSON。
   - 用返回的 ${idField} 运行 \`octo-daemon ${cmd} get ${idName} --output json\` 回读核验。创建失败时不要伪造成功，保留本地配置并返回可重试的命令和错误摘要。

以上 Server URL 和 Workspace ID 是本次操作的权威输入。`;
}
