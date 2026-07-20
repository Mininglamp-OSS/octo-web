export interface BotPublishPromptValues {
  spaceId?: string;
  apiBaseUrl?: string;
}

export function getBotPublishPrompt(values: BotPublishPromptValues = {}): string {
  const spaceId = values.spaceId?.trim() || "<space-id>";
  const apiBaseUrl = values.apiBaseUrl?.trim() || "<api-base-url>";

  return `使用 octo-cli 内置的 Marketplace Skill，将指定 Skill 上架到 OCTO Marketplace。

- Skill 包路径：\`<skill-zip-path>\`
- Space ID：\`${spaceId}\`
- API 地址：\`${apiBaseUrl}\`
- 可见范围：\`space\`

1. 运行 \`octo-cli version\`。如果未安装，优先运行
   \`npm install -g @mininglamp-oss/octo-cli@latest\`；也可以运行
   \`go install github.com/Mininglamp-OSS/octo-cli/cmd/octo-cli@latest\`。
   如果当前版本不包含 \`octo-marketplace\` Skill，先升级到最新版。

2. 运行 \`octo-cli auth list\`，选择 \`space_id\` 等于 \`${spaceId}\` 的唯一 Profile。
   如果不存在或无法唯一确定，从当前 Octo Channel 的安全环境或配置读取 Bot Token，
   通过 stdin 登录或更新固定 Profile \`space-${spaceId}\`：

   \`\`\`bash
   <read-token> | octo-cli auth login --with-token --profile space-${spaceId} --space ${spaceId} --api-base-url ${apiBaseUrl}
   \`\`\`

   不得打印、回显或把 Token 放入命令参数。

3. 使用选定的 Profile 运行以下命令，读取并遵循最新的 octo-marketplace Skill：

   \`\`\`bash
   octo-cli skills octo-marketplace --profile <profile>
   \`\`\`

4. 按该 Skill 的“Publish a Skill”流程完成上架。
   以上 Skill 包路径、Space ID、API 地址和可见范围是本次操作的权威输入。
   不要自行改写输入，也不要自行拼接 Marketplace 上传地址。

5. 在上传或覆盖现有 Skill 前，向用户展示：
   - Skill 名称和版本；
   - Skill 包路径、文件大小和 SHA-256；
   - 可见范围；
   - 本次操作是首次上架还是更新已有 Skill。

   取得明确确认后再继续。

6. 完成后验证：
   - Skill ID、名称和版本；
   - 可见范围；
   - 文件信息和校验和；
   - Marketplace 详情和下载接口；
   - 没有创建重复的同名 Skill。

   失败时不得创建或覆盖 Skill；已存在版本应保持不变。

7. 告知用户：
   - octo-cli 版本和使用的 Profile；
   - Skill ID、名称和版本；
   - Space ID 和可见范围；
   - 上架类型：首次上架或版本更新；
   - 最终状态。

   只有在 CLI/Skill 明确无法继续时才要求用户介入。`;
}
