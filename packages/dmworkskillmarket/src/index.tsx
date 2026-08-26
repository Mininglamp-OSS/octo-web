export { SkillMarketModule } from "./module";
// Re-exported so dmworkmcp's MarketSidebar can mount the skill list as a
// second tab under the unified "/mcp-market" shell (see MarketSidebar.tsx).
// Keeps the coupling to a single named export instead of dmworkmcp reaching
// into the internal folder tree.
export { default as SkillListPage } from "./pages/SkillListPage";
// Full-page skill editor, mounted as a whole-page route (no market sidebar)
// by dmworkmcp's module at /mcp-market/skill-editor.
export { default as SkillEditorPage } from "./pages/SkillEditorPage";
