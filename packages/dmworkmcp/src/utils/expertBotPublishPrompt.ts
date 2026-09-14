import { isValidMcpSpaceId, resolveMcpAPIBaseURL } from "./mcpBotPublishPrompt";

/**
 * "Publish via Bot" prompt for the Expert Marketplace (专家 / 专家团). Mirrors
 * the MCP bot-publish prompt (getMcpBotPublishPrompt): it does NOT inline the
 * full command surface, but points the bot at octo-cli's embedded
 * `octo-marketplace` Skill (`expert.md`) as the authoritative source, then
 * embeds the real Space ID + API base URL for the auth/login step. The CLI
 * moved expert and squad writes to the unified plugin surface in 0.15.0, so the
 * prompt intentionally avoids duplicating the full command contract.
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
  const idName = isSquad ? "<squad-id>" : "<expert-id>";
  const pluginType = isSquad ? "expert_team" : "expert";
  const pluginJsonFile = isSquad ? "team-plugin.json" : "expert-plugin.json";
  // The id is interpolated into prompt text that may become a `plugin_id`.
  // Gate it with the same whitelist as the space id so a poisoned value falls
  // back to the placeholder instead of reaching a shell command in follow-up
  // steps authored by the receiving agent.
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

  const intro = isUpdate
    ? `使用 octo-cli 内置的 \`octo-marketplace\` Skill，更新 OCTO Marketplace 上已上架的${entity}。`
    : `使用 octo-cli 内置的 \`octo-marketplace\` Skill，将指定${entity}上架到 OCTO Marketplace。`;

  const idLine = isUpdate ? `\n- ${entity} ID：\`${targetId}\`` : "";

  const step4Title = isUpdate
    ? `4. 按 \`expert.md\` 的 Update / Review Request 流程完成更新：`
    : `4. 按 \`expert.md\` 的 Create / Publish 流程完成上架：`;

  const confirmation = isUpdate ? "确认更新" : "确认上架";
  const actionWord = isUpdate ? "更新" : "发布";

  return `${intro}

- Space ID：\`${spaceId}\`
- API 地址：\`${apiBaseUrl}\`${idLine}

如果当前消息没有${entity}信息或配置路径，只回复：

> ${isUpdate ? askUpdate : ask}

不要解释正在读取内容、复述本 Prompt 或逐步播报检查过程。用户提供前不要搜索磁盘或猜测路径。

1. 运行 \`octo-cli version\`，读取输出中的 \`version\`，按 major/minor/patch 分段数字比较，
   确认当前版本 \`>= 0.15.0\`（例如 \`0.9.0 < 0.15.0\`）。
   如果未安装或版本低于 \`0.15.0\`，先询问用户是否更新/安装 \`octo-cli\`。
   用户确认后运行 \`npm install -g @mininglamp-oss/octo-cli@latest\`，并重新运行
   \`octo-cli version\` 复核；仍不满足时停止。用户未确认时停止，
   并说明本流程需要 \`octo-cli >= 0.15.0\`。

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

   - 使用 \`octo-cli marketplace plugin-category list --scene-code default --plugin-type ${pluginType} --profile <profile>\`
     获取合法 \`category_id\`；body 里填 \`category_id\`，不是分类名称。
   - 按 \`expert.md\` 编写 \`${pluginJsonFile}\`，使用 \`plugin_type: "${pluginType}"\`，
     提交完整的 \`manifest_json\`、\`plugin_json\` 和完整 \`relations\`。如需附带技能包，
     按 \`expert.md\` / \`skills.md\` 的统一 skill upload / parse / import 流程处理。
     密钥类 env / headers 值请用 \`\${KEY}\` 占位，切勿写入真实凭证。
   - ${isUpdate ? `如果目标是已发布的 Space ${entity}，按 \`expert.md\` 使用 \`plugin review-request create --data @submission.json\` 提交冻结后的更新；如果只是未发布草稿，按 \`expert.md\` 使用 \`plugin upsert\` 并设置 \`plugin.plugin_id = "${targetId}"\`。` : `按 \`expert.md\` 使用 \`plugin upsert --data @${pluginJsonFile}\` 保存草稿，再按 \`plugin publish --plugin-id <plugin-id> --version <x.y.z>\` 或 \`plugin review-request create --data @submission.json\` 的发布 / 审核流程继续。`}
   - 向我展示${actionWord}预览，并在这里暂停，明确等待我回复“${confirmation}”；未收到这四个字，
     不得创建、更新、发布或提交审核。可先用 \`--dry-run\` 打印将要发送的请求核对。
   - 确认后只使用 \`expert.md\` 记录的统一 \`octo-cli marketplace plugin ...\` 命令完成${actionWord}，
     并用 \`octo-cli marketplace plugin get --plugin-id ${isUpdate ? targetId : "<plugin-id>"} --include-relations --profile <profile>\`
     回读核验。不要使用旧的专家 / 专家团专用 create / update / get、分类或技能上传命令。

以上 Space ID 和 API 地址是本次操作的权威输入。`;
}
