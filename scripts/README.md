# scripts/

开发工具脚本。

## Windows 说明

`package.json` 中的 worktree 命令（`new:worktree`、`cleanup:worktree`）统一通过 `run-bash-script.mjs` 执行 bash 脚本：在 Windows 上显式探测 Git for Windows 自带的 bash，避开 WSL 的 `C:\Windows\System32\bash.exe`（用它执行会进入 Linux 环境，node/git 工具链与预期不符导致脚本失败）。装了 Git for Windows 即开箱即用；特殊情况可用环境变量 `OCTO_BASH` 显式指定 bash.exe 路径。Linux/macOS 直接使用系统 bash，行为不变。

## 命令

| 命令 | 说明 |
|---|---|
| `pnpm gen:component <Name>` | 生成 ui/ + bridge/ 脚手架 |
| `pnpm new:worktree <branch> [base] [--yes]` | 建 worktree |
| `pnpm cleanup:worktree <branch> [--keep-remote] [--yes]` | 清理 worktree |
