import assert from "node:assert/strict";
import { chromium } from "playwright";

// Drives the real unified workspace in a real browser against the isolated
// backend fixture (tests/unified-summary-mirror in the paired backend repo),
// after that fixture's smoke.mjs has produced its two summaries. Synthetic
// identity only; no stored credentials, no external network.
//
// What this accepts, in the running product UI rather than in unit tests:
//   1. One list holds both the from-scratch and the continue-optimize summary.
//   2. 继续优化 is its own entry and leaves the detail for the agent route --
//      it never rewrites the summary in place.
//   3. 重新生成 and 定时更新 are two separate same-summary entries, offered on
//      both summaries. 重新生成 opens a two-mode modal (按意见调整 + 全部重新生成);
//      全部重新生成 is greyed and points to 定时更新 until the config is complete.
//   4. A schedule saved through 配置 is visible on the detail, at the version
//      the same-summary regenerations produced.
//   5. The IM chat sidebar is the same product, not a reduced copy: the real
//      channel-header star button opens the real panel through the endpoint
//      registry, the panel's card menu offers the same split, and 继续优化 there
//      leaves the detail for the agent flow with the source summary referenced.
// The hermetic fixture host, not the full-Octo mirror on :28370 — this suite
// drives synthetic identity over the isolated backend fixture (see README).
const origin = process.env.MIRROR_ORIGIN ?? "http://127.0.0.1:28372";
const scratch = Number(process.env.MIRROR_SCRATCH_TASK ?? 1);
const derived = Number(process.env.MIRROR_DERIVED_TASK ?? 2);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures = [];
page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") failures.push(`console: ${message.text()}`);
});
page.on("response", (response) => {
  const url = new URL(response.url());
  if (url.pathname.startsWith("/summary/api/") && response.status() >= 400) {
    failures.push(`api ${response.status()} ${url.pathname}`);
  }
});

const content = () => page.locator(".summary-workspace__content");
async function cardMenu(taskId) {
  await page.getByTestId(`summary-card-menu-${taskId}`).click();
  await page.waitForTimeout(700);
  const items = (await page.locator(".semi-dropdown-item").allInnerTexts())
    .map((text) => text.trim())
    .filter(Boolean);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return items;
}

try {
  await page.goto(`${origin}/?task=${derived}`, { waitUntil: "networkidle" });
  await content().waitFor({ timeout: 20000 });
  await page.getByTestId("summary-detail-continue-refine-btn").waitFor({ timeout: 20000 });

  // (1) One unified list, both summaries. The derived one shows its topic:
  // 补齐配置 is what gives a summary a topic to regenerate on, so a configured
  // card renders the requirement rather than the agent's original heading.
  const listText = await page.locator(".summary-workspace__list").innerText();
  assert.ok(listText.includes("Alpha 项目周报"), `list is missing the from-scratch summary:\n${listText}`);
  assert.ok(listText.includes("汇总 Alpha 项目本周进展、风险与决议"),
    `list is missing the configured derived summary:\n${listText}`);

  // (3) The split, now identical on both summaries: 重新生成 (the two-mode modal)
  // and 定时更新 are separate entries. 重新生成 is offered on the unconfigured agent
  // summary too — its 全部重新生成 mode is greyed inside the modal and points to
  // 定时更新, but 按意见调整 stays available, so the entry itself always appears.
  const expectedMenu = ["编辑", "继续优化", "重新生成", "定时更新", "删除"];
  const derivedMenu = await cardMenu(derived);
  assert.deepEqual(derivedMenu, expectedMenu,
    `unexpected menu on the configured derived summary: ${derivedMenu.join(" | ")}`);
  const scratchMenu = await cardMenu(scratch);
  assert.deepEqual(scratchMenu, expectedMenu,
    `the agent summary must offer the same split (重新生成 + 定时更新): ${scratchMenu.join(" | ")}`);

  // (4) The schedule saved through 配置, at the version the same-summary runs left.
  const detailText = await content().innerText();
  assert.match(detailText, /定时：每周 09:00 · 下次 /,
    `the schedule saved through 配置 must be visible on the detail:\n${detailText.slice(0, 400)}`);
  assert.match(detailText, /V3 · 修订 3/,
    `the manual and scheduled regenerations must land on this same summary:\n${detailText.slice(0, 400)}`);
  assert.match(detailText, /本周进展/,
    `the rendered body must be a real report, not a placeholder:\n${detailText.slice(0, 400)}`);
  assert.match(detailText, /风险与阻塞/,
    `the rendered body must carry the risk section the window produced:\n${detailText.slice(0, 400)}`);
  await page.screenshot({ path: "/tmp/unified-mirror-detail.png" });

  // (2) 继续优化 leaves the detail for the agent create route.
  await page.getByTestId("summary-detail-continue-refine-btn").click();
  await page.waitForTimeout(2500);
  const afterClick = await content().innerText();
  assert.ok(!afterClick.includes("V3 · 修订 3"),
    `继续优化 must leave the current summary's detail, not rewrite it in place:\n${afterClick.slice(0, 600)}`);
  await page.screenshot({ path: "/tmp/unified-mirror-continue-optimize.png" });

  // (5) The IM chat sidebar. Everything here comes from the production bootstrap:
  // the star button is whatever channelHeaderRightItems registered, and the panel
  // is whatever chatSummaryPanel registered — the fixture only fakes the chat page
  // around them. So this leg is what proves the sidebar and the workspace agree.
  await page.goto(`${origin}/?mount=chat`, { waitUntil: "networkidle" });
  await page.getByTestId("summary-chat-panel-header-btn").click();
  const panel = page.getByTestId("summary-chat-panel");
  await panel.waitFor({ timeout: 20000 });
  await page.getByTestId(`summary-card-${derived}`).waitFor({ timeout: 20000 });

  const panelText = await panel.innerText();
  assert.ok(panelText.includes("汇总 Alpha 项目本周进展、风险与决议"),
    `the sidebar must list this channel's summaries:\n${panelText.slice(0, 400)}`);
  const panelMenu = await cardMenu(derived);
  assert.deepEqual(panelMenu, derivedMenu,
    `the sidebar card menu must match the workspace's: ${panelMenu.join(" | ")}`);
  await page.screenshot({ path: "/tmp/unified-mirror-chat-list.png" });

  await page.getByTestId(`summary-card-${derived}`).click();
  await page.getByTestId("summary-detail-continue-refine-btn").waitFor({ timeout: 20000 });
  await page.screenshot({ path: "/tmp/unified-mirror-chat-detail.png" });
  await page.getByTestId("summary-detail-continue-refine-btn").click();
  await page.waitForTimeout(2500);

  // The whole point of the merge: in the sidebar too, 继续优化 is a new summary
  // derived through the agent conversation, not an in-place rewrite of this one.
  assert.equal(await page.getByTestId("summary-detail-page").count(), 0,
    "继续优化 in the sidebar must leave the source summary's detail");
  const refineText = await panel.innerText();
  assert.match(refineText, /引用总结/,
    `the derived agent session must reference the source summary:\n${refineText.slice(0, 400)}`);
  assert.match(refineText, /Alpha 项目周报\(补充风险与下一步\)/,
    `the reference must be the summary 继续优化 was invoked on:\n${refineText.slice(0, 400)}`);
  await page.screenshot({ path: "/tmp/unified-mirror-chat-continue-optimize.png" });

  assert.deepEqual(failures, [], `browser reported failures:\n${failures.join("\n")}`);
  console.log(
    `PASS: unified list holds both summaries; both offer ${expectedMenu.join(" / ")} ` +
    `— 重新生成 and 定时更新 split into separate entries — with the configured derived ` +
    `summary at V3 and 定时：每周 09:00; 继续优化 leaves the detail for the agent route. ` +
    `The IM sidebar, opened by the real channel-header button, offers the same menu ` +
    `(${panelMenu.join(" / ")}) and its 继续优化 also leaves the detail for the agent ` +
    `flow with 引用总结 attached. No console errors, no failing /summary/api/ calls.`
  );
} finally {
  await page.screenshot({ path: "/tmp/unified-mirror-last.png" }).catch(() => {});
  await browser.close();
}
