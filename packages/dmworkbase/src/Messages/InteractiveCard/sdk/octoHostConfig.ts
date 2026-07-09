import { HostConfig } from "adaptivecards";

/**
 * octo AdaptiveCards HostConfig（主题/样式映射）。
 *
 * AC 的 HostConfig 颜色需**具体色值**（应用为 inline style）。项目主题用 `--wk-*` CSS 变量、
 * 随亮/暗切换。为稳健（不赌 SDK/jsdom 是否接受 inline `var()`），这里用**可注入解析器**把
 * `var(--wk-*)` 解析成具体色值：
 *   - 浏览器默认解析器 `browserCssVarResolver` 用一个隐藏探针元素 + `getComputedStyle` 强制解析；
 *   - 单测注入桩解析器，避免依赖真实样式表。
 * 主题切换时用当前 resolver 重建 HostConfig 即可。
 *
 * 尺寸/间距用与现有设计一致的字面量（非颜色，无需解析）。
 */

/** 把一个 CSS 颜色表达式（通常是 `var(--wk-*)`）解析为具体色值。 */
export type CssColorResolver = (cssColorExpr: string) => string;

/** 浏览器解析器：借隐藏探针的 computed color 强制解析 var()（含链式 var）。 */
export function browserCssVarResolver(
  root: HTMLElement = document.body
): CssColorResolver {
  return (expr) => {
    const probe = document.createElement("span");
    probe.style.color = expr;
    probe.style.display = "none";
    probe.setAttribute("aria-hidden", "true");
    root.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved || expr;
  };
}

/** 需要解析的语义色 token（集中一处，主题切换只需换 resolver 重建）。 */
const COLOR_TOKENS = {
  textDefault: "var(--wk-text-primary)",
  textSubtle: "var(--wk-text-secondary)",
  accent: "var(--wk-text-accent)",
  background: "var(--wk-bg-surface)",
  // 容器填色（Container.style 背景）。AC 3.x 内置 containerStyles 只带前景色、
  // backgroundColor 为 undefined，故 emphasis/accent/good/warning/attention 的背景
  // 必须由 HostConfig 显式提供，否则一律退化为透明/父白底（见排查结论）。
  emphasisBackground: "var(--wk-bg-elevated)",
  accentBackground: "var(--wk-accent-tint-10)",
  good: "var(--wk-color-success)",
  goodBackground: "var(--wk-color-success-bg)",
  warning: "var(--wk-color-warning)",
  warningBackground: "var(--wk-color-warning-bg)",
  attention: "var(--wk-color-danger)",
  attentionBackground: "var(--wk-color-danger-bg)",
} as const;

export function buildOctoHostConfig(resolve: CssColorResolver): HostConfig {
  const text = resolve(COLOR_TOKENS.textDefault);
  const subtle = resolve(COLOR_TOKENS.textSubtle);
  const accent = resolve(COLOR_TOKENS.accent);
  const background = resolve(COLOR_TOKENS.background);
  const emphasisBackground = resolve(COLOR_TOKENS.emphasisBackground);
  const accentBackground = resolve(COLOR_TOKENS.accentBackground);
  const good = resolve(COLOR_TOKENS.good);
  const goodBackground = resolve(COLOR_TOKENS.goodBackground);
  const warning = resolve(COLOR_TOKENS.warning);
  const warningBackground = resolve(COLOR_TOKENS.warningBackground);
  const attention = resolve(COLOR_TOKENS.attention);
  const attentionBackground = resolve(COLOR_TOKENS.attentionBackground);

  // 前景色集：good/warning/attention 映射到语义色，使 TextBlock color=Good/... 也正确着色。
  // 所有 containerStyle 共用同一前景集，仅背景/边框不同——文本默认取 default（深色），
  // 叠在浅色填色底上依旧可读。
  const fg = {
    default: { default: text, subtle },
    accent: { default: accent, subtle: accent },
    good: { default: good, subtle: good },
    warning: { default: warning, subtle: warning },
    attention: { default: attention, subtle: attention },
  };

  return new HostConfig({
    // 字体继承宿主（不强设，随 IM 主体字体）。
    fontSizes: { small: 12, default: 13, medium: 14, large: 17, extraLarge: 20 },
    fontWeights: { lighter: 200, default: 400, bolder: 600 },
    spacing: {
      none: 0,
      small: 4,
      default: 8,
      medium: 12,
      large: 16,
      extraLarge: 20,
      padding: 12,
    },
    separator: { lineThickness: 1, lineColor: subtle },
    supportsInteractivity: true,
    actions: {
      buttonSpacing: 8,
      spacing: "default",
      actionsOrientation: "horizontal",
      actionAlignment: "left",
    },
    // 六种 containerStyle 全部显式提供背景填色（缺任一都会退化成裸白底）。
    containerStyles: {
      default: {
        backgroundColor: background,
        foregroundColors: fg,
      },
      emphasis: {
        backgroundColor: emphasisBackground,
        foregroundColors: fg,
      },
      accent: {
        backgroundColor: accentBackground,
        foregroundColors: fg,
      },
      good: {
        backgroundColor: goodBackground,
        foregroundColors: fg,
      },
      warning: {
        backgroundColor: warningBackground,
        foregroundColors: fg,
      },
      attention: {
        backgroundColor: attentionBackground,
        foregroundColors: fg,
      },
    },
  });
}

export default buildOctoHostConfig;
