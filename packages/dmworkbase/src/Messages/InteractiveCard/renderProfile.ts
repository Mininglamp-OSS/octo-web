export const FORGE_RENDER_PROFILE = "octo-chat/v1";

export type ResolvedCardRenderProfile = "legacy" | typeof FORGE_RENDER_PROFILE;

export type RenderProfileResolution =
  | { ok: true; profile: ResolvedCardRenderProfile }
  | { ok: false; reason: "unsupported-render-profile" };

/**
 * 缺字段永久代表 legacy；只有显式 octo-chat/v1 才启用 Forge 制品。
 * 未知非空值不能套用 legacy，否则新模板可能被旧样式错误渲染。
 */
export function resolveCardRenderProfile(
  value: string
): RenderProfileResolution {
  const normalized = value.trim();
  if (normalized === "") return { ok: true, profile: "legacy" };
  if (normalized === FORGE_RENDER_PROFILE) {
    return { ok: true, profile: FORGE_RENDER_PROFILE };
  }
  return { ok: false, reason: "unsupported-render-profile" };
}

export function cardMountRootClass(profile: ResolvedCardRenderProfile): string {
  return profile === FORGE_RENDER_PROFILE
    ? "wk-interactive-card-forge octo-card-profile"
    : "wk-interactive-card-sdk";
}
