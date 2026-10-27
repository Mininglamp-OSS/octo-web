# 隔离分支验证

- 基于上游 main@ff63949c，分支 codex/fix-card-state-authority。
- 从原实现分支只应用4个卡片源文件/测试的补丁；不包含原分支的市场或MCP提交。
- 离线安装依赖，InteractiveCard及Conversation相关30文件348项测试通过。
- i18n:check、diff检查通过。
- 在此新基线上对比全包类型诊断：HEAD7532条、当前7531条，去行号后多重集新增0；全包tsc仍不通过，不隐瞒基线错误。
- 改动仅删除普通文本推断卡片完成的路径、计时器/helper及对应旧行为测试，保留权威卡片编辑和正常消息接收。
- 未更改打包资源或安装包，未进行线上IM/真实Renderer CDP验证。
