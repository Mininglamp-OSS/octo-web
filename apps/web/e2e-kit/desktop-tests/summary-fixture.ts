import { expect, type Page } from "@playwright/test";

export const summaryFixture = "/e2e-kit/fixtures/desktop-summary-sidebar.html";

export async function openSummaryFixture(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => {
    const state = document.querySelector<HTMLElement>("#root")?.dataset.fixtureState;
    return state === "ready" || state === "error";
  }, undefined, { timeout: 20_000 });
  const fixtureState = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#root");
    return { state: root?.dataset.fixtureState, error: root?.dataset.fixtureError };
  });
  expect(fixtureState.state, fixtureState.error || "Summary fixture did not finish bootstrapping").toBe("ready");
}
