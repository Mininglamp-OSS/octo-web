import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const original = Buffer.concat([
  Buffer.from(
    '\ufeff<!doctype html><html><head></head><body><h1>Original attachment</h1><script>try { parent.document.body.dataset.exposed="yes"; } catch (_) { document.body.dataset.isolated="yes"; }</script></body></html>\r\n'
  ),
  Buffer.from([255]),
]);

test("real new tab preview, exact bytes and original filename survive refresh and source closure", async ({
  page,
  context,
}) => {
  const apiRequests: string[] = [];
  await context.route("**/api/**", (route) => {
    apiRequests.push(route.request().url());
    return route.fulfill({ status: 500, body: "unexpected API request" });
  });
  await context.route("**/attachment-objects/chat/**", (route) => {
    expect(route.request().headers().token).toBeUndefined();
    return route.fulfill({
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment; filename=uuid",
      },
      body: route.request().url().endsWith("second")
        ? Buffer.from("<h1>Second attachment</h1>")
        : original,
    });
  });
  await page.goto("/e2e-kit/fixtures/html-attachment.html");
  await expect(page.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Original attachment"
  );
  const previewEvent = context.waitForEvent("page");
  await page.getByTitle("Open in new tab").click();
  const preview = await previewEvent;
  await preview.waitForURL(/\/file-preview#/);
  await expect(preview.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Original attachment"
  );
  expect(await preview.evaluate(() => window.opener)).toBeNull();
  expect(
    await preview.evaluate(() => document.body.dataset.exposed)
  ).toBeUndefined();
  expect(
    await preview
      .frameLocator("iframe")
      .locator("body")
      .getAttribute("data-isolated")
  ).toBe("yes");
  const downloadEvent = preview.waitForEvent("download");
  await preview.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("季度报告 Q3.html");
  expect(await readFile((await download.path())!)).toEqual(original);
  await page.getByRole("button", { name: "Select second attachment" }).click();
  await expect(page.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Second attachment"
  );
  await expect(preview.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Original attachment"
  );
  await page.close();
  await preview.reload();
  await expect(preview.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Original attachment"
  );
  await preview.getByRole("button", { name: "Source", exact: true }).click();
  await expect(preview.locator("pre")).toContainText("Original attachment");
  expect(apiRequests).toEqual([]); // no IM/contacts/space/bootstrap calls
});

test("localStorage-only login restores preview, download and new-tab handoff", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("uidfixture", "fixture-user");
    localStorage.setItem("tokenfixture", "fixture-token");
  });
  await context.route("**/attachment-objects/chat/**", (route) =>
    route.fulfill({ body: original })
  );
  await page.goto("/e2e-kit/fixtures/html-attachment.html?restore=1");
  await expect(page.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Original attachment"
  );
  expect(
    await page.evaluate(() => ({
      sid: sessionStorage.getItem("octo.session.sid"),
      uid: sessionStorage.getItem("uidfixture"),
      token: sessionStorage.getItem("tokenfixture"),
    }))
  ).toEqual({ sid: "fixture", uid: null, token: null });
  const downloadEvent = page.waitForEvent("download");
  await page.getByTitle("Download", { exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("季度报告 Q3.html");
  expect(await readFile((await download.path())!)).toEqual(original);
  const popup = context.waitForEvent("page");
  await page.getByTitle("Open in new tab").click();
  const preview = await popup;
  await expect(preview.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Original attachment"
  );
  await page.close();
  await preview.reload();
  await expect(preview.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Original attachment"
  );
});

test("signing 401 allows preview retry, new tabs and reload without losing the descriptor", async ({
  page,
  context,
}) => {
  let healthy = false;
  let signingRequests = 0;
  await context.route("**/api/v1/file/download/url?**", (route) => {
    signingRequests++;
    expect(route.request().headers().token).toBe("fixture-token");
    const key = new URL(route.request().url()).searchParams
      .get("path")
      ?.endsWith("second")
      ? "second"
      : "uuid";
    return route.fulfill(
      healthy
        ? { json: { url: new URL(`/signed/chat/${key}`, page.url()).href } }
        : { status: 401, json: { msg: "unauthorized" } }
    );
  });
  await context.route("**/signed/chat/**", (route) =>
    route.fulfill({
      body: route.request().url().endsWith("second")
        ? Buffer.from("<h1>Second attachment</h1>")
        : original,
    })
  );
  await page.goto("/e2e-kit/fixtures/html-attachment.html?proxy=1");
  await expect(
    page.getByText("Unable to prepare the download. Please retry.")
  ).toBeVisible();
  expect(signingRequests).toBe(1);
  const popup = context.waitForEvent("page");
  await page.getByTitle("Open in new tab").click();
  const preview = await popup;
  await expect(
    preview.getByText("Unable to prepare the download. Please retry.")
  ).toBeVisible();
  expect(
    await preview.evaluate(() =>
      sessionStorage.getItem(`octo.html-preview.${location.hash.slice(1)}`)
    )
  ).not.toBeNull();
  await expect(
    preview.getByText("Preview expired.", { exact: false })
  ).toHaveCount(0);
  healthy = true;
  await preview.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(preview.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Original attachment"
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Original attachment"
  );

  // Another 401 must not destroy the standalone tab's reload context either.
  healthy = false;
  await preview.reload();
  await expect(
    preview.getByText("Unable to prepare the download. Please retry.")
  ).toBeVisible();
  healthy = true;
  await preview.reload();
  await expect(preview.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Original attachment"
  );
  await page.getByRole("button", { name: "Select second attachment" }).click();
  await expect(page.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Second attachment"
  );
});

test("signing 401 fails one download and a new click retries with the same login", async ({
  page,
  context,
}) => {
  let signingRequests = 0;
  let downloads = 0;
  page.on("download", () => downloads++);
  // Browser-managed downloads may bypass Playwright routing. Serve the signed
  // response over real HTTP so the saved-byte assertion checks the response.
  const storage = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        "季度报告 Q3.html"
      )}`,
    });
    response.end(original);
  });
  await new Promise<void>((resolve) => storage.listen(0, "127.0.0.1", resolve));
  const storageURL = `http://127.0.0.1:${
    (storage.address() as AddressInfo).port
  }/chat/uuid`;
  try {
    await context.route("**/api/v1/file/download/url?**", (route) => {
      signingRequests++;
      return route.fulfill(
        signingRequests === 1
          ? { status: 401, json: { msg: "unauthorized" } }
          : { json: { url: storageURL } }
      );
    });
    await page.goto("/e2e-kit/fixtures/html-attachment.html?large=1");
    await page.getByTitle("Download", { exact: true }).click();
    await expect(
      page.getByText("Unable to prepare the download. Please retry.")
    ).toBeVisible();
    expect(signingRequests).toBe(1);
    expect(downloads).toBe(0);
    const downloadEvent = page.waitForEvent("download");
    await page.getByTitle("Download", { exact: true }).click();
    const download = await downloadEvent;
    expect(signingRequests).toBe(2);
    expect(download.suggestedFilename()).toBe("季度报告 Q3.html");
    expect(await readFile((await download.path())!)).toEqual(original);
  } finally {
    storage.closeAllConnections();
    await new Promise<void>((resolve) => storage.close(() => resolve()));
  }
});

test("logout clears copied preview context and bare preview links are expired", async ({
  page,
  context,
}) => {
  await context.route("**/attachment-objects/chat/**", (route) =>
    route.fulfill({ body: "<h1>Attachment</h1>" })
  );
  await page.goto("/e2e-kit/fixtures/html-attachment.html");
  const popup = context.waitForEvent("page");
  await page.getByTitle("Open in new tab").click();
  const preview = await popup;
  await expect(preview.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Attachment"
  );
  const url = preview.url();
  await page.evaluate(() => localStorage.removeItem("tokenfixture"));
  await expect(preview.getByRole("alert")).toContainText("Preview expired");
  await expect(preview.locator("iframe")).toHaveCount(0);
  await preview.reload();
  await expect(preview.getByRole("alert")).toContainText("Preview expired");
  const bare = await context.newPage();
  await bare.goto(url);
  await expect(bare.getByRole("alert")).toContainText("Preview expired");
});

test("same-origin redirect to cross-origin attachment still downloads the original bytes/name", async ({
  page,
  context,
}) => {
  const storage = createServer((request, response) => {
    expect(request.headers.token).toBeUndefined();
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment; filename=uuid",
    });
    response.end(original);
  });
  await new Promise<void>((resolve) => storage.listen(0, "127.0.0.1", resolve));
  const storageURL = `http://127.0.0.1:${
    (storage.address() as AddressInfo).port
  }/storage/chat/uuid`;
  try {
    await context.route("**/attachment-objects/chat/**", (route) =>
      route.fulfill({ status: 302, headers: { Location: storageURL } })
    );
    await page.goto("/e2e-kit/fixtures/html-attachment.html");
    await expect(page.frameLocator("iframe").getByRole("heading")).toHaveText(
      "Original attachment"
    );
    const event = page.waitForEvent("download");
    await page.getByTitle("Download", { exact: true }).click();
    const download = await event;
    expect(download.suggestedFilename()).toBe("季度报告 Q3.html");
    expect(await readFile((await download.path())!)).toEqual(original);
  } finally {
    storage.closeAllConnections();
    await new Promise<void>((resolve) => storage.close(() => resolve()));
  }
});

test("oversized HTML skips body loading and uses the signed filename", async ({
  page,
  context,
}) => {
  let bodyRequests = 0;
  await context.route("**/attachment-objects/chat/**", (route) => {
    bodyRequests++;
    return route.abort();
  });
  await context.route("**/api/v1/file/download/url?**", (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("filename")).toBe("季度报告 Q3.html");
    expect(url.searchParams.get("disposition")).toBe("attachment");
    expect(route.request().headers()["x-space-id"]).toBe("space-a");
    return route.fulfill({
      json: { url: new URL("/signed/chat/uuid", page.url()).href },
    });
  });
  await context.route("**/signed/chat/uuid", (route) =>
    route.fulfill({
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          "季度报告 Q3.html"
        )}`,
      },
      body: original,
    })
  );
  await page.goto("/e2e-kit/fixtures/html-attachment.html?large=1");
  await expect(page.locator(".wk-file-too-large")).toBeVisible();
  expect(bodyRequests).toBe(0);
  const sourceDownload = page.waitForEvent("download");
  await page.getByTitle("Download", { exact: true }).click();
  const download = await sourceDownload;
  expect(download.suggestedFilename()).toBe("季度报告 Q3.html");
  expect(bodyRequests).toBe(0);
});

test("signing failure is visible and never starts an unnamed raw download", async ({
  page,
  context,
}) => {
  let downloads = 0;
  page.on("download", () => downloads++);
  await context.route("**/api/v1/file/download/url?**", (route) =>
    route.fulfill({ status: 500, json: { msg: "failed" } })
  );
  await page.goto("/e2e-kit/fixtures/html-attachment.html?large=1");
  await page.getByTitle("Download", { exact: true }).click();
  await expect(
    page.getByText("Unable to prepare the download. Please retry.")
  ).toBeVisible();
  expect(downloads).toBe(0);
});

test("standalone controls render in both languages and themes", async ({
  page,
  context,
}, testInfo) => {
  await context.route("**/attachment-objects/chat/**", (route) =>
    route.fulfill({ body: "<h1>Quarterly report</h1><p>HTML preview</p>" })
  );
  await page.goto("/e2e-kit/fixtures/html-attachment.html");
  const popup = context.waitForEvent("page");
  await page.getByTitle("Open in new tab").click();
  const preview = await popup;
  await expect(
    preview.getByRole("button", { name: "Back to chat" })
  ).toBeVisible();
  await expect(preview.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Quarterly report"
  );
  await preview.screenshot({
    path: testInfo.outputPath("preview-en-light.png"),
  });
  await preview.evaluate(() => {
    localStorage.setItem("octo:locale", "zh-CN");
    document.cookie = "i18n_lang=zh-CN; path=/";
    sessionStorage.setItem("theme-mode", "1");
  });
  await preview.reload();
  await expect(preview.getByRole("button", { name: "返回聊天" })).toBeVisible();
  await expect(preview.locator("body")).toHaveAttribute("theme-mode", "dark");
  expect(
    await preview.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue("--wk-bg-surface").trim()
    )
  ).not.toBe("");
  await preview.screenshot({
    path: testInfo.outputPath("preview-zh-dark.png"),
  });
});
