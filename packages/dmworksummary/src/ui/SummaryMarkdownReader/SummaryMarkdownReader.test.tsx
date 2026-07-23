import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../components/CitationText", () => ({
    default: ({ content, headingIds }: { content: string; headingIds: string[] }) => <div>
        {extractSummaryOutline(content).map((item, index) => item.level === 2
            ? <h2 id={headingIds[index]} key={item.id}>{item.text}</h2>
            : <h3 id={headingIds[index]} key={item.id}>{item.text}</h3>)}
        {content.includes("[x]") ? <input type="checkbox" checked readOnly /> : null}
    </div>,
}));
import SummaryMarkdownReader, { extractSummaryOutline } from ".";

describe("SummaryMarkdownReader", () => {
    it("builds stable duplicate-safe H2/H3 outline and ignores fenced headings", () => {
        expect(extractSummaryOutline("## 结论\n### 详情\n## 结论\n```\n## ignored\n```"))
            .toEqual([{ id: "结论", level: 2, text: "结论" }, { id: "详情", level: 3, text: "详情" }, { id: "结论-2", level: 2, text: "结论" }]);
    });

    it("renders markdown and links outline to headings", () => {
        render(<SummaryMarkdownReader content={`## Result

- [x] done`} outlineLabel="Outline" />);
        expect(screen.getByRole("heading", { name: "Result" })).toHaveAttribute("id", "result");
        expect(screen.getByRole("link", { name: "Result" })).toHaveAttribute("href", "#result");
        expect(screen.getByRole("checkbox")).toBeChecked();
    });
});
