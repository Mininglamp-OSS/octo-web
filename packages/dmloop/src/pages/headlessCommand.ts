// headless 免浏览器接入命令的纯构造逻辑，抽出为独立模块以便单测
// （不牵扯组件 / DOM / 样式依赖）。

// POSIX 单引号转义：把值包进单引号，内部单引号用 '\'' 收尾-转义-重开。
// token 与 backendUrl 来自服务端/管理员配置（非浏览器输入），加引号是防御性
// 处理——避免畸形的服务端值在用户粘贴执行时破坏命令。
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// headless 命令：login --token 直连后端 daemon_server_url，随后 daemon start。
// PAT 在用户点击复制的那一刻才签发（见 RuntimePage.onCopyHeadless）。
export function headlessCommand(token: string, backendUrl: string): string {
  return `octo-daemon login --token ${shellQuote(token)} --server-url ${shellQuote(backendUrl)} && octo-daemon daemon start`;
}
