export function buildInstallPrompt(skillId: string): string {
  return `使用 octo-cli 将指定 Skill 安装到当前 Agent runtime。

Skill ID：\`${skillId}\`

1. 运行 \`octo-cli version\` 检查是否已安装。

2. 如果未安装，自动安装：
   - 项目地址：https://github.com/Mininglamp-OSS/octo-cli
   - 推荐安装：\`npm install -g @mininglamp-oss/octo-cli@latest\`
   - Go 安装：\`go install github.com/Mininglamp-OSS/octo-cli/cmd/octo-cli@latest\`

3. 如果 octo-cli 版本低于 \`0.8.0\`，自动升级后再继续。

4. 判断当前 Agent runtime 及其 Skills 根目录。

5. 运行：
   \`octo-cli marketplace skills ${skillId} --install <skills-root>\`

6. 检查安装结果，确认名称、路径和 \`SKILL.md\` 正确，且只有指定 Skill 被安装。

7. 告知用户 octo-cli 版本、Skill ID、安装名称、安装路径和最终状态。安装和升级默认自主执行，仅在无法继续时要求用户介入。`;
}
