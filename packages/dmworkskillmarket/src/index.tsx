export { SkillMarketModule } from "./module";
// Re-exported so dmworkmcp's MarketSidebar can mount the skill list as a
// second tab under the unified "/mcp-market" shell (see MarketSidebar.tsx).
// Keeps the coupling to a single named export instead of dmworkmcp reaching
// into the internal folder tree.
export { default as SkillListPage } from "./pages/SkillListPage";
// Full-page skill editor, mounted as a whole-page route (no market sidebar)
// by dmworkmcp's module at /mcp-market/skill-editor.
export { default as SkillEditorPage } from "./pages/SkillEditorPage";
// Skill create-from-scratch write helper + its draft shape, reused by dmworkmcp
// to materialize expert-scoped skill drafts on the parent editor's save.
export { createSkillFromScratch } from "./api/skillApi";
export type { SkillDraftForm } from "./types/skill";
