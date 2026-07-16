export function resolveAPIBaseURL(apiURL: string, origin: string): string {
  const value = apiURL || "/api/v1/";
  const withoutVersion = value.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  return new URL(withoutVersion || "/", origin).toString().replace(/\/$/, "");
}

export function buildInstallPrompt(skillId: string, spaceId: string, apiBaseURL: string): string {
  return `使用 octo-cli 将指定 Skill 安装到当前 Agent runtime。

- Skill ID：\`${skillId}\`
- Space ID：\`${spaceId}\`
- API 地址：\`${apiBaseURL}\`

1. 运行 \`octo-cli version\` 检查是否已安装。

2. 如果未安装，自动安装：

   - 项目地址：https://github.com/Mininglamp-OSS/octo-cli
   - 推荐安装：\`npm install -g @mininglamp-oss/octo-cli@latest\`
   - Go 安装：\`go install github.com/Mininglamp-OSS/octo-cli/cmd/octo-cli@latest\`

3. 如果 octo-cli 版本低于 \`0.8.0\`，自动升级后再继续。

4. 运行 \`octo-cli auth list\` 选择身份：

   - \`space_id\` 等于 \`${spaceId}\` 且只有一个时，使用该 Profile；
   - 没有或存在多个时，从当前 Octo Channel 的环境或配置中读取 Bot Token，通过 stdin 登录或更新固定 Profile \`space-${spaceId}\`；
   - 不得打印、回显或把 Token 放入命令参数。

   登录命令：

   \`\`\`bash
   <read-token> | octo-cli auth login --with-token --profile space-${spaceId} --space ${spaceId} --api-base-url ${apiBaseURL}
   \`\`\`

5. 判断当前 Agent runtime 及其 Skills 根目录，并使用上一步确定的 Profile 运行：

   \`\`\`bash
   octo-cli marketplace skills ${skillId} --profile <profile> --install <skills-root>
   \`\`\`

6. 检查安装结果，确认名称、路径和 \`SKILL.md\` 正确，且只有指定 Skill 被安装。

7. 告知用户 octo-cli 版本、Skill ID、安装名称、安装路径和最终状态。安装和升级默认自主执行，仅在无法继续时要求用户介入。`;
}
