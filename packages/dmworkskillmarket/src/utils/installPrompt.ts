export function resolveAPIBaseURL(apiURL: string, origin: string): string {
  const target = new URL(apiURL || origin, origin);
  return target.origin;
}

export function buildInstallPrompt(skillId: string, spaceId: string, apiBaseURL: string): string {
  return `使用 octo-cli 内置的 Marketplace Skill，将指定 Skill 安装到当前 Agent runtime。

- Skill ID：\`${skillId}\`
- Space ID：\`${spaceId}\`
- API 地址：\`${apiBaseURL}\`

不要解释正在读取 Skill、复述本 Prompt 或逐步播报检查过程。

1. 运行 \`octo-cli version\`。如果未安装或不包含 \`octo-marketplace\` Skill，运行
   \`npm install -g @mininglamp-oss/octo-cli@latest\`。

2. 运行 \`octo-cli auth list\`，选择 \`space_id\` 等于 \`${spaceId}\` 的唯一 Profile。
   如果不存在或无法唯一确定，从当前 Octo Channel 的安全环境或配置读取 Bot Token，
   通过 stdin 登录或更新固定 Profile \`space-${spaceId}\`：

   \`\`\`bash
   <read-token> | octo-cli auth login --with-token --profile space-${spaceId} --space ${spaceId} --api-base-url ${apiBaseURL}
   \`\`\`

   不得输出 Token 或把 Token 放入命令参数。

3. 使用选定的 Profile 运行以下命令，读取并遵循最新的 \`octo-marketplace\` Skill：

   \`\`\`bash
   octo-cli skills octo-marketplace --profile <profile>
   \`\`\`

4. 按该 Skill 的 \`skills.md\` 中“Install”流程完成安装。
   以上 Skill ID、Space ID 和 API 地址是本次操作的权威输入。
   不要自行改写 ID。`;
}
