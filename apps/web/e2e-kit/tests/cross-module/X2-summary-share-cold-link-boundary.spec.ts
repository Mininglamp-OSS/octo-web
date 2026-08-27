/* eslint-disable no-undef -- e2e code runs in Node */
/** spec: e2e-kit/case-specs/cross-module/X2-summary-share-cold-link-boundary.md */
import { test, expect, AUTH_KEYS_SUFFIXED, E2E_SID, MOCK_LOCALE, LOCALE_STORAGE_KEY, ONBOARDING_STORAGE_KEY, SPACE_STORAGE_KEY } from "../../fixtures-authed";
import { registerX2SummaryShareColdLinkBoundary } from "../../msw-handlers/x2-summary-share-cold-link-boundary";

test("@X2 @p1 @cross-module @summary @deep-link @cold-start Summary 分享冷启动不显示返回聊天", async ({ pagePlain }) => {
  await pagePlain.addInitScript(({ sid, auth, spaceKey, spaceId, localeKey, locale, onboardingKey }) => {
    const ls = localStorage;
    sessionStorage.setItem("octo.session.sid", sid);
    for (const [key, value] of Object.entries(auth)) ls.setItem(`${key}${sid}`, value);
    ls.setItem(spaceKey, spaceId);
    ls.setItem(localeKey, locale);
    ls.setItem(onboardingKey, "seen");
  }, { sid: E2E_SID, auth: AUTH_KEYS_SUFFIXED, spaceKey: SPACE_STORAGE_KEY, spaceId: "e2e-space-001", localeKey: LOCALE_STORAGE_KEY, locale: MOCK_LOCALE, onboardingKey: ONBOARDING_STORAGE_KEY });

  await pagePlain.goto(`/?sid=${E2E_SID}`);
  await pagePlain.waitForFunction(() => (globalThis as { __MSW_READY__?: boolean }).__MSW_READY__ === true);
  await registerX2SummaryShareColdLinkBoundary(pagePlain);
  await pagePlain.waitForFunction(() => (globalThis as { __s26MswInstalled?: boolean }).__s26MswInstalled === true, undefined, { timeout: 15_000 });
  await pagePlain.route(/\/summary-shares\/e2e-share-026(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        message: "ok",
        data: {
          share_id: "e2e-share-026",
          source_accessible: true,
          snapshot: {
            id: 2602,
            task_id: 2601,
            task_no: "e2e-share-026",
            space_id: "e2e-space-001",
            title: "S26 分享总结",
            source_name: "S26 项目群",
            source_count: 1,
            participant_count: 2,
            message_count: 8,
            time_range_start: "2026-08-24T00:00:00Z",
            time_range_end: "2026-08-25T00:00:00Z",
            summary_mode: 1,
            result_version: 1,
            preview: "S26 分享正文",
            content: "## S26 分享详情\n\n这是从分享链接直接打开的总结正文。",
            created_at: "2026-08-25T08:00:00Z",
          },
        },
      }),
    })
  );
  await pagePlain.goto(`/s/share/e2e-share-026?sid=${E2E_SID}`);

  await expect(pagePlain.getByRole("heading", { name: "S26 分享总结" })).toBeVisible({ timeout: 15_000 });
  await expect(pagePlain.getByText("这是从分享链接直接打开的总结正文。", { exact: true })).toBeVisible();
  await expect(pagePlain.getByRole("button", { name: "返回群聊", exact: true })).toHaveCount(0);
});
