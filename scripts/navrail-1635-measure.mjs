/**
 * #1635 verification harness — measures REAL rendered label boxes for the NavRail
 * dual-span short/full label fix (PR #1636).
 *
 * The unit tests only assert DOM structure + CSS cascade *text*. The actual bug was a
 * pixel overflow that depends on the resolved font, so the only test that truly closes
 * the loop is a layout measurement in a real engine.
 *
 * Verdict rule: for the VISIBLE label span, scrollWidth must be <= clientWidth.
 * If scrollWidth > clientWidth the browser is applying text-overflow: ellipsis => truncated.
 *
 * Run: node scripts/navrail-1635-measure.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(
    resolve(here, "..", "packages/dmworkbase/src/Components/NavRail/index.css"),
    "utf8",
);

// Design tokens the NavRail CSS depends on (normally injected by the theme layer).
const TOKENS = `:root{--wk-text-size-tiny:10px;--wk-font-medium:500;--wk-sp-1:4px;--wk-sp-2:8px;--wk-sp-3:12px;--wk-r-md:10px;--wk-icon-muted:#8a8a8a;}`;

// Matches NavItem.tsx output when shortLabel !== label (dual span) or === label (single span).
function navItemHtml(full, short) {
    const distinct = !!short && short !== full;
    const labels = distinct
        ? `<span class="wk-navrail__item-label wk-navrail__item-label--full">${full}</span>` +
          `<span class="wk-navrail__item-label wk-navrail__item-label--short">${short}</span>`
        : `<span class="wk-navrail__item-label">${full}</span>`;
    return `<button type="button" class="wk-navrail__item" aria-label="${full}"${
        distinct ? ` title="${full}"` : ""
    }><svg viewBox="0 0 20 20"></svg>${labels}</button>`;
}

const CASES = [
    // locale, full label, short label (undefined => no titleShort key)
    { locale: "en-US", full: "AI Summary", short: "Summary" },
    { locale: "zh-CN", full: "智能总结", short: "智能总结" }, // titleShort === title => single span
    { locale: "en-US", full: "Chats", short: undefined },
    { locale: "en-US", full: "Contacts", short: undefined },
];

// Font stacks to probe: the CI/dev font and the Linux fallback that broke round 3.
const FONT_STACKS = [
    { name: "default-sans", css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
    { name: "DejaVu Sans", css: "'DejaVu Sans', sans-serif" },
    { name: "Liberation Sans", css: "'Liberation Sans', sans-serif" },
];

const RAILS = [
    { name: "collapsed", width: 56, expandedClass: false },
    { name: "expanded", width: 180, expandedClass: true },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 600 } });

const rows = [];
for (const font of FONT_STACKS) {
    for (const rail of RAILS) {
        await page.setContent(`<!doctype html><html><head><style>
${TOKENS}
*{margin:0}
body{font-family:${font.css}}
${css}
.wk-layout-tab{display:flex}
</style></head><body>
<div class="wk-layout-tab${rail.expandedClass ? " wk-layout-tab-expanded" : ""}" style="width:${rail.width}px">
  <nav class="wk-navrail" style="width:${rail.width}px">
    ${CASES.map((c) => navItemHtml(c.full, c.short)).join("\n")}
  </nav>
</div></body></html>`);

        const measured = await page.evaluate(() => {
            const out = [];
            document.querySelectorAll(".wk-navrail__item").forEach((btn) => {
                const spans = [...btn.querySelectorAll(".wk-navrail__item-label")];
                const visible = spans.filter((s) => getComputedStyle(s).display !== "none");
                out.push({
                    aria: btn.getAttribute("aria-label"),
                    title: btn.getAttribute("title"),
                    spanCount: spans.length,
                    visibleCount: visible.length,
                    visibleText: visible.map((s) => s.textContent).join(" | "),
                    clientWidth: visible[0] ? visible[0].clientWidth : null,
                    scrollWidth: visible[0] ? visible[0].scrollWidth : null,
                    textWidth: visible[0]
                        ? Math.round(
                              (() => {
                                  const r = document.createRange();
                                  r.selectNodeContents(visible[0]);
                                  return r.getBoundingClientRect().width;
                              })() * 100,
                          ) / 100
                        : null,
                });
            });
            return out;
        });

        measured.forEach((m) =>
            rows.push({ font: font.name, rail: rail.name, ...m }),
        );
    }
}
await browser.close();

let failures = 0;
console.log(
    "font".padEnd(17) +
        "rail".padEnd(11) +
        "aria-label".padEnd(13) +
        "visible".padEnd(22) +
        "text".padEnd(8) +
        "box".padEnd(6) +
        "spans".padEnd(7) +
        "verdict",
);
console.log("-".repeat(96));
for (const r of rows) {
    const truncated = r.scrollWidth > r.clientWidth;
    const doubleShown = r.visibleCount !== 1;
    const bad = truncated || doubleShown;
    if (bad) failures++;
    console.log(
        r.font.padEnd(17) +
            r.rail.padEnd(11) +
            String(r.aria).padEnd(13) +
            r.visibleText.padEnd(22) +
            String(r.textWidth).padEnd(8) +
            String(r.clientWidth).padEnd(6) +
            `${r.visibleCount}/${r.spanCount}`.padEnd(7) +
            (doubleShown
                ? `FAIL both spans visible`
                : truncated
                  ? `FAIL truncated (${r.scrollWidth}>${r.clientWidth})`
                  : "ok"),
    );
}

// aria-label / title contract (WCAG 2.5.3 + no redundant tooltip)
console.log("\n-- a11y contract --");
const ariaOk = rows.every((r) => r.aria && !r.aria.includes("..."));
const titleOk = rows.every((r) =>
    r.spanCount === 2 ? r.title === r.aria : r.title === null,
);
console.log(`aria-label always full canonical text : ${ariaOk ? "ok" : "FAIL"}`);
console.log(`title only when short !== full        : ${titleOk ? "ok" : "FAIL"}`);
if (!ariaOk || !titleOk) failures++;

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures} problem(s))`}`);
process.exit(failures === 0 ? 0 : 1);
