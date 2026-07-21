/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C25-loop-comment-add
// @edge — 非主流程 (comment 走 tiptap 富编辑器, 兜底 flow, 优先级低)

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C25 @edge loop 评论发送 — 详情 → tiptap 输入 → 点发送 → 显示已添加", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-issue");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.getByText("First issue").first().click();
  await expect(authedPage.getByText("属性").first()).toBeVisible();

  // tiptap editor (ProseMirror contenteditable) — 用 .loop-idp__newcomment 定位
  const editor = authedPage.locator(".loop-idp__newcomment [contenteditable=\"true\"]");
  await editor.click();
  await editor.type("C25 e2e 评论内容");

  // 点发送按钮 (aria-label="发送" i18n loop.comment.send)
  await authedPage.locator(".loop-idp__newcomment").getByRole("button", { name: "发送" }).click();

  // 成功: toast "评论已添加" (i18n loop.toast.commentAdded)
  await expect(authedPage.getByText("评论已添加").first()).toBeVisible();
});
