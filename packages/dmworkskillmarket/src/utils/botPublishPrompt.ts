export interface BotPublishPromptValues {
  spaceId?: string;
  apiBaseUrl?: string;
}

export function getBotPublishPrompt(values: BotPublishPromptValues = {}): string {
  const spaceId = values.spaceId?.trim() || "<space-id>";
  const apiBaseUrl = values.apiBaseUrl?.trim() || "<api-base-url>";

  return `使用 octo-cli 内置的 Marketplace Skill，将指定 Skill 上架到 OCTO Marketplace。

- Space ID：\`${spaceId}\`
- API 地址：\`${apiBaseUrl}\`
- 可见范围：\`space\`

如果当前消息没有 Skill 包附件或路径，只回复：

> 请上传要上架的 \`.zip\` / \`.skill\` 包，或提供 Agent 当前运行环境可访问的 Skill 包或 Skill 目录位置。

不要解释正在读取 Skill、复述本 Prompt 或逐步播报检查过程。用户提供前不要搜索磁盘或猜测路径。

1. 运行 \`octo-cli version\`。如果未安装或不包含 \`octo-marketplace\` Skill，运行
   \`npm install -g @mininglamp-oss/octo-cli@latest\`。

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

4. 按该 Skill 的 \`skills.md\` 中“Publish as a Bot”流程，使用用户提供的附件、Skill 包路径或
   Skill 目录路径完成上架。以上 Space ID、API 地址和可见范围是本次操作的权威输入。`;
}
