// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  readFileSync(join(here, rel), "utf8");

describe("summary desktop markers", () => {
  it("marks a header on every detail route workspace", () => {
    const detail = read("../pages/SummaryDetailPage.tsx");
    expect(detail).toMatch(/className="summary-detail-title-row" data-desktop-chrome="header"/);
    const confirm = read("../pages/SummaryConfirmPage.tsx");
    expect(confirm).toMatch(/className="summary-confirm-header" data-desktop-chrome="header"/);
    const schedule = read("../pages/ScheduleListPage.tsx");
    expect(schedule).toMatch(/className="summary-schedule-header" data-desktop-chrome="header"/);
  });

  it("marks headers on list, create, share and preview surfaces", () => {
    const list = read("../pages/SummaryListPage.tsx");
    expect(list).toMatch(/className="summary-list-header" data-desktop-chrome="header"/);
    const create = read("../pages/SummaryCreatePage.tsx");
    expect(create).toMatch(/className="summary-workbench-header" data-desktop-chrome="header"/);
    const workbench = read("../ui/SummaryWorkbench/index.tsx");
    expect(workbench).toMatch(/className="wk-summary-workbench__header" data-desktop-chrome="header"/);
    const share = read("../pages/SummaryShareDetailPage.tsx");
    expect(share).toMatch(/<header className="summary-share-detail__header" data-desktop-chrome="header">/);
    const preview = read("../features/summaryShare/SummarySharePreviewFeature.tsx");
    expect(preview).toMatch(/<header className="summary-share-preview__header" data-desktop-chrome="header">/);
    expect(preview).not.toMatch(/data-desktop-overlay/);
  });

  it("marks independently positioned side pane headers", () => {
    expect(read("../components/SummaryReferenceSidePanel.tsx"))
      .toMatch(/className="summary-workbench-ref-side-header" data-desktop-chrome="header"/);
    expect(read("../components/SummaryVersionPanel.tsx"))
      .toMatch(/className="version-panel__header" data-desktop-chrome="header"/);
  });
});
