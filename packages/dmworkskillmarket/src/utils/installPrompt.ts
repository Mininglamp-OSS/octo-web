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

1. 运行 \`octo-cli version\`。如果未安装，优先运行
   \`npm install -g @mininglamp-oss/octo-cli@latest\`；也可以运行
   \`go install github.com/Mininglamp-OSS/octo-cli/cmd/octo-cli@latest\`。
   如果当前版本不包含 \`octo-marketplace\` Skill，先升级到最新版。

2. 运行 \`octo-cli auth list\`，选择 \`space_id\` 等于 \`${spaceId}\` 的唯一 Profile。
   如果不存在或无法唯一确定，从当前 Octo Channel 的安全环境或配置读取 Bot Token，
   通过 stdin 登录或更新固定 Profile \`space-${spaceId}\`：

   \`\`\`bash
   <read-token> | octo-cli auth login --with-token --profile space-${spaceId} --space ${spaceId} --api-base-url ${apiBaseURL}
   \`\`\`

   不得打印、回显或把 Token 放入命令参数。

3. 使用选定的 Profile 运行以下命令，读取并遵循最新的 \`octo-marketplace\` Skill：

   \`\`\`bash
   octo-cli skills octo-marketplace --profile <profile>
   \`\`\`

4. 按该 Skill 的 \`skills.md\` 中“Install”流程完成安装。
   以上 Skill ID、Space ID 和 API 地址是本次操作的权威输入。
   不要自行改写 ID，也不要自行拼接 Marketplace 下载地址。

5. 在下载或覆盖文件前，向用户展示：
   - Skill 名称和版本；
   - 目标 Skills 根目录；
   - 是否会替换现有安装。

   取得明确确认后再继续。

6. 完成后验证：
   - 安装目录；
   - \`SKILL.md\`；
   - 文件校验和。

   失败时保留原安装，不得修改同一根目录中的其他 Skill。

7. 告知用户：
   - Skill ID、安装名称和版本；
   - 安装路径和最终状态。

   只有在 CLI/Skill 明确无法继续时才要求用户介入。`;
}
