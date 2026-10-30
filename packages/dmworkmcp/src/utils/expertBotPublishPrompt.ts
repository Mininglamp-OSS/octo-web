import { isValidMcpSpaceId, resolveMcpAPIBaseURL } from "./mcpBotPublishPrompt";

/**
 * "Publish via Bot" prompt for the Expert Marketplace (专家 / 专家团). Mirrors
 * the MCP bot-publish prompt (getMcpBotPublishPrompt): it does NOT inline the
 * full command surface, but points the bot at octo-cli's embedded
 * `octo-marketplace` Skill (`expert.md`) as the authoritative source, then
 * embeds the real Space ID + API base URL for the auth/login step. The CLI
 * moved expert and squad writes to the unified plugin surface in 0.15.0, so the
 * prompt only inlines command snippets that anchor safety-critical steps.
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
    ? "请提供要上架的专家团信息（名称、简介、分类、各成员及其已发布版本、角色 / 是否 Leader、调度规则 strategies、依赖 dependencies、权限 permission），或提供 Agent 当前运行环境可访问的 squad.json / squad.yaml 路径。"
    : "请提供要上架的专家信息（名称、简介、分类、角色说明 instruction，以及依赖的已发布技能 / 连接器 ID 和版本），或提供 Agent 当前运行环境可访问的 expert.json / expert.yaml 路径。";
  const askUpdate = isSquad
    ? "请提供要更新的专家团字段（名称、简介、分类、成员 / 已发布版本 / 角色 / Leader、调度规则、依赖、权限中的任意项；只覆盖本次明确要求修改的内容），并提供本次新版本号和更新说明；也可提供 Agent 当前运行环境可访问的 squad.json / squad.yaml 路径。"
    : "请提供要更新的专家字段（名称、简介、分类、instruction、依赖的技能 / 连接器 ID 和已发布版本中的任意项；只覆盖本次明确要求修改的内容），并提供本次新版本号和更新说明；也可提供 Agent 当前运行环境可访问的 expert.json / expert.yaml 路径。";

  const intro = isUpdate
    ? `使用 octo-cli 内置的 \`octo-marketplace\` Skill，编辑 OCTO Marketplace 上${entity}的草稿，并在保存后立即提交发布，遵循组织的自动或人工审核策略。`
    : `使用 octo-cli 内置的 \`octo-marketplace\` Skill，将指定${entity}上架到 OCTO Marketplace。`;

  const idLine = isUpdate ? `\n- ${entity} ID：\`${targetId}\`` : "";

  const step4Title = isUpdate
    ? `4. 按以下草稿编辑约束及 \`expert.md\` 的写入结构完成修改并提交发布：`
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

3. 使用选定的 Profile 读取并遵循最新的 \`octo-marketplace\` Skill 中的 \`expert.md\`（squad 与 expert 同一套命令）：

   \`\`\`bash
   octo-cli skills octo-marketplace --profile <profile>
   \`\`\`

${step4Title}

   - 创建前先查重（更新模式跳过当前 \`plugin_id\`）：运行
     \`octo-cli marketplace plugin list --scene-code default --plugin-type ${pluginType} --q "<名称>" --profile <profile> --format json\`，
     对返回的 \`plugin_name\` 做大小写无关的精确比较。若已有同名${entity}，停止并请我改名；
     不得自动覆盖或另建同名资源。
   - 使用 \`octo-cli marketplace plugin-category list --scene-code default --plugin-type ${pluginType} --profile <profile>\`
     获取合法 \`category_id\`；body 里填 \`category_id\`，不是分类名称。
   - ${
     isUpdate
       ? `使用同一 Bot 身份读取 \`GET /market/api/v1/plugins/${targetId}/draft\`，把返回的完整 plugin、relations 和 draft_revision 作为 \`${pluginJsonFile}\` 的基线。先检查当前 CLI 的帮助及内置 Skill 是否支持该草稿接口；若不支持，可使用当前 Channel 安全环境中的 Bot 凭证请求该 HTTP 接口，凭证不得输出或放入命令参数。无法安全读取时停止并说明缺少草稿读取能力。不得使用市场详情或 \`plugin get\` 的已发布内容代替草稿。`
       : `按 \`expert.md\` 编写 \`${pluginJsonFile}\`。`
   }
     使用 \`plugin_type: "${pluginType}"\`，准备完整的 \`manifest_json\`、\`plugin_json\` 和完整 \`relations\`。
     引用模式开启时，关系必须带 \`target_version_id\`：\`expert_skill\` / \`expert_team_expert\` 只能是已发布的 target_version_id，
     \`expert_connector\` 禁止带版本。服务端返回 \`released_version_required\` 时停止，向我确认目标版本，
     不要自动改用当前最新版本。
     ${
       isUpdate
         ? `更新 payload 必须按全量替换语义准备：body 缺失字段会写成零值，\`relations\` 缺失关系会被软删。未修改的 \`plugin_name\` / \`publisher\` / \`icon\` / \`tags\` / \`visibility\` / \`category_id\` 必须原样回填；每条未删除的 relation 也必须原样保留 \`relation_id\` 和 \`data\`，只覆盖用户本次明确要求修改的字段或关系。回填图标时使用写入字段 \`icon\` 本身，不要把展示用的 \`icon_url\` 写回；写入明确确认的新 \`version\`，必须是合法 MAJOR.MINOR.PATCH、不低于当前草稿版本，且不得复用已发布版本号。先确认新版本号和更新说明，不能只保存后让用户另行发布。`
         : ""
     }
     如需附带或更新技能包，此时只确认包内容和目标，不执行技能包写入流程；${actionWord}预览必须写明
     将要新建或覆盖的每个 skill plugin。
     密钥类 env / headers 值不要写真实凭证；消费者需填写时，占位符必须使用规范化键名：
     先去掉首尾空白，把非字母数字字符替换为 \`_\`，再转大写。例如 header \`Authorization\`
     写 \`\${AUTHORIZATION}\`、\`X-Api-Secret\` 写 \`\${X_API_SECRET}\`、\`GITHUB_TOKEN\`
     写 \`\${GITHUB_TOKEN}\`，不要写泛化的 \`\${VAR}\`。即使 \`mcp.md\` 示例使用了与键名不一致的
     占位符（例如键 \`TOKEN\` 配 \`\${GITHUB_TOKEN}\`），也必须改为规范化键名占位 \`\${TOKEN}\`。
   - 向我展示${actionWord}预览${isUpdate ? "（包括新版本号、更新说明，以及保存后立即提交发布的动作）" : ""}，并在这里暂停，明确等待我回复“${confirmation}”；未收到这四个字，
     不得创建、更新、发布或提交审核。可先用 \`--dry-run\` 打印将要发送的请求核对。
   - 在收到“${confirmation}”后，${isUpdate ? "优先使用统一 CLI 命令，条件保存的兼容 HTTP 回退仅按下述规则执行" : "只使用 `expert.md` 记录的统一 `octo-cli marketplace plugin ...` 命令"}完成${actionWord}：
     如需附带或更新技能包，此时再按 \`expert.md\` / \`skills.md\` 的统一 skill upload / parse /
     \`plugin import\` 流程处理；取得预签名后不得输出 \`presigned_url\` / \`method\` / \`headers\`，
     也不得写入 payload 文件。
     ${
       isUpdate
         ? `准备 \`plugin upsert --data @${pluginJsonFile}\` 的条件保存请求，设置 \`plugin.plugin_id = "${targetId}"\` 和顶层 \`expected_draft_revision\`（原样使用读取的 draft_revision），提交完整回填后的 payload。先对这份完整 payload 执行 CLI 的 \`--dry-run\`；最低版本检查不代表支持条件保存字段；校验通过后才使用该命令保存。若本地 schema 明确拒绝 \`expected_draft_revision\`（例如 octo-cli v0.19.5），不得删除或忽略该字段：改用同一 API 地址的 \`POST /market/api/v1/plugins/upsert\`，发送同一完整 JSON body（包括原始 expected_draft_revision、plugin 和 relations），通过安全 HTTP 客户端在内存中注入同一 Bot 的 \`Authorization: Bearer\`、\`X-Space-Id\` 和 \`Content-Type: application/json\` 请求头。凭证只从当前 Channel 的安全环境或既有 Bot Profile 在进程内读取，不得输出、写入 payload、放入命令参数或启用请求调试日志；无法安全认证则停止。只有明确的本地 schema 不支持才切换保存方式；已发出的保存若超时或结果不明，先安全回读草稿核对，不得盲目跨接口重发。HTTP 回退同样保留修订校验，409 时停止，不得无条件覆盖。保持原 visibility；未修改的关系必须保留 relation_id、target_version_id、sort_order 和 data，不得把固定版本自动换成最新版本。遇到失效依赖，先请我决定移除还是替换及目标版本，不得擅自删除。任何 409 都停止并返回错误摘要；草稿冲突需重新读取并核对修改，version_migration_required 需先完成正式版本基线迁移，不能取消审核、下架或绕过校验。保存成功后回读草稿，确认正文、关系及版本与本次保存一致；若发现其他并发修改则停止。随后立即按 \`expert.md\` 调用 \`plugin publish\`，传入当前 plugin_id、已确认的新版本号和更新说明，完成本次提交发布，不再等待用户另点按钮。只调用一次发布入口，不同时重复提交审核；不得绕过或修改组织审核策略，不得自动审批、取消已有审核或下架。发布失败时明确报告“草稿已保存，但发布失败”，保留 payload 并给出原因及可重试命令；不得伪造已上架。保存成功后的重试只处理发布，不重复保存或创建资源。若超时或返回 review_pending，先回读当前发布状态及对应审核请求，核对是否已经成功或正在审核，不得盲目重复提交。`
         : `使用 \`plugin upsert --data @${pluginJsonFile}\` 保存草稿，再按 \`expert.md\` 的 \`plugin publish\` 或 \`plugin review-request create\` 发布 / 审核流程继续；只有在 \`expert.md\` 要求且版本来源明确时才传 \`--version\`。审核 payload 的文件名与结构以 \`expert.md\` 为准。`
     }
     ${isUpdate
       ? `发布调用后回读 \`plugin get\` 的正式版本与审核状态（有 review_id 时按 \`expert.md\` 查询审核请求），核对本次版本号。只有确认本次版本已发布才报告“新版本已发布并生效”；人工审批返回 pending 时报告“已提交审核，线上仍使用旧版本”；状态不明时报告待核实，不要声称已上架。`
       : `并用 \`octo-cli marketplace plugin get --plugin-id <plugin-id> --include-relations --profile <profile>\` 回读核验。`}
     写入必须使用 Bot Profile${isUpdate ? "（HTTP 条件保存回退使用同一 Bot 身份）" : ""}，不需要也不要传 \`created_by_type\`；创建、更新、发布或审核失败时
     不要伪造成功，保留本地 payload 文件，并返回可重试命令和错误摘要。不要使用旧的专家 / 专家团专用 create / update / get、分类或技能上传命令。

以上 Space ID 和 API 地址是本次操作的权威输入。`;
}
