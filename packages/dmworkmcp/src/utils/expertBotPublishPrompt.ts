import { isValidMcpSpaceId, resolveMcpAPIBaseURL } from "./mcpBotPublishPrompt";

/**
 * "Publish via Bot" prompt for the Expert Marketplace (专家 / 专家团). Mirrors
 * the MCP bot-publish prompt (getMcpBotPublishPrompt): it does NOT inline the
 * full command surface, but points the bot at octo-cli's embedded
 * `octo-marketplace` Skill (`expert.md`) as the authoritative source, then
 * embeds the real Space ID + API base URL for the auth/login step. Command and
 * body facts here track `skills/octo-marketplace/expert.md` (category is a
 * NAME on write, members are inline, skills are whole packages, no versioning,
 * `created_by_type` is inferred from the bot identity — never sent).
 */
export interface ExpertBotPublishPromptValues {
  /** Which catalog the prompt publishes: a single expert or an expert squad. */
  kind: "agent" | "squad";
  /** "create" (default) uploads a new listing; "update" edits an existing one
   *  by id (the 我的-tab 编辑 flow). */
  mode?: "create" | "update";
  /** The existing listing's id — required for mode="update". */
  id?: string;
  spaceId?: string;
  apiBaseUrl?: string;
}

// Re-export so the modal can resolve the API base URL from one import.
export { resolveMcpAPIBaseURL };

// Reuse the MCP space-id gate (letters/digits/[._-], shell-metacharacter-free):
// a space id is interpolated into `--space ${spaceId}` shell examples, so a
// poisoned value must fall back to the `<space-id>` placeholder rather than
// reach a shell command. See mcpBotPublishPrompt.ts for the rationale.
function sanitizeSpaceId(raw?: string): string {
  return isValidMcpSpaceId(raw) ? (raw as string).trim() : "<space-id>";
}

/** Build the prompt handed to a bot to publish (create) or update an expert /
 *  squad listing. */
export function getExpertBotPublishPrompt(
  values: ExpertBotPublishPromptValues
): string {
  const spaceId = sanitizeSpaceId(values.spaceId);
  const apiBaseUrl = values.apiBaseUrl?.trim() || "<api-base-url>";
  const isSquad = values.kind === "squad";
  const isUpdate = values.mode === "update";

  const entity = isSquad ? "专家团" : "专家";
  const kindFlag = isSquad ? "squad" : "agent";
  const cmd = isSquad ? "squad" : "expert";
  const jsonFile = isSquad ? "squad.json" : "expert.json";
  const idName = isSquad ? "<squad-id>" : "<expert-id>";
  const idField = isSquad ? "squad_id" : "expert_id";
  // The id is interpolated into `${cmd} update ${id}` / `${cmd} get ${id}`
  // shell examples — gate it with the same whitelist as the space id so a
  // poisoned value falls back to the placeholder instead of reaching a shell.
  const targetId = isUpdate
    ? isValidMcpSpaceId(values.id)
      ? (values.id as string).trim()
      : idName
    : "";

  const ask = isSquad
    ? "请提供要上架的专家团信息（名称、简介、分类、各成员及其角色 / 是否 Leader、调度规则 strategies、依赖 dependencies、权限 permission），或提供 Agent 当前运行环境可访问的 squad.json / squad.yaml 路径。"
    : "请提供要上架的专家信息（名称、简介、分类、角色说明 instruction，可选 mcp_config、skills 包），或提供 Agent 当前运行环境可访问的 expert.json / expert.yaml 路径。";
  const askUpdate = isSquad
    ? "请提供要更新的专家团字段（名称、简介、分类、成员 / 角色 / Leader、调度规则、依赖、权限中的任意项；成员为整组替换），或提供 Agent 当前运行环境可访问的 squad.json / squad.yaml 路径。"
    : "请提供要更新的专家字段（名称、简介、分类、instruction、mcp_config、skills 包中的任意项），或提供 Agent 当前运行环境可访问的 expert.json / expert.yaml 路径。";

  const payloadSteps = isSquad
    ? [
        "   - 编写 `squad.json`：name / summary / category（分类**名称**）/ tags / leader / strategies / dependencies / permission，以及 members（至少 1 位，每位内联为 {member_key, name, role, is_leader, instruction, mcp_config, skills}，且恰好一位 is_leader=true）。更新已有专家团时 members 为整组替换，务必提交完整成员列表。",
        "   - 成员的 skills 同样是整包 .zip/.skill，上传流程见 `expert.md`。",
      ]
    : [
        "   - 编写 `expert.json`：name / summary 必填，category（分类**名称**）/ tags / instruction（system prompt），可选 mcp_config（mcpServers 的 JSON 字符串，用 __OCTO_SECRET_PLACEHOLDER__ 占位密钥）。",
        "   - 如需附带 skills 包：先运行 `octo-cli marketplace expert-skill-upload create --file-name <名称.zip> --file-size <字节> --profile <profile>` 取得预签名，按返回的 method / headers 把原始包 PUT 到 presigned_url（不要打印 URL / headers），再在 skills[] 里用 {name, upload_object_key, file_name, file_size} 引用；只有名称时写 {name}。",
      ];

  const intro = isUpdate
    ? `使用 octo-cli 内置的 \`octo-marketplace\` Skill，更新 OCTO Marketplace 上已上架的${entity}。`
    : `使用 octo-cli 内置的 \`octo-marketplace\` Skill，将指定${entity}上架到 OCTO Marketplace。`;

  const idLine = isUpdate ? `\n- ${entity} ID：\`${targetId}\`` : "";

  const step4Title = isUpdate
    ? `4. 按 \`expert.md\` 的 Update 流程完成更新（只改传入字段，未提供的保持不变）：`
    : `4. 按 \`expert.md\` 的 Create 流程完成上架：`;

  const submitStep = isUpdate
    ? `   - 向我展示改动预览，并在这里暂停，明确等待我回复“确认更新”；未收到这四个字，不得修改市场数据。可先用 \`--dry-run\` 打印将要发送的请求核对。
   - 确认后运行 \`octo-cli marketplace ${cmd} update ${targetId} --data @${jsonFile} --profile <profile>\`。用 Bot Profile 执行。`
    : `   - 向我展示发布预览，并在这里暂停，明确等待我回复“确认上架”；未收到这四个字，不得创建或修改市场数据。可先用 \`--dry-run\` 打印将要发送的请求核对。
   - 确认后运行 \`octo-cli marketplace ${cmd} create --data @${jsonFile} --profile <profile>\`。用 Bot Profile 执行，后端会据调用身份记为 bot 上架，不需要也不要传 created_by_type。`;

  const readBackId = isUpdate ? targetId : idName;
  const readBack = isUpdate
    ? `   - 运行 \`octo-cli marketplace ${cmd} get ${readBackId} --profile <profile>\` 回读核验改动。更新失败时不要伪造成功，保留本地 ${jsonFile} 并返回可重试的命令和错误摘要。`
    : `   - 用返回的 ${idField} 运行 \`octo-cli marketplace ${cmd} get ${readBackId} --profile <profile>\` 回读核验。创建失败时不要伪造成功，保留本地 ${jsonFile} 并返回可重试的命令和错误摘要。`;

  return `${intro}

- Space ID：\`${spaceId}\`
- API 地址：\`${apiBaseUrl}\`${idLine}

如果当前消息没有${entity}信息或配置路径，只回复：

> ${isUpdate ? askUpdate : ask}

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

3. 使用选定的 Profile 读取并遵循最新的 \`octo-marketplace\` Skill 中的 \`expert.md\`（squad 与 expert 同一套命令）：

   \`\`\`bash
   octo-cli skills octo-marketplace --profile <profile>
   \`\`\`

${step4Title}

   - 运行 \`octo-cli marketplace expert-category list --kind ${kindFlag} --profile <profile>\` 获取合法分类；body 里的 \`category\` 填分类**名称**，不是 id。专家市场没有版本概念，不要填写 version。
${payloadSteps.join("\n")}
${submitStep}
${readBack}

以上 Space ID 和 API 地址是本次操作的权威输入。`;
}
