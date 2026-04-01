/** @type {import('stylelint').Config} */
// CI 专用：只检查硬编码颜色，其余规则全部关闭
// 目标：新增/修改的 CSS 文件不允许硬编码颜色，必须用 var(--wk-*) 或 var(--semi-*)
export default {
  rules: {
    // ✅ 核心约束：硬编码颜色全部禁止
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [['rgb', 'rgba', 'hsl', 'hsla']],
  },
  ignoreFiles: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.storybook/**',
    '**/theme/**',        // token 定义文件，原始色值合法
    '**/App.css',         // 全局变量定义，原始色值合法
  ],
}
